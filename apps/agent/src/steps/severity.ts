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
  "security",
  "fraud",
  "legal",
  "gdpr",
  "ccpa",
];
const MEDIUM_IMPACT = ["refund", "charge", "charged", "duplicate", "payment", "invoice", "subscription", "$"];

/** Match a keyword as a whole word/phrase so "pin down" doesn't hit "down". */
function blobMatches(blob: string, keyword: string): boolean {
  if (keyword.includes(" ")) return blob.includes(keyword);
  return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(blob);
}

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
  if (HIGH_IMPACT.some((k) => blobMatches(blob, k))) level = "high";
  else if (MEDIUM_IMPACT.some((k) => blobMatches(blob, k))) level = "medium";
  else if (/\boutage\b|\bdown\b/.test(blob) && /\bservice\b|\bsite\b|\bapp\b|\bstorefront\b/.test(blob)) {
    level = "high";
  }
  // An overall-unresolved investigation (all agents failed) is worth a medium
  // floor — something genuinely couldn't be handled. But a single KB-gap agent
  // in an otherwise partial result does NOT warrant high severity; escalating
  // to P1 just because a policy doc was missing is noise, not signal.
  if (investigation.overall_status === "unresolved" && level === "low") level = "medium";

  const base: Record<SeverityLevel, number> = { low: 1, medium: 2, high: 3 };
  let p = base[level];
  const factors: string[] = [`severity:${level}`];

  const anyResolved = reports.some((r) => r.status === "resolved");
  const productivePartial = investigation.overall_status === "partial" && anyResolved;

  if (sentiment.label === "angry" && !productivePartial) {
    p += 1;
    factors.push("angry(+1)");
  } else if (sentiment.label === "frustrated") {
    factors.push("frustrated");
  }
  if (messageCount > 1) {
    p += 1;
    factors.push(`repeat_contact:${messageCount}(+1)`);
  }
  // Mixed outcomes across specialists on a multi-issue ticket are normal partial
  // coverage, not a priority conflict worth bumping on first contact.
  if (investigation.conflicts.length > 0 && !productivePartial) {
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
