// Step 6 — Escalation gate + handoff.
// Gate decides IF we escalate (impact/conflict/force, not mood alone).
// The handoff itself is produced by a named Escalation agent: LLM + escalation
// matrix when available, deterministic fallback when not.
import type {
  AgentDomain,
  AgentReport,
  Escalation,
  Guard,
  Investigation,
  Severity,
  Sentiment,
} from "../contracts/types";
import { callLLM, availableProviders } from "../shared/gateway/index";
import { retrieveFromScope } from "../shared/kb/retriever";
import { log } from "../shared/core/logger";

export interface GateInput {
  guard: Guard;
  investigation: Investigation;
  severity: Severity;
  sentiment: Sentiment;
  messageCount: number;
  agentReports?: AgentReport[];
}

export function shouldEscalate(input: GateInput): { escalate: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const reports = input.agentReports ?? [];

  if (input.guard.force_escalation) reasons.push(input.guard.reason || "Hard signal");
  if (input.severity.level === "high") reasons.push("High severity impact");
  if (input.investigation.overall_status === "unresolved") reasons.push("Unresolved by agents");
  if (input.investigation.conflicts.length > 0) reasons.push("Conflicting agent findings");

  // A specialist explicitly handed off to a human (e.g. GDPR / legal queue) even
  // when the merged investigation is only "partial" because another agent was
  // out-of-domain or needs_info.
  const handoff = reports.filter((r) => r.status === "unresolved");
  if (handoff.length > 0) {
    reasons.push(
      `Specialist handoff requested (${handoff.map((r) => r.agent).join(", ")})`
    );
  }

  const frustrated = input.sentiment.label === "frustrated" || input.sentiment.label === "angry";
  const repeat = input.messageCount > 1;
  if (frustrated && (repeat || input.investigation.overall_status !== "resolved")) {
    reasons.push("Frustration with repeat contact / unresolved");
  }

  return { escalate: reasons.length > 0, reasons };
}

const TEAM_BY_DOMAIN: Record<string, string> = {
  billing: "Billing Lead",
  technical: "Engineering On-call",
  policy: "Policy & Compliance",
};

function deterministicEscalation(
  reasons: string[],
  severity: Severity,
  primaryDomain: AgentDomain
): Escalation {
  const team = TEAM_BY_DOMAIN[primaryDomain] || "Support Lead";
  return {
    escalate: true,
    reason: reasons.join("; "),
    recommended_team: team,
    urgency: severity.priority,
    internal_actions: [`Assign to ${team}`, "Review full audit trail and agent reports"],
    customer_addendum: `We've escalated your case to our ${team} for priority handling and will follow up shortly.`,
  };
}

interface EscalationAgentOutput {
  recommended_team?: string;
  urgency?: "P1" | "P2" | "P3";
  internal_actions?: string[];
  customer_addendum?: string;
}

export async function runEscalation(
  reasons: string[],
  severity: Severity,
  primaryDomain: AgentDomain,
  opts: {
    traceId?: string;
    reports?: AgentReport[];
    investigation?: Investigation;
  } = {}
): Promise<Escalation> {
  const fallback = deterministicEscalation(reasons, severity, primaryDomain);
  const traceId = opts.traceId ?? "escalation";
  const kbHits = await retrieveFromScope(
    `${primaryDomain} ${severity.level} ${severity.priority} ${reasons.join(" ")}`,
    ["escalation_matrix.md"]
  );

  if (availableProviders().length === 0) {
    return fallback;
  }

  const system = [
    "You are the Escalation Agent for a multi-agent customer-support engine.",
    "Your job is to build a human handoff plan from the escalation reasons,",
    "severity/priority, specialist reports, and the escalation matrix.",
    "Use only the provided facts. Do not invent names or ticket details.",
    'Respond with STRICT JSON only, shaped: { "recommended_team": string, "urgency": "P1"|"P2"|"P3", "internal_actions": string[], "customer_addendum": string }',
  ].join(" ");

  const reportBlock = (opts.reports ?? [])
    .map(
      (r) =>
        `${r.agent} (${r.status}, confidence ${r.confidence}): findings=${r.findings.join(" | ") || "(none)"}; ` +
        `actions=${r.actions.join(" | ") || "(none)"}; evidence=${r.evidence.join(" | ") || "(none)"}`
    )
    .join("\n");

  const user = [
    `PRIMARY DOMAIN: ${primaryDomain}`,
    `SEVERITY: ${severity.level} / ${severity.priority}`,
    `SEVERITY REASONING: ${severity.reasoning}`,
    `ESCALATION REASONS: ${reasons.join("; ")}`,
    `INVESTIGATION: ${opts.investigation ? JSON.stringify(opts.investigation) : "(none)"}`,
    "SPECIALIST REPORTS:",
    reportBlock || "(none)",
    "",
    "ESCALATION MATRIX SNIPPETS:",
    kbHits.map((h) => `[${h.source}]\n${h.text}`).join("\n\n") || "(none)",
    "",
    "Return the JSON object now.",
  ].join("\n");

  try {
    const out = await callLLM<EscalationAgentOutput>({
      traceId,
      system,
      user,
      json: true,
      options: { temperature: 0.1, maxTokens: 600 },
    });

    return {
      escalate: true,
      reason: reasons.join("; "),
      recommended_team: out.recommended_team?.trim() || fallback.recommended_team,
      urgency: out.urgency || fallback.urgency,
      internal_actions: out.internal_actions?.length ? out.internal_actions : fallback.internal_actions,
      customer_addendum: out.customer_addendum?.trim() || fallback.customer_addendum,
    };
  } catch (err) {
    log(traceId, "escalation", "Escalation agent failed, deterministic fallback", {
      error: String(err),
    });
    return fallback;
  }
}
