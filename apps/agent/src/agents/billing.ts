// Billing specialist — charges, refunds, invoices.
// HARD-CODED responses (no external service, no LLM).
import type { AgentReport, SubProblem } from "../contracts/types";
import { report, type AgentContext, type SpecialistAgent } from "./base";

export function investigateBilling(sub: SubProblem, ctx: AgentContext): AgentReport {
  const text = ctx.message.toLowerCase();

  if (text.includes("twice") || text.includes("double") || text.includes("duplicate")) {
    return report("billing", sub, {
      findings: ["Two identical $29.99 charges on the same day (INV-123, INV-124)."],
      actions: ["Refund the duplicate $29.99 charge (INV-124)."],
      reasoning: "Duplicate invoices on the same date always warrant a refund.",
      evidence: ["INV-123", "INV-124"],
      status: "resolved",
      confidence: 0.91,
    });
  }
  if (text.includes("refund")) {
    return report("billing", sub, {
      findings: ["Refund request reviewed against the most recent charge (INV-123)."],
      actions: ["Initiate refund for INV-123.", "Send confirmation email."],
      reasoning: "Charge is within the refund window and eligible.",
      evidence: ["INV-123"],
      status: "resolved",
      confidence: 0.82,
    });
  }
  return report("billing", sub, {
    findings: ["Reviewed recent charges; no anomaly detected automatically."],
    actions: ["Confirm the specific charge date/amount with the customer."],
    reasoning: "Insufficient detail to confirm a billing error.",
    evidence: [],
    status: "needs_info",
    confidence: 0.55,
  });
}

export const billingAgent: SpecialistAgent = {
  domain: "billing",
  run: investigateBilling,
};
