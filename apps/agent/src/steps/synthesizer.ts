// Step 7 — Response synthesizer (Output Combiner, build-plan component 4).
//
// Combines every specialist AgentReport into ONE customer-ready resolution.
//
// Primary path: an LLM call (through the shared gateway — the single LLM door)
// merges the findings/actions into a coherent, de-duplicated reply that reads as
// one answer rather than stitched fragments.
//
// Safety net: if no provider is configured or the call fails, we fall back to a
// deterministic template merge. Either way evidence + reasoning come straight
// from the reports (never invented by the model), preserving traceability.
import type { AgentReport, Escalation, Message, Resolution, TicketStatus } from "../contracts/types";
import { callLLM, availableProviders } from "../shared/gateway/index";
import { log } from "../shared/core/logger";

interface SynthOpts {
  traceId?: string;
  message?: string;
  history?: Message[];
  ticketStatus?: TicketStatus;
}

/** Human-readable line describing the ticket's current escalation status. */
function statusLine(status?: TicketStatus): string {
  if (!status || !status.has_escalation) return "";
  if (status.escalation_status === "resolved") {
    return status.assignee_name
      ? `This ticket was escalated and has since been RESOLVED by ${status.assignee_name}${status.department ? ` (${status.department})` : ""}.`
      : "This ticket was escalated and has since been resolved.";
  }
  return status.assignee_name
    ? `This ticket is escalated and OPEN with ${status.assignee_name}${status.department ? ` (${status.department})` : ""}${status.urgency ? `, urgency ${status.urgency}` : ""}.`
    : "This ticket is escalated and currently open with our team.";
}

/** Render prior turns (oldest first) so the model has the full thread. */
function historyBlock(history?: Message[]): string {
  const turns = history ?? [];
  if (!turns.length) return "";
  const lines = turns
    .slice(-8)
    .map((m) => `${m.role === "customer" ? "Customer" : "Support"}: ${m.text}`)
    .join("\n");
  return lines;
}

// ---------------------------------------------------------------------------
// Deterministic merge — also the fallback when the LLM is unavailable.
// ---------------------------------------------------------------------------
function deterministic(
  reports: AgentReport[],
  escalation: Escalation | undefined,
  status?: TicketStatus
): Resolution {
  const findings = reports.flatMap((r) => r.findings);
  const actions = reports.flatMap((r) => r.actions);
  const evidence = [...new Set(reports.flatMap((r) => r.evidence))];
  const reasoning = reports.map((r) => `${r.agent}: ${r.reasoning}`).join(" ");

  const sline = statusLine(status);
  const issueCount = reports.length;
  const haveFindings = findings.length > 0;

  let summary: string;
  if (haveFindings) {
    summary =
      issueCount > 1
        ? `We looked into the ${issueCount} issues you reported and have an update on each.`
        : `We've reviewed your request and have an update.`;
  } else if (sline) {
    // No fresh findings (e.g. a "what's the update?" follow-up) → report status.
    summary = `Here's the latest on your ticket. ${sline}`;
  } else {
    summary = `We've received your message and it's being handled. We'll follow up with any updates.`;
  }

  const resolution: Resolution = {
    summary,
    findings: haveFindings ? findings : sline ? [sline] : [],
    actions: [...actions],
    reasoning: reasoning || "Resolution based on ticket context.",
    evidence,
  };

  if (escalation?.escalate && escalation.customer_addendum) {
    resolution.actions.push(escalation.customer_addendum);
  }
  return resolution;
}

// The structured shape we ask the LLM to return.
interface LlmResolution {
  summary?: string;
  findings?: string[];
  actions?: string[];
}

export async function runSynthesizer(
  reports: AgentReport[],
  escalation: Escalation | undefined,
  opts: SynthOpts = {}
): Promise<Resolution> {
  const base = deterministic(reports, escalation, opts.ticketStatus);

  const history = historyBlock(opts.history);
  const isFollowUp = (opts.history?.length ?? 0) > 0;

  // No LLM → deterministic merge. With an LLM, synthesize whenever there's
  // anything to work from (agent reports OR prior conversation/status) — a
  // follow-up like "what's the update?" has thin reports but rich history.
  const canSynthesize =
    availableProviders().length > 0 &&
    (reports.length > 0 || isFollowUp || (opts.ticketStatus?.has_escalation ?? false));
  if (!canSynthesize) return base;

  const traceId = opts.traceId ?? "synthesize";
  const system = [
    "You are the response synthesizer for a customer-support resolution engine.",
    "You are continuing an EXISTING support ticket with this customer. The full",
    "conversation so far and the ticket's current status are provided below — you",
    "already know who the customer is and what they reported.",
    "",
    "HARD RULES:",
    "- NEVER ask the customer for a ticket/reference number, account id, or to",
    "  restate their issue. You already have all of that from the context.",
    "- If the customer is asking for a status update (e.g. \"what's the update?\"),",
    "  answer it directly: summarize what has happened so far in this ticket and",
    "  state the current status, including any escalation and who is handling or",
    "  has resolved it.",
    "- Merge the specialist agents' findings/actions into ONE clear, empathetic",
    "  reply. Write as a single coherent answer, not a list of agent outputs.",
    "- Use ONLY the information provided (conversation, status, agent reports).",
    "  Do not invent facts, charges, names, or steps. De-duplicate overlap.",
    "",
    "Respond with STRICT JSON only, no prose, no code fences, shaped:",
    '{ "summary": string, "findings": string[], "actions": string[] }',
    "- summary: 1-2 sentence overview of the outcome / current status.",
    "- findings: the key points, one per item (may be empty).",
    "- actions: concrete next steps for the customer or system (may be empty).",
  ].join("\n");

  const reportBlock =
    reports.length > 0
      ? reports
          .map(
            (r, i) =>
              `Agent ${i + 1} (${r.agent}, status=${r.status}):\n` +
              `  findings: ${r.findings.join(" | ") || "(none)"}\n` +
              `  actions: ${r.actions.join(" | ") || "(none)"}`
          )
          .join("\n\n")
      : "(no specialist findings this turn)";

  const sline = statusLine(opts.ticketStatus);

  const user = [
    isFollowUp ? `CONVERSATION SO FAR (oldest first):\n${history}\n` : "",
    `CUSTOMER'S LATEST MESSAGE: """${opts.message ?? ""}"""\n`,
    sline ? `TICKET STATUS: ${sline}\n` : "",
    "AGENT REPORTS (this turn):",
    reportBlock,
    escalation?.escalate
      ? `\nESCALATION (this turn): being escalated to ${escalation.recommended_team ?? "a specialist"}. ` +
        `Tell the customer a human will follow up${escalation.customer_addendum ? `: "${escalation.customer_addendum}"` : "."}`
      : "",
    "",
    "Return the JSON object now.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const out = await callLLM<LlmResolution>({
      system,
      user,
      json: true,
      traceId,
      options: { temperature: 0.3, maxTokens: 700 },
    });

    const findings = (out.findings ?? []).filter((f) => typeof f === "string" && f.trim());
    const actions = (out.actions ?? []).filter((a) => typeof a === "string" && a.trim());

    return {
      summary: out.summary?.trim() || base.summary,
      findings: findings.length ? findings : base.findings,
      actions: actions.length ? actions : base.actions,
      // Reasoning + evidence stay traceable to the agents, never model-invented.
      reasoning: base.reasoning,
      evidence: base.evidence,
    };
  } catch (err) {
    log(traceId, "synthesize", "LLM synthesis failed, deterministic fallback", {
      error: String(err),
    });
    return base;
  }
}
