// Common specialist-agent interface.
//
// IMPORTANT (independent development):
// Every specialist is a PURE FUNCTION `(sub, ctx) => AgentReport`. It has no
// external dependencies (no DB, no HTTP, no LLM) and can be imported and called
// on its own — see src/cli.ts `agent <domain>` and the README. To add a new
// agent: implement SpecialistAgent and register it in registry.ts.
import type { AgentDomain, AgentReport, Message, SubProblem } from "../contracts/types";

export interface AgentContext {
  message: string;
  history: Message[];
}

export interface SpecialistAgent {
  domain: AgentDomain;
  run(sub: SubProblem, ctx: AgentContext): AgentReport;
}

/** Helper for building a report so each agent stays terse. */
export function report(
  domain: AgentDomain,
  sub: SubProblem,
  fields: Partial<AgentReport>
): AgentReport {
  return {
    agent: domain,
    sub_problem_id: sub.id,
    findings: [],
    actions: [],
    reasoning: "",
    evidence: [],
    status: "needs_info",
    confidence: 0.5,
    ...fields,
  };
}
