// Step 7 — Response synthesizer.
// Pure function. Builds ONE customer-ready answer from all agent reports.
// Always includes reasoning + evidence. Appends escalation note when present.
import type { AgentReport, Escalation, Resolution } from "../contracts/types";

export function runSynthesizer(
  reports: AgentReport[],
  escalation: Escalation | undefined
): Resolution {
  const findings = reports.flatMap((r) => r.findings);
  const actions = reports.flatMap((r) => r.actions);
  const evidence = [...new Set(reports.flatMap((r) => r.evidence))];
  const reasoning = reports.map((r) => `${r.agent}: ${r.reasoning}`).join(" ");

  const issueCount = reports.length;
  const resolution: Resolution = {
    summary:
      issueCount > 1
        ? `We looked into the ${issueCount} issues you reported and have an update on each.`
        : `We've reviewed your request and have an update.`,
    findings,
    actions: [...actions],
    reasoning: reasoning || "Resolution based on specialist investigation.",
    evidence,
  };

  if (escalation?.escalate && escalation.customer_addendum) {
    resolution.actions.push(escalation.customer_addendum);
  }

  return resolution;
}
