// Step 4b — Orchestrator.
//
// Two halves with two owners (see README build plan):
//   • FAN-OUT  (Component 2 · Parallel Decomposer) — runs the right specialist
//     for each sub-problem IN PARALLEL and is resilient to a single agent
//     failing. Awaits each agent so it works whether agents are sync (base)
//     or async (LLM-backed branch).
//   • MERGE    (Component 4 · Output Combiner) — collapses the reports into one
//     investigation (overall_status + conflicts).
//
// `runOrchestrator` keeps a stable signature so nodes/CLI stay unchanged.
import type { AgentContext } from "../agents/base";
import type { AgentReport, Investigation, Message, SubProblem } from "../contracts/types";
import { getAgent } from "../agents/registry";

function failedReport(sub: SubProblem, message: string): AgentReport {
  return {
    agent: sub.domain,
    sub_problem_id: sub.id,
    findings: [],
    actions: [],
    reasoning: `Agent failed: ${message}`,
    evidence: [],
    status: "failed",
    confidence: 0,
  };
}

// FAN-OUT (Component 2). True parallel fan-out via Promise.all. Each agent is
// isolated in its own try/catch so one failure never sinks the others; awaiting
// the result supports both sync and async (Promise-returning) specialists.
export async function fanOut(subProblems: SubProblem[], ctx: AgentContext): Promise<AgentReport[]> {
  return Promise.all(
    subProblems.map(async (sub) => {
      try {
        return await getAgent(sub.domain).run(sub, ctx);
      } catch (err) {
        return failedReport(sub, (err as Error).message);
      }
    })
  );
}

// MERGE (Component 4 boundary). Kept here so `runOrchestrator` returns a ready
// investigation; the Output Combiner owns the deeper synthesis downstream.
function mergeReports(reports: AgentReport[]): Investigation {
  const conflicts: string[] = [];
  const anyFailed = reports.some((r) => r.status === "failed");
  const anyUnresolved = reports.some((r) => r.status === "unresolved" || r.status === "needs_info");
  const anyResolved = reports.some((r) => r.status === "resolved");
  const allResolved = reports.length > 0 && reports.every((r) => r.status === "resolved");

  if (anyResolved && anyUnresolved) {
    conflicts.push("Mixed agent outcomes — some resolved, some need more info.");
  }

  const overall_status: Investigation["overall_status"] = allResolved
    ? "resolved"
    : anyFailed || (!anyUnresolved && !allResolved)
    ? "unresolved"
    : "partial";

  return { overall_status, conflicts };
}

export async function runOrchestrator(
  subProblems: SubProblem[],
  message: string,
  history: Message[]
): Promise<{ reports: AgentReport[]; investigation: Investigation }> {
  const ctx: AgentContext = { message, history };
  const reports = await fanOut(subProblems, ctx);
  const investigation = mergeReports(reports);
  return { reports, investigation };
}
