// Step 1 — Hard-signal guard.
// Pure function. Deterministic phrase screen (NOT mood). Sets force_escalation
// but never stops the pipeline; agents still run to build handoff context.
import type { Guard } from "../contracts/types";

// Explicit phrases only — NOT mood. Matching is substring, case-insensitive.
const SIGNALS: { phrase: string; category: string }[] = [
  // Human / supervisor requests
  { phrase: "talk to a manager", category: "human_request" },
  { phrase: "speak to a manager", category: "human_request" },
  { phrase: "speak to a supervisor", category: "human_request" },
  { phrase: "talk to a supervisor", category: "human_request" },
  { phrase: "want a human", category: "human_request" },
  { phrase: "speak to a human", category: "human_request" },
  { phrase: "speak to a person", category: "human_request" },
  { phrase: "real person", category: "human_request" },
  { phrase: "real human", category: "human_request" },
  // Legal / compliance
  { phrase: "i'll sue", category: "legal" },
  { phrase: "i will sue", category: "legal" },
  { phrase: "sue you", category: "legal" },
  { phrase: "lawyer", category: "legal" },
  { phrase: "attorney", category: "legal" },
  { phrase: "legal action", category: "legal" },
  { phrase: "take legal action", category: "legal" },
  { phrase: "data breach", category: "legal" },
  { phrase: "gdpr", category: "legal" },
  { phrase: "ccpa", category: "legal" },
  // Financial dispute
  { phrase: "chargeback", category: "financial_dispute" },
  { phrase: "charge back", category: "financial_dispute" },
  { phrase: "dispute with my bank", category: "financial_dispute" },
  { phrase: "disputing with my bank", category: "financial_dispute" },
  { phrase: "contact my bank", category: "financial_dispute" },
  { phrase: "report fraud", category: "financial_dispute" },
];

export function runGuard(message: string): Guard {
  const text = message.toLowerCase();
  for (const s of SIGNALS) {
    if (text.includes(s.phrase)) {
      return {
        force_escalation: true,
        reason: `Hard signal detected (${s.category})`,
        matched_phrase: s.phrase,
      };
    }
  }
  return { force_escalation: false, reason: null, matched_phrase: null };
}
