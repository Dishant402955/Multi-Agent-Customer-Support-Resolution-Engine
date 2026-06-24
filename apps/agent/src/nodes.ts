// Pipeline nodes. Each takes the current state and returns a partial update
// (new fields + audit events). Shared by both the LangGraph graph (graph.ts)
// and the linear fallback runner (pipeline.ts).
import { audit, type AgentDomain, type PipelineState } from "./contracts/types";
import { runGuard } from "./steps/guard";
import { runClassifier } from "./steps/classifier";
import { runSentiment } from "./steps/sentiment";
import { runDecomposer } from "./steps/decomposer";
import { runOrchestrator } from "./steps/orchestrator";
import { runSeverity } from "./steps/severity";
import { shouldEscalate, runEscalation } from "./steps/escalation";
import { runSynthesizer } from "./steps/synthesizer";

export async function guardNode(s: PipelineState): Promise<Partial<PipelineState>> {
  const guard = runGuard(s.message);
  return {
    guard,
    audit_trail: [
      audit(
        "guard",
        "Hard-signal guard",
        guard.force_escalation
          ? `Hard signal: "${guard.matched_phrase}" → force escalation`
          : "No hard signal detected"
      ),
    ],
  };
}

export async function classifyNode(s: PipelineState): Promise<Partial<PipelineState>> {
  const classification = runClassifier(s.message);
  const top = classification.intents.map((i) => `${i.type} ${i.confidence.toFixed(2)}`).join(", ");
  return {
    classification,
    audit_trail: [
      audit(
        "classify",
        "Intent classifier",
        `${classification.primary_intent}${classification.fallback ? " (fallback)" : ""} [${top}]`
      ),
    ],
  };
}

export async function sentimentNode(s: PipelineState): Promise<Partial<PipelineState>> {
  const sentiment = runSentiment(s.message);
  return {
    sentiment,
    audit_trail: [audit("sentiment", "Sentiment detector", `${sentiment.label} (${sentiment.score})`)],
  };
}

export async function decomposeNode(s: PipelineState): Promise<Partial<PipelineState>> {
  const sub_problems = runDecomposer(s.message, s.classification!);
  return {
    sub_problems,
    audit_trail: [
      audit(
        "decompose",
        "Decomposer",
        sub_problems.length > 1
          ? `Split into ${sub_problems.length} sub-problems: ${sub_problems.map((p) => p.domain).join(", ")}`
          : `Single issue → ${sub_problems[0]?.domain}`
      ),
    ],
  };
}

export async function investigateNode(s: PipelineState): Promise<Partial<PipelineState>> {
  const subs = s.sub_problems || [];
  const { reports, investigation } = await runOrchestrator(subs, s.message, s.history);
  const events = reports.map((r) =>
    audit(
      "agent",
      `${r.agent} agent`,
      `${r.status} — ${r.findings[0] || "no findings"}${r.evidence.length ? ` [${r.evidence.join(", ")}]` : ""}`
    )
  );
  events.push(audit("merge", "Orchestrator", `Merged ${reports.length} report(s) → ${investigation.overall_status}`));
  return { agent_reports: reports, investigation, audit_trail: events };
}

export async function severityNode(s: PipelineState): Promise<Partial<PipelineState>> {
  const severity = runSeverity(s.message, s.agent_reports || [], s.investigation!, s.sentiment!);
  return {
    severity,
    audit_trail: [audit("severity", "Severity assessor", `${severity.level} / ${severity.priority}`)],
  };
}

export async function escalationNode(s: PipelineState): Promise<Partial<PipelineState>> {
  const gate = shouldEscalate({
    guard: s.guard!,
    investigation: s.investigation!,
    severity: s.severity!,
    sentiment: s.sentiment!,
    messageCount: s.message_count,
  });

  if (!gate.escalate) {
    return {
      escalation: { escalate: false },
      audit_trail: [audit("escalation_gate", "Escalation gate", "No escalation needed")],
    };
  }

  const primaryDomain: AgentDomain =
    (s.sub_problems?.[0]?.domain as AgentDomain) ||
    (s.classification?.primary_intent as AgentDomain) ||
    "policy";
  const escalation = runEscalation(gate.reasons, s.severity!, primaryDomain);
  return {
    escalation,
    audit_trail: [
      audit("escalation_gate", "Escalation gate", `Escalate: ${gate.reasons.join("; ")}`),
      audit("escalation", "Escalation agent", `Handoff → ${escalation.recommended_team} (${escalation.urgency})`),
    ],
  };
}

export async function synthesizeNode(s: PipelineState): Promise<Partial<PipelineState>> {
  const resolution = runSynthesizer(s.agent_reports || [], s.escalation);
  return {
    resolution,
    audit_trail: [audit("synthesize", "Response synthesizer", resolution.summary)],
  };
}
