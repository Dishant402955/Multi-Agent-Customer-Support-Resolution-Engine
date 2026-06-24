// Policy specialist — eligibility, terms, refund windows.
// HARD-CODED responses (no external service, no LLM). Also the safe route for
// low-confidence / unknown tickets.
import type { AgentReport, SubProblem } from "../contracts/types";
import { report, type AgentContext, type SpecialistAgent } from "./base";

export function investigatePolicy(sub: SubProblem, ctx: AgentContext): AgentReport {
  const text = ctx.message.toLowerCase();
  const over30 = /\b(3[1-9]|[4-9][0-9]|[0-9]{3,})\s*days?\b/.test(text);
  const within30 = /\b([0-9]|[12][0-9]|30)\s*days?\b/.test(text);

  if (over30) {
    return report("policy", sub, {
      findings: ["Request falls outside the 30-day refund window (Policy 4.2)."],
      actions: ["Explain the policy; offer goodwill credit if applicable."],
      reasoning: "Policy 4.2 limits automatic refunds to 30 days.",
      evidence: ["Policy 4.2"],
      status: "resolved",
      confidence: 0.8,
    });
  }
  if (within30) {
    return report("policy", sub, {
      findings: ["Request is within the 30-day window — eligible (Policy 4.2)."],
      actions: ["Approve under standard policy."],
      reasoning: "Within the documented eligibility window.",
      evidence: ["Policy 4.2"],
      status: "resolved",
      confidence: 0.8,
    });
  }
  return report("policy", sub, {
    findings: ["Routed here for review — intent was unclear or ambiguous."],
    actions: ["Ask a clarifying question to pin down the request."],
    reasoning: "Safe fallback route; not enough signal to commit to a domain.",
    evidence: ["Policy 4.2"],
    status: "needs_info",
    confidence: 0.5,
  });
}

export const policyAgent: SpecialistAgent = {
  domain: "policy",
  run: investigatePolicy,
};
