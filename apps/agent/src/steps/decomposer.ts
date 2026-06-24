// Step 4a — Decomposer.
// Pure function. Splits a mixed ticket into sub-problems (one domain each).
// Single-issue tickets get one sub-problem derived from the primary intent.
import type { AgentDomain, Classification, SubProblem } from "../contracts/types";

function singleSubProblem(message: string, classification: Classification): SubProblem[] {
  const domain: AgentDomain =
    classification.primary_intent === "unknown" || classification.primary_intent === "mixed"
      ? "policy" // safe route / fallback
      : (classification.primary_intent as AgentDomain);
  return [{ id: "SP-1", domain, description: message.slice(0, 200) }];
}

export function runDecomposer(message: string, classification: Classification): SubProblem[] {
  if (!classification.is_multi_issue) return singleSubProblem(message, classification);

  const domains = classification.intents
    .filter((i) => i.confidence >= 0.6 && i.type !== "mixed" && i.type !== "unknown")
    .map((i) => i.type as AgentDomain);
  const unique = [...new Set(domains)];
  if (unique.length === 0) return singleSubProblem(message, classification);

  return unique.map((domain, idx) => ({
    id: `SP-${idx + 1}`,
    domain,
    description: `${domain} issue from: ${message.slice(0, 160)}`,
  }));
}
