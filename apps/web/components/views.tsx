"use client";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  FileText,
  Gauge,
  HelpCircle,
  ShieldAlert,
  Workflow,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { AgentReport, PipelineState } from "@/lib/types";

function statusVariant(status: string) {
  if (status === "resolved") return "success" as const;
  if (status === "failed" || status === "unresolved") return "destructive" as const;
  return "warning" as const;
}

function ConfidenceBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid grid-cols-[90px_1fr_44px] items-center gap-3">
      <span className="text-sm capitalize text-muted-foreground">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="text-right text-xs text-muted-foreground">{Math.round(value * 100)}%</span>
    </div>
  );
}

export function ClassificationCard({ s }: { s: PipelineState }) {
  const c = s.classification;
  if (!c) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Workflow className="text-primary" /> Classification
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={c.primary_intent === "mixed" ? "default" : "secondary"}>
            {c.primary_intent}
          </Badge>
          {c.is_multi_issue && <Badge>multi-issue → split</Badge>}
          {c.fallback && <Badge variant="warning">low confidence → fallback</Badge>}
        </div>
        <div className="space-y-2">
          {c.intents.map((i) => (
            <ConfidenceBar key={i.type} label={i.type} value={i.confidence} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AgentReportItem({ r }: { r: AgentReport }) {
  return (
    <div className="rounded-lg border bg-background/40 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Boxes className="size-4 text-primary" />
        <strong className="capitalize">{r.agent} agent</strong>
        {r.clarification_needed ? (
          <Badge variant="warning">
            <HelpCircle className="mr-1 size-3" /> needs clarification
          </Badge>
        ) : (
          <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          conf {Math.round(r.confidence * 100)}%
        </span>
      </div>
      {r.clarification_needed && (r.clarification_question || r.findings[0]) && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <HelpCircle className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <div>
            <div className="font-medium text-foreground">We need a bit more detail</div>
            <p className="text-muted-foreground">
              {r.clarification_question || r.findings[0]}
            </p>
          </div>
        </div>
      )}
      {!r.clarification_needed && r.findings.length > 0 && (
        <ul className="ml-4 list-disc space-y-1 text-sm">
          {r.findings.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-sm italic text-muted-foreground">{r.reasoning}</p>
      {r.evidence.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Evidence:{" "}
          {r.evidence.map((e, i) => (
            <code key={i} className="mr-1 rounded bg-secondary px-1.5 py-0.5">
              {e}
            </code>
          ))}
        </p>
      )}
    </div>
  );
}

export function InvestigationCard({ s }: { s: PipelineState }) {
  const reports = s.agent_reports || [];
  const subs = s.sub_problems || [];
  if (!reports.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="text-primary" /> Investigation
          {reports.length > 1 && <Badge>parallel</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {subs.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {subs.map((sp) => (
              <Badge key={sp.id} variant="secondary">
                {sp.id}: {sp.domain}
              </Badge>
            ))}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {reports.map((r) => (
            <AgentReportItem key={r.sub_problem_id + r.agent} r={r} />
          ))}
        </div>
        {s.investigation && (
          <p className="text-sm text-muted-foreground">
            Merged → <strong className="text-foreground">{s.investigation.overall_status}</strong>
            {s.investigation.conflicts.length > 0 &&
              ` · conflicts: ${s.investigation.conflicts.join("; ")}`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function UrgencyCard({ s }: { s: PipelineState }) {
  if (!s.severity && !s.sentiment) return null;
  const sev = s.severity;
  const esc = s.escalation;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="text-primary" /> Sentiment, Severity &amp; Escalation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {s.sentiment && (
            <Badge
              variant={
                s.sentiment.label === "angry"
                  ? "destructive"
                  : s.sentiment.label === "frustrated"
                  ? "warning"
                  : "success"
              }
            >
              sentiment: {s.sentiment.label} ({s.sentiment.score})
            </Badge>
          )}
          {sev && (
            <Badge variant={sev.level === "high" ? "destructive" : sev.level === "medium" ? "warning" : "success"}>
              severity: {sev.level}
            </Badge>
          )}
          {sev && <Badge variant="secondary">priority: {sev.priority}</Badge>}
          {esc?.escalate && (
            <Badge variant="destructive">
              <ShieldAlert className="mr-1 size-3" /> escalated
            </Badge>
          )}
        </div>
        {sev && <p className="text-sm text-muted-foreground">{sev.reasoning}</p>}
        {esc?.escalate && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="size-4 text-destructive" />
              Escalation → {esc.recommended_team} ({esc.urgency})
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{esc.reason}</p>
            {esc.internal_actions?.length ? (
              <ul className="ml-4 mt-2 list-disc text-sm">
                {esc.internal_actions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ResolutionCard({ s }: { s: PipelineState }) {
  const r = s.resolution;
  if (!r) return null;
  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="text-primary" /> Resolution
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-base font-medium">{r.summary}</p>
        {r.findings.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Findings</p>
            <ul className="ml-4 list-disc space-y-1 text-sm">
              {r.findings.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        )}
        {r.actions.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next steps</p>
            <ul className="ml-4 list-disc space-y-1 text-sm">
              {r.actions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        )}
        <Separator />
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reasoning</p>
          <p className="text-sm italic text-muted-foreground">{r.reasoning}</p>
        </div>
        {r.evidence.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Evidence:{" "}
            {r.evidence.map((e, i) => (
              <code key={i} className="mr-1 rounded bg-secondary px-1.5 py-0.5">
                {e}
              </code>
            ))}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function AuditCard({ s }: { s: PipelineState }) {
  if (!s.audit_trail?.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="text-primary" /> Audit trail
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {s.audit_trail.map((e, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-xs text-muted-foreground">
                {new Date(e.timestamp).toLocaleTimeString()}
              </span>
              <Badge variant="secondary">{e.step}</Badge>
              <strong>{e.actor}</strong>
              <span className="text-muted-foreground">{e.summary}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
