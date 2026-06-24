// Step 5 — Severity & priority.
// Pure function. Severity from agent FINDINGS (impact), not customer wording.
// Priority = severity + a capped sentiment nudge.
import type {
  AgentReport,
  Investigation,
  PriorityLevel,
  Sentiment,
  Severity,
  SeverityLevel,
} from "../contracts/types";

const HIGH_IMPACT = ["locked", "lock", "cannot access", "can't access", "all users", "everyone", "data loss", "breach", "outage", "down"];
const MONEY = ["refund", "charge", "charged", "duplicate", "payment", "$"];

export function runSeverity(
  message: string,
  reports: AgentReport[],
  investigation: Investigation,
  sentiment: Sentiment
): Severity {
  const blob = (reports.map((r) => r.findings.join(" ") + " " + r.reasoning).join(" ") + " " + message).toLowerCase();

  let level: SeverityLevel = "low";
  if (HIGH_IMPACT.some((k) => blob.includes(k))) level = "high";
  else if (MONEY.some((k) => blob.includes(k))) level = "medium";
  if (investigation.overall_status === "unresolved" && level === "low") level = "medium";

  const base: Record<SeverityLevel, number> = { low: 1, medium: 2, high: 3 };
  let p = base[level];
  const factors: string[] = [`severity:${level}`];

  if (sentiment.label === "angry") {
    p += 1;
    factors.push("angry(+1)");
  } else if (sentiment.label === "frustrated") {
    factors.push("frustrated");
  }

  p = Math.min(p, 3);
  const priority: PriorityLevel = p >= 3 ? "P1" : p === 2 ? "P2" : "P3";

  return {
    level,
    priority,
    reasoning: `Severity from findings (${level}); priority ${priority} [${factors.join(", ")}].`,
  };
}
