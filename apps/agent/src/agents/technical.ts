// Technical specialist — crashes, errors, troubleshooting.
// HARD-CODED responses (no external service, no LLM). Light keyword switch so
// the demo shows relevant content. Swap this body for real logic later — the
// signature stays the same.
import type { AgentReport, SubProblem } from "../contracts/types";
import { report, type AgentContext, type SpecialistAgent } from "./base";

export function investigateTechnical(sub: SubProblem, ctx: AgentContext): AgentReport {
  const text = ctx.message.toLowerCase();

  if (text.includes("login") || text.includes("log in") || text.includes("crash")) {
    return report("technical", sub, {
      findings: ["Crash on login matches known issue E-102 (stale auth cache)."],
      actions: ["Clear the app cache, then sign in again.", "Update to the latest app version."],
      reasoning: "Symptom matches documented issue E-102, which has a known workaround.",
      evidence: ["E-102"],
      status: "resolved",
      confidence: 0.88,
    });
  }
  if (text.includes("loading") || text.includes("slow") || text.includes("stuck")) {
    return report("technical", sub, {
      findings: ["Page stuck loading matches known issue E-200."],
      actions: ["Hard refresh (Ctrl+Shift+R) and clear cookies."],
      reasoning: "Slow/stuck loading is a documented client-cache issue (E-200).",
      evidence: ["E-200"],
      status: "resolved",
      confidence: 0.8,
    });
  }
  return report("technical", sub, {
    findings: ["Reproduced the reported behavior area; no exact known issue matched."],
    actions: ["Collect device + version info.", "Retry after clearing cache."],
    reasoning: "No documented match; provided standard troubleshooting.",
    evidence: [],
    status: "needs_info",
    confidence: 0.55,
  });
}

export const technicalAgent: SpecialistAgent = {
  domain: "technical",
  run: investigateTechnical,
};
