// Step 4b — Orchestrator. Runs the right specialists IN PARALLEL over the
// sub-problems, then merges their reports into one investigation.
// Agents are synchronous pure functions; we still fan out via Promise.all so
// the structure matches real (async) agents and stays parallel-ready.
import type { AgentReport, Investigation, Message, SubProblem } from "../contracts/types";
import { getAgent } from "../agents/registry";

export async function runOrchestrator(
  subProblems: SubProblem[],
  message: string,
  history: Message[]
): Promise<{ reports: AgentReport[]; investigation: Investigation }> {
  const ctx = { message, history };

  const reports = await Promise.all(
    subProblems.map(async (sub) => {
      try {
        return await getAgent(sub.domain).run(sub, ctx);
      } catch (err) {
        return {
          agent: sub.domain,
          sub_problem_id: sub.id,
          findings: [],
          actions: [],
          reasoning: `Agent failed: ${(err as Error).message}`,
          evidence: [],
          status: "failed" as const,
          confidence: 0,
        };
      }
    })
  );

  const conflicts: string[] = [];
  const anyFailed = reports.some((r) => r.status === "failed");
  const anyUnresolved = reports.some((r) => r.status === "unresolved" || r.status === "needs_info");
  const allResolved = reports.length > 0 && reports.every((r) => r.status === "resolved");

  if (reports.some((r) => r.status === "resolved") && anyUnresolved) {
    conflicts.push("Mixed agent outcomes — some resolved, some need more info.");
  }

  const overall_status: Investigation["overall_status"] = allResolved
    ? "resolved"
    : anyFailed || (!anyUnresolved && !allResolved)
    ? "unresolved"
    : "partial";

  return { reports, investigation: { overall_status, conflicts } };
}
