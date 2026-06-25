/**
 * shared/core/classifier.ts
 *
 * Given a ticket, decide which registered handler should run, with a confidence.
 * The prompt is built from the AGENT'S OWN registry at call time — so an agent
 * only ever routes against its own use cases. Register a handler and it becomes
 * a routing option automatically; no edits here.
 *
 * Takes the Registry (and agent name) as input — no global lookup — which is
 * what keeps agents isolated when several run concurrently.
 */
import type { Registry } from "./registry.js";
import { callLLM } from "../gateway/index.js";
import { log } from "./logger.js";

export interface ClassificationResult {
  handlerId: string | null; // null => none matched
  confidence: number; // 0..1
  rationale: string; // why this choice (feeds traceability)
}

export async function classify(
  registry: Registry,
  agentName: string,
  traceId: string,
  text: string
): Promise<ClassificationResult> {
  const handlers = registry.list();

  // Build the option list dynamically from THIS agent's registry.
  const options = handlers
    .map(
      (h) =>
        `- id: "${h.id}"\n  description: ${h.description}\n  examples: ${h.examples
          .map((e) => `"${e}"`)
          .join(", ")}`
    )
    .join("\n");

  const system = [
    `You are the routing classifier for the "${agentName}" support agent.`,
    "Choose exactly one handler id that best matches the customer message,",
    "or null if none fit. Respond with STRICT JSON only, no prose, no code fences.",
    'Shape: { "handlerId": string|null, "confidence": number (0..1), "rationale": string }',
  ].join(" ");

  const user = [
    "Available handlers:",
    options || "(none registered)",
    "",
    `Customer message: """${text}"""`,
    "",
    "Return the JSON object now.",
  ].join("\n");

  const result = await callLLM<ClassificationResult>({
    system,
    user,
    json: true,
    traceId,
    options: { temperature: 0 }, // deterministic routing
  });

  log(traceId, "classifier", "classified ticket", {
    agent: agentName,
    handlerId: result.handlerId,
    confidence: result.confidence,
    rationale: result.rationale,
  });

  return result;
}
