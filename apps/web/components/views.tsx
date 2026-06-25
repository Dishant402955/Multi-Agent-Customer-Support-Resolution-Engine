"use client";
import { useState } from "react";
import { Check, ChevronRight, Loader2 } from "lucide-react";
import type { AuditEvent, PipelineState, PipelineStepId, RunProgress, StepKind } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

function statusVariant(status: string) {
  if (status === "resolved") return "success" as const;
  if (status === "failed" || status === "unresolved") return "destructive" as const;
  return "warning" as const;
}

/** Small chip marking whether a step reasoned with the LLM or a rule. */
export function KindTag({ kind }: { kind?: StepKind }) {
  if (!kind) return null;
  const llm = kind === "llm";
  return (
    <span
      className={
        "rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide " +
        (llm ? "bg-foreground text-background" : "border border-border text-muted-foreground")
      }
      title={llm ? "Reasoned with the LLM" : "Deterministic rule (no LLM)"}
    >
      {llm ? "LLM" : "rule"}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border px-4 py-4 last:border-b-0">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid grid-cols-[80px_1fr_36px] items-center gap-2">
      <span className="truncate text-xs capitalize text-muted-foreground">{label}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-foreground/70" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="text-right text-[11px] tabular-nums text-muted-foreground">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

/**
 * The analytical breakdown for one run — rendered in the right-hand panel.
 * Deliberately scoped to the "what was decided" views (classification,
 * decomposition, severity, escalation). The step-by-step activity + audit trail
 * live inline in the chat instead (see ChatActivity).
 */
export function RunDetails({ s }: { s: PipelineState }) {
  const c = s.classification;
  const subs = s.sub_problems || [];
  const sev = s.severity;
  const esc = s.escalation;

  return (
    <div className="text-sm">
      <Section title="Snapshot">
        <div className="flex flex-wrap gap-1.5">
          {c && <Badge variant="secondary">{c.primary_intent}</Badge>}
          {c?.is_multi_issue && <Badge variant="outline">multi-issue</Badge>}
          {c?.fallback && <Badge variant="warning">fallback</Badge>}
          {sev && <Badge variant={sev.level === "high" ? "destructive" : "secondary"}>severity {sev.level}</Badge>}
          {sev && <Badge variant="outline">{sev.priority}</Badge>}
          {esc?.escalate && <Badge variant="destructive">escalated</Badge>}
          {s.guard?.force_escalation && <Badge variant="destructive">hard signal</Badge>}
        </div>
      </Section>

      {s.guard?.force_escalation && (
        <Section title="Guard">
          <p className="text-muted-foreground">
            {s.guard.reason}
            {s.guard.matched_phrase ? (
              <>
                {" "}— <code className="rounded bg-secondary px-1.5 py-0.5">{s.guard.matched_phrase}</code>
              </>
            ) : null}
          </p>
        </Section>
      )}

      {c && c.intents.length > 0 && (
        <Section title="Classification">
          <div className="space-y-2">
            {c.intents.map((i) => (
              <Bar key={i.type} label={i.type} value={i.confidence} />
            ))}
          </div>
        </Section>
      )}

      {subs.length > 0 && (
        <Section title={subs.length > 1 ? `Decomposition · ${subs.length} sub-problems` : "Decomposition"}>
          <div className="space-y-1.5">
            {subs.map((sp) => (
              <div key={sp.id} className="flex gap-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{sp.id}</span>
                <span className="text-muted-foreground">{sp.domain}:</span>
                <span className="flex-1">{sp.description}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {(sev || s.sentiment) && (
        <Section title="Sentiment · Severity · Escalation">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {s.sentiment && <Badge variant="outline">tone: {s.sentiment.label}</Badge>}
            {sev && <Badge variant="outline">severity: {sev.level}</Badge>}
            {sev && <Badge variant="outline">priority: {sev.priority}</Badge>}
          </div>
          {sev && <p className="text-xs text-muted-foreground">{sev.reasoning}</p>}
          {esc?.escalate && (
            <div className="mt-2 rounded-md border border-foreground/40 p-3">
              <div className="text-sm font-medium">
                Escalation → {esc.recommended_team} ({esc.urgency})
              </div>
              {esc.assigned_agent && (
                <p className="mt-1 text-xs">
                  Assigned to <span className="font-medium">{esc.assigned_agent.name}</span> ·{" "}
                  {esc.assigned_agent.title} · {esc.assigned_agent.department}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">{esc.reason}</p>
              {esc.internal_actions?.length ? (
                <ul className="ml-4 mt-1.5 list-disc text-xs text-muted-foreground">
                  {esc.internal_actions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline (in-chat) activity — the Cursor-style "what the agents did" log.
// ---------------------------------------------------------------------------

export const PIPELINE_STEPS: { id: PipelineStepId; label: string; kind: StepKind }[] = [
  { id: "guard", label: "Screening for hard signals", kind: "heuristic" },
  { id: "classify", label: "Classifying intent", kind: "llm" },
  { id: "sentiment", label: "Reading sentiment", kind: "heuristic" },
  { id: "decompose", label: "Splitting into sub-problems", kind: "llm" },
  { id: "investigate", label: "Specialist agents investigating", kind: "llm" },
  { id: "severity", label: "Assessing severity", kind: "heuristic" },
  { id: "escalation", label: "Checking escalation", kind: "heuristic" },
  { id: "synthesize", label: "Composing your reply", kind: "llm" },
];

function stepStatus(
  id: PipelineStepId,
  progress: RunProgress
): "done" | "running" | "idle" {
  if (progress.completedSteps.includes(id)) return "done";
  if (progress.activeStep === id) return "running";
  return "idle";
}

/** Live stepper driven by real SSE events (not a fake timer). */
export function LiveSteps({ progress }: { progress: RunProgress }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <div className="space-y-1.5">
        {PIPELINE_STEPS.map((step) => {
          const status = stepStatus(step.id, progress);
          const done = status === "done";
          const active = status === "running";
          const agents =
            step.id === "investigate" && progress.agentsDone.length > 0
              ? ` (${progress.agentsDone.join(", ")})`
              : "";
          return (
            <div key={step.id} className="flex items-center gap-2 text-xs">
              <span className="flex size-4 shrink-0 items-center justify-center">
                {done ? (
                  <Check className="size-3.5 text-foreground" />
                ) : active ? (
                  <Loader2 className="size-3.5 animate-spin text-foreground" />
                ) : (
                  <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                )}
              </span>
              <span className={done || active ? "text-foreground" : "text-muted-foreground/50"}>
                {step.label}
                {agents}
              </span>
              {(done || active) && <KindTag kind={step.kind} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Audit trail that grows in real time while the pipeline runs. */
export function LiveAuditTrail({ audit }: { audit: AuditEvent[] }) {
  if (!audit.length) return null;
  return (
    <div className="mt-2 rounded-lg border border-border bg-card/40 p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Live trace
      </p>
      <ol className="max-h-48 space-y-2 overflow-y-auto">
        {audit.map((e, i) => (
          <li key={i} className="text-[11px]">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-muted-foreground">
                {new Date(e.timestamp).toLocaleTimeString()}
              </span>
              <KindTag kind={e.kind} />
              <span className="font-medium">{e.actor}</span>
            </div>
            <p className="mt-0.5 text-muted-foreground">{e.summary}</p>
            {e.detail && (
              <p className="mt-0.5 border-l border-border pl-2 italic text-muted-foreground/80">
                {e.detail}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Collapsible trace attached to a reply: which agents ran + the audit trail. */
export function ChatActivity({ s }: { s: PipelineState }) {
  const [open, setOpen] = useState(false);
  const reports = s.agent_reports || [];
  const trail = s.audit_trail || [];
  const agentCount = reports.length;

  return (
    <div className="rounded-lg border border-border bg-card/50">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight className={"size-3.5 transition-transform " + (open ? "rotate-90" : "")} />
        <span className="font-medium">
          Worked across {agentCount || "the"} {agentCount === 1 ? "agent" : "agents"} · {trail.length} steps
        </span>
        <span className="ml-auto flex flex-wrap justify-end gap-1">
          {reports.map((r) => (
            <Badge key={r.sub_problem_id + r.agent} variant={statusVariant(r.status)}>
              {r.agent}
            </Badge>
          ))}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          {reports.length > 0 && (
            <div className="space-y-2">
              {reports.map((r) => (
                <div key={r.sub_problem_id + r.agent} className="text-xs">
                  <div className="flex items-center gap-2">
                    <strong className="capitalize">{r.agent} agent</strong>
                    <Badge variant={r.clarification_needed ? "warning" : statusVariant(r.status)}>
                      {r.clarification_needed ? "needs info" : r.status}
                    </Badge>
                    <span className="ml-auto tabular-nums text-muted-foreground">
                      {r.duration_ms != null ? `${r.duration_ms}ms · ` : ""}
                      {Math.round(r.confidence * 100)}%
                    </span>
                  </div>
                  {(r.findings[0] || r.clarification_question) && (
                    <p className="mt-1 text-muted-foreground">
                      {r.clarification_question || r.findings[0]}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {trail.length > 0 && (
            <ol className="space-y-2.5 border-t border-border pt-3">
              {trail.map((e, i) => (
                <li key={i} className="text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-muted-foreground">
                      {new Date(e.timestamp).toLocaleTimeString()}
                    </span>
                    <KindTag kind={e.kind} />
                    <span className="font-medium">{e.actor}</span>
                  </div>
                  <p className="mt-0.5 text-muted-foreground">{e.summary}</p>
                  {e.detail && (
                    <p className="mt-0.5 border-l border-border pl-2 italic text-muted-foreground/80">
                      {e.detail}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
