// Step 2 — Intent classifier.
// Pure function. Deterministic keyword scoring → intents + confidence,
// multi-issue flag, and a fallback flag for low-confidence cases.
import type { Classification, IntentScore, IntentType } from "../contracts/types";

const KEYWORDS: Record<string, string[]> = {
  technical: ["crash", "error", "bug", "login", "log in", "loading", "broken", "not working", "freeze", "slow", "500", "page", "app"],
  billing: ["charge", "charged", "refund", "invoice", "payment", "billed", "subscription", "card", "double", "twice", "$"],
  policy: ["policy", "eligible", "eligibility", "terms", "allowed", "cancel", "warranty", "rules", "entitled"],
};

export function runClassifier(message: string): Classification {
  const text = message.toLowerCase();
  const scores: IntentScore[] = [];
  for (const domain of ["technical", "billing", "policy"] as IntentType[]) {
    const hits = KEYWORDS[domain as string].filter((k) => text.includes(k)).length;
    if (hits > 0) {
      scores.push({ type: domain, confidence: Math.min(0.5 + hits * 0.15, 0.97) });
    }
  }
  scores.sort((a, b) => b.confidence - a.confidence);

  if (scores.length === 0) {
    return {
      primary_intent: "unknown",
      is_multi_issue: false,
      fallback: true,
      intents: [{ type: "unknown", confidence: 0.4 }],
    };
  }

  const isMulti = scores.filter((s) => s.confidence >= 0.6).length >= 2;
  return {
    primary_intent: isMulti ? "mixed" : scores[0].type,
    is_multi_issue: isMulti,
    fallback: scores[0].confidence < 0.6,
    intents: scores,
  };
}
