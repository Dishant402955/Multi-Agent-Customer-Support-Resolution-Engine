/**
 * shared/handlers/declarative.handler.ts
 *
 * THE COMMON HANDLER. One piece of code that runs ANY use case described as
 * JSON — for any agent. Given a UseCaseDefinition, run() does:
 *   1. PARAM CHECK — required_params present? If not (and can_ask_user), ask.
 *   2. TOOLS       — call each declared (scoped) tool from the shared pool.
 *   3. KB          — retrieve from the declared (scoped) KB files.
 *   4. ANSWER      — feed the use case prompt + gathered data to callLLM.
 *
 * Everything it can touch is limited to what the definition declares, enforced
 * by the ScopedContext built in buildScope() against the SHARED pools.
 */
import { z } from "zod";
import type {
  UseCaseDefinition,
  UseCaseHandler,
  AgentState,
  ScopedContext,
  Evidence,
  ParamSpec,
} from "../core/types.js";
import { getTool } from "../tools/registry.js";
import { retrieveFromScope } from "../kb/retriever.js";
import { callLLM } from "../gateway/index.js";
import { log } from "../core/logger.js";

/** The structured shape we ask the LLM to return, so a merger can consume it. */
const answerSchema = z.object({
  findings: z.string(),
  actions: z.array(z.string()).default([]),
  /**
   * The handler's honest self-assessment: did the gathered data actually let it
   * answer? false => the agent surfaces "needs_escalation" so the pipeline can
   * route to a human. Defaults to true for backward compatibility.
   */
  resolved: z.boolean().default(true),
});
type StructuredAnswer = z.infer<typeof answerSchema>;

function buildScope(def: UseCaseDefinition, traceId: string): ScopedContext {
  const toolScope = def.capabilities?.tools ?? [];
  const kbScope =
    def.capabilities?.knowledge_base?.map((k) => k.knowledge_file) ?? [];

  return {
    useCaseId: def.use_case_id,
    toolScope,
    kbScope,
    async callTool(name, args) {
      if (!toolScope.includes(name)) {
        throw new Error(
          `Use case "${def.use_case_id}" tried to call out-of-scope tool "${name}".`
        );
      }
      const tool = getTool(name);
      if (!tool) throw new Error(`Tool "${name}" not found in shared pool.`);
      log(traceId, "tool", `calling ${name}`, { args });
      const result = await tool.run(args);
      log(traceId, "tool", `${name} returned`, { result });
      return result;
    },
    async retrieve(query) {
      if (kbScope.length === 0) return [];
      log(traceId, "kb", "retrieving from scope", { kbScope });
      return retrieveFromScope(query, kbScope);
    },
  };
}

/** A required param is "missing" only if we have no usable value for it. */
function missingParamsFrom(def: UseCaseDefinition, params: Record<string, unknown>): string[] {
  const required = def.required_params ?? {};
  return Object.keys(required).filter(
    (n) => params[n] === undefined || params[n] === null || String(params[n]).trim() === ""
  );
}

/**
 * Pull any declared params the customer already stated in their message, so we
 * never ask for something they've already given us. Uses the LLM to read the
 * message against the param specs; only values clearly present are returned
 * (the model is told to use null otherwise — we never guess). Params we already
 * have (from context / prior turns) are skipped, so this is a no-op for use
 * cases that declare no params.
 */
async function extractParams(
  def: UseCaseDefinition,
  state: AgentState,
  known: Record<string, unknown>,
  traceId: string
): Promise<Record<string, unknown>> {
  const specs: Record<string, ParamSpec> = {
    ...(def.required_params ?? {}),
    ...(def.optional_params ?? {}),
  };
  const targets = Object.keys(specs).filter((n) => known[n] === undefined);
  if (targets.length === 0) return {};

  const fieldLines = targets
    .map((n) => {
      const s = specs[n];
      const bits = [s.description || s.type];
      if (s.format) bits.push(`format: ${s.format}`);
      return `- ${n} (${bits.join("; ")})`;
    })
    .join("\n");

  const system =
    "You extract structured parameters from a customer support message. " +
    "Return STRICT JSON only (no prose, no code fences): an object whose keys are " +
    "exactly the requested parameter names. Set a key's value only if it is clearly " +
    "stated in the message; otherwise set it to null. Never guess or invent values.";

  const user = [
    `CUSTOMER MESSAGE: """${state.ticket.text}"""`,
    "",
    "PARAMETERS TO EXTRACT:",
    fieldLines,
    "",
    "Return the JSON object now.",
  ].join("\n");

  try {
    const raw = await callLLM<Record<string, unknown>>({
      traceId,
      system,
      user,
      json: true,
      options: { temperature: 0 },
    });
    const found: Record<string, unknown> = {};
    for (const n of targets) {
      const v = raw?.[n];
      if (v !== undefined && v !== null && String(v).trim() !== "") found[n] = v;
    }
    if (Object.keys(found).length > 0) {
      log(traceId, "declarative", "extracted params from message", { found });
    }
    return found;
  } catch (err) {
    log(traceId, "declarative", "param extraction failed", { error: String(err) });
    return {};
  }
}

export function makeDeclarativeHandler(def: UseCaseDefinition): UseCaseHandler {
  return {
    id: def.use_case_id,
    description: def.description,
    examples: def.example_utterances,
    requiredTools: def.capabilities?.tools ?? [],

    async run(state: AgentState): Promise<Partial<AgentState>> {
      const traceId = state.ticket.traceId;
      log(traceId, "declarative", `running use case "${def.use_case_id}"`);

      // Params we already hold: previously-captured (scratch) + structured context.
      const known: Record<string, unknown> = {
        ...((state.scratch.params as Record<string, unknown>) ?? {}),
        ...((state.ticket.context as Record<string, unknown>) ?? {}),
      };

      // 1a. EXTRACT — read any declared params straight from the customer's
      //     message so we don't ask for what they already told us.
      const extracted = await extractParams(def, state, known, traceId);
      const params = { ...known, ...extracted };

      // 1b. PARAM CHECK — only ask when a REQUIRED param is still missing after
      //     extraction. If present (from the message or context), we proceed.
      const missing = missingParamsFrom(def, params);
      if (missing.length > 0 && def.capabilities?.can_ask_user) {
        const first = missing[0];
        const prompt =
          def.required_params?.[first]?.prompt_if_missing ??
          `Could you provide the ${first}?`;
        log(traceId, "declarative", "missing required param", { missing, extracted });
        return {
          findings: prompt,
          actions: [],
          answer: prompt,
          clarificationNeeded: first,
          reasoning: [`Missing required param "${first}".`],
          scratch: { params },
          done: true,
        };
      }

      const scope = buildScope(def, traceId);
      const evidence: Evidence[] = [];
      const gathered: Record<string, unknown> = {};

      // 2. TOOLS
      for (const toolName of scope.toolScope) {
        try {
          const out = await scope.callTool(toolName, params);
          gathered[toolName] = out;
          evidence.push({ source: `tool:${toolName}`, detail: `Called ${toolName}.`, raw: out });
        } catch (err) {
          log(traceId, "declarative", `tool ${toolName} failed`, { error: String(err) });
          evidence.push({ source: `tool:${toolName}`, detail: `Tool failed: ${String(err)}` });
        }
      }

      // 3. KB
      const kbHits = await scope.retrieve(state.ticket.text);
      for (const hit of kbHits) {
        evidence.push({ source: hit.source, detail: "KB retrieval", raw: hit.text });
      }

      // 4. ANSWER — ask for STRUCTURED output so the merger can consume it:
      //    findings (what we determined) split from actions (what to do next).
      const system = [
        def.prompt,
        "",
        "You are given GATHERED DATA (tool results) and KB SNIPPETS below.",
        "Use ONLY this data. Do not invent values.",
        'Respond with STRICT JSON only, no prose, no code fences, shaped:',
        '{ "findings": string, "actions": string[], "resolved": boolean }',
        "- findings: a concise explanation of what you determined from the data.",
        "- actions: concrete next steps for the customer or system (may be empty).",
        "- resolved: true if the gathered data/KB let you explain or address the",
        "  request (this is the normal case, even if you suggest a follow-up).",
        "  Set false ONLY when the data and KB are genuinely insufficient to help",
        "  and a human must take over.",
      ].join("\n");

      const user = [
        `CUSTOMER MESSAGE: ${state.ticket.text}`,
        "",
        `GATHERED DATA: ${JSON.stringify(gathered, null, 2)}`,
        "",
        `KB SNIPPETS: ${kbHits.map((h) => `[${h.source}]\n${h.text}`).join("\n\n") || "(none)"}`,
        def.response_templates
          ? `\nRESPONSE TEMPLATES (pick the matching one):\n${JSON.stringify(def.response_templates, null, 2)}`
          : "",
        def.status_routing
          ? `\nSTATUS ROUTING TABLE (map status -> category):\n${JSON.stringify(def.status_routing, null, 2)}`
          : "",
        "",
        "Return the JSON object now.",
      ]
        .filter(Boolean)
        .join("\n");

      let structured: StructuredAnswer;
      try {
        const raw = await callLLM<unknown>({
          traceId,
          system,
          user,
          json: true,
          options: { temperature: 0.2, maxTokens: 700 },
        });
        structured = answerSchema.parse(raw);
      } catch (err) {
        // If the model returns malformed JSON, degrade gracefully rather than
        // crash — surface it as an escalation with the parse error as reasoning.
        log(traceId, "declarative", "structured answer parse failed", {
          error: String(err),
        });
        return {
          escalate: true,
          evidence,
          reasoning: [
            `Ran declarative use case "${def.use_case_id}".`,
            `Structured answer parse failed: ${String(err)}.`,
          ],
          scratch: { params },
          done: true,
        };
      }

      return {
        findings: structured.findings,
        actions: structured.actions,
        resolved: structured.resolved,
        // Mirror findings into answer only when actually resolved, so an
        // unresolved case doesn't look like it produced a usable reply.
        answer: structured.resolved ? structured.findings : undefined,
        evidence,
        reasoning: [
          `Ran declarative use case "${def.use_case_id}".`,
          Object.keys(extracted).length
            ? `Captured from message: ${Object.keys(extracted).join(", ")}.`
            : `No params needed extracting from the message.`,
          `Tools: ${scope.toolScope.join(", ") || "none"}.`,
          `KB: ${scope.kbScope.join(", ") || "none"}.`,
          structured.resolved ? "Handler resolved the request." : "Handler could not resolve; flagged for escalation.",
        ],
        scratch: { params },
        done: true,
      };
    },
  };
}
