// Step 4a — Parallel Decomposer (Component 2).
//
// Job: turn the classification into the work plan that makes the parallel
// fan-out possible. A mixed ticket is split into independent sub-problems
// (one domain each: SP-1, SP-2, …); a single issue emits exactly one;
// an unknown/ambiguous ticket emits one SAFE sub-problem (policy review).
//
// Pure function — no DB / HTTP / LLM. Reads `message` + `classification`,
// writes `sub_problems[]`. Boundary rule: only types are imported, never
// another component's logic.
import type { AgentDomain, Classification, SubProblem } from "../contracts/types";

// Local keyword sets (kept independent of the classifier on purpose). Used only
// to attribute a clause of the message to the right domain so each sub-problem
// carries a meaningful, domain-specific description.
const DOMAIN_KEYWORDS: Record<AgentDomain, string[]> = {
  technical: [
    "crash", "crashes", "crashed", "error", "bug", "login", "log in", "logged",
    "loading", "load", "broken", "not working", "doesn't work", "freeze", "frozen",
    "slow", "500", "404", "page", "app", "screen", "button", "glitch", "down",
  ],
  billing: [
    "charge", "charged", "charges", "refund", "refunded", "invoice", "payment",
    "billed", "billing", "subscription", "card", "double", "twice", "$", "money",
    "overcharged", "receipt", "transaction", "price", "cost",
  ],
  policy: [
    "policy", "eligible", "eligibility", "terms", "allowed", "cancel", "cancellation",
    "warranty", "rules", "entitled", "return", "deadline", "expire", "expired",
    "agreement", "contract",
  ],
};

const MAX_DESCRIPTION = 200;

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function cap(text: string, max = MAX_DESCRIPTION): string {
  const t = clean(text);
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

// Break the message into independent clauses so each domain can be paired with
// the part of the message it actually refers to. Splits on common connectors
// and sentence punctuation; falls back to the whole message if nothing splits.
function segment(message: string): string[] {
  const parts = message
    .split(/\b(?:and also|and|also|plus|but|however|additionally|as well as)\b|[.;\n!?]+/i)
    .map(clean)
    .filter((s) => s.length >= 3);
  return parts.length > 0 ? parts : [clean(message)];
}

function scoreClause(clause: string, domain: AgentDomain): number {
  const text = clause.toLowerCase();
  return DOMAIN_KEYWORDS[domain].reduce((n, k) => (text.includes(k) ? n + 1 : n), 0);
}

// Pick the clause that best matches the domain. If no clause matches, fall back
// to a domain-labelled snippet of the full message so the description is never
// empty or misleading.
function describe(domain: AgentDomain, clauses: string[], message: string): string {
  let best = "";
  let bestScore = 0;
  for (const clause of clauses) {
    const score = scoreClause(clause, domain);
    if (score > bestScore) {
      bestScore = score;
      best = clause;
    }
  }
  if (bestScore > 0 && best) return cap(best);
  return cap(`${domain[0].toUpperCase()}${domain.slice(1)} issue: ${message}`);
}

function safeDomain(intent: Classification["primary_intent"]): AgentDomain {
  // unknown / mixed (no concrete domain) → safe policy review route.
  return intent === "unknown" || intent === "mixed" ? "policy" : (intent as AgentDomain);
}

function singleSubProblem(message: string, classification: Classification): SubProblem[] {
  return [
    {
      id: "SP-1",
      domain: safeDomain(classification.primary_intent),
      description: cap(message),
    },
  ];
}

export function runDecomposer(message: string, classification: Classification): SubProblem[] {
  // Single issue (or no multi-issue signal) → exactly one sub-problem.
  if (!classification.is_multi_issue) return singleSubProblem(message, classification);

  // Multi-issue → one sub-problem per confident, concrete domain.
  const confidentDomains = classification.intents
    .filter((i) => i.confidence >= 0.6 && (i.type === "technical" || i.type === "billing" || i.type === "policy"))
    .map((i) => i.type as AgentDomain);

  // Dedupe while preserving order (intents arrive sorted by confidence desc).
  const domains = [...new Set(confidentDomains)];

  // Multi flagged but nothing concrete crossed the bar → safe single route.
  if (domains.length === 0) return singleSubProblem(message, classification);

  const clauses = segment(message);

  return domains.map((domain, idx) => ({
    id: `SP-${idx + 1}`,
    domain,
    description: describe(domain, clauses, message),
  }));
}
