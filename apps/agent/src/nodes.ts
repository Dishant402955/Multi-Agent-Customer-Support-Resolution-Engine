// Pipeline nodes. Each takes the current state and returns a partial update
// (new fields + audit events). Shared by both the LangGraph graph (graph.ts)
// and the linear fallback runner (pipeline.ts).
//
// Each audit event is tagged with `kind` (llm | heuristic) and a `detail`
// "thought" so the chat trail can show *how* each step reasoned. Note: the LLM
// steps (classify, agents, synthesize) fall back to deterministic logic if no
// provider is configured or a call fails — `kind` reflects the designed path.
import { audit, type AgentDomain, type AuditEvent, type PipelineState } from "./contracts/types";
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
          : "No hard signal detected",
        {
          kind: "heuristic",
          detail: guard.force_escalation
            ? `Matched the explicit phrase "${guard.matched_phrase}" (${guard.reason}). The pipeline still runs every step to build handoff context, but escalation is now forced.`
            : "Scanned the message for explicit legal, supervisor-request, and financial-dispute phrases (substring match). None were present, so no hard escalation was forced.",
        }
      ),
    ],
  };
}

export async function classifyNode(s: PipelineState): Promise<Partial<PipelineState>> {
  const classification = await runClassifier(s.message, s.history, s.run_id);
  const top = classification.intents.map((i) => `${i.type} ${i.confidence.toFixed(2)}`).join(", ");
  const why = classification.is_multi_issue
    ? "Two or more domains crossed the multi-issue threshold, so this is handled as a multi-issue ticket."
    : classification.fallback
      ? "The top confidence fell below the threshold, so it routes to a safe policy review rather than guessing."
      : "One domain clearly dominated.";
  return {
    classification,
    audit_trail: [
      audit(
        "classify",
        "Intent classifier",
        `${classification.primary_intent}${classification.fallback ? " (fallback)" : ""} [${top}]`,
        {
          kind: "llm",
          detail: `LLM router (temperature 0) judged which domains the message touches. Confidences: ${top || "none"}. ${why}`,
        }
      ),
    ],
  };
}

export async function sentimentNode(s: PipelineState): Promise<Partial<PipelineState>> {
  const sentiment = runSentiment(s.message);
  return {
    sentiment,
    audit_trail: [
      audit("sentiment", "Sentiment detector", `${sentiment.label} (${sentiment.score})`, {
        kind: "heuristic",
        detail: `Tone scored from emotional keywords, ALL-CAPS words, and exclamation marks → ${sentiment.label} (${sentiment.score}). Used only as a capped nudge to priority, never to decide escalation on its own.`,
      }),
    ],
  };
}

export async function decomposeNode(s: PipelineState): Promise<Partial<PipelineState>> {
  const { subProblems: sub_problems, method } = await runDecomposer(
    s.message,
    s.classification!,
    s.run_id
  );
  const multi = sub_problems.length > 1;
  const lead = method === "llm" ? "LLM split the ticket into independent sub-problems. " : "Rule-based clause/keyword split. ";
  return {
    sub_problems,
    audit_trail: [
      audit(
        "decompose",
        "Decomposer",
        multi
          ? `Split into ${sub_problems.length} sub-problems: ${sub_problems.map((p) => p.domain).join(", ")}`
          : `Single issue → ${sub_problems[0]?.domain}`,
        {
          kind: method === "llm" ? "llm" : "heuristic",
          detail:
            lead +
            (multi
              ? `${sub_problems.length} sub-problems will run in parallel (${sub_problems.map((p) => p.domain).join(", ")}).`
              : `One concrete issue → the ${sub_problems[0]?.domain} specialist.`),
        }
      ),
    ],
  };
}

export async function investigateNode(
  s: PipelineState,
  onAgentDone?: (agent: string, audit: AuditEvent[]) => void
): Promise<Partial<PipelineState>> {
  const subs = s.sub_problems || [];
  const { reports, investigation, timing } = await runOrchestrator(
    subs,
    s.message,
    s.history,
    s.customer_id,
    s.prior_context,
    (agent, report) => {
      onAgentDone?.(agent, [
        audit(
          "agent",
          `${agent} agent`,
          `${report.status} — ${report.findings[0] || "no findings"}`,
          {
            kind: "llm",
            detail:
              (report.reasoning ||
                `Picked a use case, called its scoped tools/KB, and composed an answer (status: ${report.status}).`) +
              (report.duration_ms != null ? ` (took ${report.duration_ms}ms)` : ""),
          }
        ),
      ]);
    }
  );

  const saved = timing.sumMs - timing.wallMs;
  const events = [
    audit("orchestrate", "Orchestrator", `Fan-out: ${reports.length} agent(s) in parallel`, {
      kind: "heuristic",
      detail:
        `Launched ${reports.length} specialist agent(s) concurrently. Wall-clock ${timing.wallMs}ms vs ${timing.sumMs}ms of total agent time` +
        (reports.length > 1 && saved > 0
          ? ` — running in parallel saved ~${saved}ms; the early finishers waited for the slowest before merging.`
          : "."),
    }),
  ];

  for (const r of reports) {
    events.push(
      audit(
        "agent",
        `${r.agent} agent`,
        `${r.status} — ${r.findings[0] || "no findings"}${r.evidence.length ? ` [${r.evidence.join(", ")}]` : ""}`,
        {
          kind: "llm",
          detail:
            (r.reasoning ||
              `Picked a use case, called its scoped tools/KB, and composed an answer (status: ${r.status}).`) +
            (r.duration_ms != null ? ` (took ${r.duration_ms}ms)` : ""),
        }
      )
    );
    for (const t of r.trace ?? []) {
      events.push({
        step: `agent:${t.node}`,
        actor: `${r.agent} ${t.node}`,
        timestamp: t.ts,
        summary: t.message,
        kind: t.node === "tool" || t.node === "kb" ? "heuristic" : "llm",
        ...(t.data ? { detail: JSON.stringify(t.data) } : {}),
      });
    }
  }

  events.push(
    audit("merge", "Orchestrator", `Merged ${reports.length} report(s) → ${investigation.overall_status}`, {
      kind: "heuristic",
      detail: investigation.conflicts.length
        ? `Combined the specialist reports; conflicts detected: ${investigation.conflicts.join("; ")}.`
        : "Combined the specialist reports into one investigation result; no conflicts between findings.",
    })
  );

  return { agent_reports: reports, investigation, audit_trail: events };
}

export async function severityNode(s: PipelineState): Promise<Partial<PipelineState>> {
  const severity = runSeverity(s.agent_reports || [], s.investigation!, s.sentiment!, s.message_count);
  return {
    severity,
    audit_trail: [
      audit("severity", "Severity assessor", `${severity.level} / ${severity.priority}`, {
        kind: "heuristic",
        detail: severity.reasoning,
      }),
    ],
  };
}

export async function escalationNode(s: PipelineState): Promise<Partial<PipelineState>> {
  const gate = shouldEscalate({
    guard: s.guard!,
    investigation: s.investigation!,
    severity: s.severity!,
    sentiment: s.sentiment!,
    messageCount: s.message_count,
    agentReports: s.agent_reports,
  });

  if (!gate.escalate) {
    return {
      escalation: { escalate: false },
      audit_trail: [
        audit("escalation_gate", "Escalation gate", "No escalation needed", {
          kind: "heuristic",
          detail:
            "Impact, agent conflicts, hard signals, and repeat-contact frustration were all within self-serve thresholds, so the engine handles this without a human.",
        }),
      ],
    };
  }

  const primaryDomain: AgentDomain =
    (s.sub_problems?.[0]?.domain as AgentDomain) ||
    (s.classification?.primary_intent as AgentDomain) ||
    "policy";
  const escalation = await runEscalation(gate.reasons, s.severity!, primaryDomain, {
    traceId: s.run_id,
    reports: s.agent_reports,
    investigation: s.investigation,
  });
  return {
    escalation,
    audit_trail: [
      audit("escalation_gate", "Escalation gate", `Escalate: ${gate.reasons.join("; ")}`, {
        kind: "heuristic",
        detail: `The gate opened because: ${gate.reasons.join("; ")}. Escalation is driven by impact/conflict/hard-signal, not mood alone.`,
      }),
      audit("escalation", "Escalation agent", `Handoff → ${escalation.recommended_team} (${escalation.urgency})`, {
        kind: "heuristic",
        detail: `Routed the handoff to ${escalation.recommended_team} at ${escalation.urgency}. A human owner is assigned by the application layer.`,
      }),
    ],
  };
}

export async function synthesizeNode(s: PipelineState): Promise<Partial<PipelineState>> {
  const resolution = await runSynthesizer(s.agent_reports || [], s.escalation, {
    traceId: s.run_id,
    message: s.message,
    history: s.history,
    ticketStatus: s.ticket_status,
    priorContext: s.prior_context,
  });
  return {
    resolution,
    audit_trail: [
      audit("synthesize", "Response synthesizer", resolution.summary, {
        kind: "llm",
        detail:
          "Merged every specialist report into one customer-ready reply via the LLM (temperature 0.3), de-duplicating overlapping points. Evidence and reasoning stay traceable to the agents; falls back to a deterministic template if the model is unavailable.",
      }),
    ],
  };
}
