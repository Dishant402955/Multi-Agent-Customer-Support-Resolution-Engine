"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, GitBranch, Loader2, MessageSquare, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDashboardTicket } from "@/lib/api";
import { useRequireRole } from "@/lib/auth";
import type { TicketDashboardDetail } from "@/lib/types";
import { LifecycleStepper, RunTraceCard } from "@/components/views";

/**
 * Standalone, full-page trace viewer — opened in a new tab from the tickets,
 * escalations, and observability consoles. Shows the whole conversation's
 * pipeline runs end-to-end so the inline dashboards stay lightweight.
 */
export default function TracePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
          Loading trace…
        </div>
      }
    >
      <TraceView />
    </Suspense>
  );
}

function TraceView() {
  const account = useRequireRole("admin", "agent");
  const params = useParams<{ ticketId: string }>();
  const search = useSearchParams();
  const ticketId = decodeURIComponent(String(params?.ticketId ?? ""));
  const focusRun = search.get("run");

  const [detail, setDetail] = useState<TicketDashboardDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!account || !ticketId) return;
    let alive = true;
    setLoading(true);
    getDashboardTicket(ticketId).then((d) => {
      if (alive) {
        setDetail(d);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [account, ticketId]);

  const latest = detail?.runs?.[detail.runs.length - 1]?.state ?? null;
  const focusIdx = useMemo(() => {
    if (!detail) return -1;
    if (focusRun) {
      const i = detail.runs.findIndex((r) => r.run_id === focusRun);
      if (i >= 0) return i;
    }
    return detail.runs.length - 1;
  }, [detail, focusRun]);

  if (!account) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Standalone header */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md">
        <Link href="/observability">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="size-4" /> Back
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <Workflow className="size-4 text-primary" />
          <span className="text-sm font-semibold tracking-tight">Pipeline trace</span>
        </div>
        {detail && (
          <span className="font-mono text-[11px] text-muted-foreground">{detail.ticket.display_id}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Link href={`/?ticket=${ticketId}`} target="_blank">
            <Button variant="outline" size="sm" className="gap-1.5">
              <MessageSquare className="size-3.5" /> Conversation
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading trace…
          </div>
        ) : !detail ? (
          <div className="py-24 text-center text-sm text-muted-foreground">
            Trace not found or you don&apos;t have access.
          </div>
        ) : (
          <>
            {/* Ticket summary band */}
            <div className="mb-6 rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                  <GitBranch className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h1 className="text-base font-semibold leading-tight">{detail.ticket.title}</h1>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {detail.ticket.customer_name}
                    {detail.ticket.customer_id ? ` (${detail.ticket.customer_id})` : " (guest)"} ·{" "}
                    {detail.ticket.message_count} msg · {detail.runs.length} run
                    {detail.runs.length === 1 ? "" : "s"} ·{" "}
                    {new Date(detail.ticket.created_at).toLocaleString()}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {detail.ticket.primary_intent && (
                      <Badge variant="outline">intent: {detail.ticket.primary_intent}</Badge>
                    )}
                    {detail.ticket.severity && (
                      <Badge variant="outline">severity: {detail.ticket.severity}</Badge>
                    )}
                    {detail.ticket.priority && <Badge variant="outline">{detail.ticket.priority}</Badge>}
                    {detail.escalation && (
                      <Badge variant="destructive">escalated → {detail.escalation.assignee_name}</Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {latest && (
              <section className="mb-6 rounded-2xl border border-border bg-card p-5">
                <LifecycleStepper s={latest} />
              </section>
            )}

            <section>
              <h2 className="mb-1 text-sm font-semibold">
                Pipeline runs{" "}
                <span className="text-xs font-normal text-muted-foreground">({detail.runs.length})</span>
              </h2>
              <p className="mb-4 text-xs text-muted-foreground">
                Each customer message triggers one run. Expand to inspect agent investigations and the full
                audit trace.
              </p>
              <div className="space-y-3">
                {detail.runs.length === 0 && (
                  <p className="text-sm text-muted-foreground">No pipeline runs recorded.</p>
                )}
                {detail.runs.map((run, idx) => (
                  <RunTraceCard
                    key={run.run_id}
                    run={run}
                    index={idx + 1}
                    defaultOpen={idx === focusIdx}
                  />
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
