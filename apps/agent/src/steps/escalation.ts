// Step 6 — Escalation gate + handoff.
// Pure functions. Gate decides IF we escalate (impact/conflict/force, not mood
// alone). Handoff builds the (hard-coded) plan when the gate opens.
import type {
  AgentDomain,
  AgentReport,
  Escalation,
  Guard,
  Investigation,
  Severity,
  Sentiment,
} from "../contracts/types";

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

export function runEscalation(
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
