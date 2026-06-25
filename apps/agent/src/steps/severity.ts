// Step 5 — Severity & priority.
// Pure function. Severity from agent FINDINGS (impact), not customer wording.
// Priority = severity + capped modifiers (sentiment + repeat contact).
import type {
  AgentReport,
  Investigation,
  PriorityLevel,
  Sentiment,
  Severity,
  SeverityLevel,
} from "../contracts/types";

const HIGH_IMPACT = [
  "locked",
  "cannot access",
  "can't access",
  "all users",
  "everyone",
  "data loss",
  "breach",
  "outage",
  "down",
  "security",
  "fraud",
  "legal",
  "gdpr",
  "ccpa",
];
const MEDIUM_IMPACT = ["refund", "charge", "charged", "duplicate", "payment", "invoice", "subscription", "$"];

export function runSeverity(
  reports: AgentReport[],
  investigation: Investigation,
  sentiment: Sentiment,
  messageCount = 1
): Severity {
  // Severity intentionally excludes the raw customer message. Impact comes from
  // what specialists found, their evidence/actions/reasoning, and their status.
  const blob = reports
    .map((r) => [r.findings.join(" "), r.actions.join(" "), r.reasoning, r.evidence.join(" ")].join(" "))
    .join(" ")
    .toLowerCase();

  let level: SeverityLevel = "low";
  if (HIGH_IMPACT.some((k) => blob.includes(k))) level = "high";
  else if (MEDIUM_IMPACT.some((k) => blob.includes(k))) level = "medium";
  if (investigation.overall_status === "unresolved" && level === "low") level = "medium";
  if (reports.some((r) => r.status === "unresolved")) level = "high";

  const base: Record<SeverityLevel, number> = { low: 1, medium: 2, high: 3 };
  let p = base[level];
  const factors: string[] = [`severity:${level}`];

  if (sentiment.label === "angry") {
    p += 1;
    factors.push("angry(+1)");
  } else if (sentiment.label === "frustrated") {
    factors.push("frustrated");
  }
  if (messageCount > 1) {
    p += 1;
    factors.push(`repeat_contact:${messageCount}(+1)`);
  }
  if (investigation.conflicts.length > 0) {
    p += 1;
    factors.push("conflict(+1)");
  }

  p = Math.min(p, 3);
  const priority: PriorityLevel = p >= 3 ? "P1" : p === 2 ? "P2" : "P3";

  return {
    level,
    priority,
    reasoning: `Severity from findings (${level}); priority ${priority} [${factors.join(", ")}].`,
  };
}
