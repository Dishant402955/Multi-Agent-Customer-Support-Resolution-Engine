"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  MessageSquare,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getDashboardTicket, listDashboardTickets } from "@/lib/api";
import type { AuditEvent, TicketDashboardDetail, TicketDashboardRow, TicketLifecycleStatus } from "@/lib/types";
import { KindTag } from "@/components/views";

type StatusFilter = "all" | TicketLifecycleStatus;

function statusVariant(s: TicketLifecycleStatus) {
  if (s === "escalated") return "destructive" as const;
  if (s === "resolved") return "success" as const;
  return "secondary" as const;
}

export default function TicketsDashboardPage() {
  const [tickets, setTickets] = useState<TicketDashboardRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<TicketDashboardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");

  async function loadList() {
    setLoading(true);
    const list = await listDashboardTickets();
    setTickets(list);
    if (!selectedId && list[0]) setSelectedId(list[0].ticket_id);
    setLoading(false);
  }

  async function loadDetail(id: string) {
    if (!id) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    setDetail(await getDashboardTicket(id));
    setDetailLoading(false);
  }

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tickets.filter((t) => {
      if (filter !== "all" && t.status !== filter) return false;
      if (!q) return true;
      return (
        t.ticket_id.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        t.customer_name.toLowerCase().includes(q) ||
        (t.primary_intent ?? "").toLowerCase().includes(q)
      );
    });
  }, [tickets, query, filter]);

  const stats = useMemo(() => {
    const escalated = tickets.filter((t) => t.status === "escalated").length;
    const resolved = tickets.filter((t) => t.status === "resolved").length;
    const active = tickets.filter((t) => t.status === "active").length;
    return { total: tickets.length, escalated, resolved, active };
  }, [tickets]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <Link href="/">
          <Button variant="ghost" size="icon" title="Back to chat">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-semibold tracking-tight">Tickets dashboard</h1>
          <p className="text-xs text-muted-foreground">All conversations, statuses, and pipeline traces</p>
        </div>
        <Link href="/escalations">
          <Button variant="outline" size="sm">
            Escalations
          </Button>
        </Link>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void loadList()}>
          <RefreshCw className={"size-3.5 " + (loading ? "animate-spin" : "")} /> Refresh
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ── Ticket list ─────────────────────────────────────────── */}
        <aside className="flex w-[380px] shrink-0 flex-col border-r border-border">
          <div className="space-y-2 border-b border-border p-3">
            <div className="grid grid-cols-4 gap-2 text-center">
              <MiniStat label="Total" value={stats.total} />
              <MiniStat label="Active" value={stats.active} />
              <MiniStat label="Escalated" value={stats.escalated} />
              <MiniStat label="Resolved" value={stats.resolved} />
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tickets, customers, intent…"
                className="w-full rounded-md border border-border bg-card py-2 pl-8 pr-3 text-sm outline-none focus:border-foreground/40"
              />
            </div>
            <div className="flex gap-1">
              {(["all", "active", "escalated", "resolved"] as StatusFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={
                    "flex-1 rounded-md px-2 py-1 text-xs capitalize transition-colors " +
                    (filter === f
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-secondary/60")
                  }
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
            {!loading && visible.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">No tickets match.</p>
            )}
            {visible.map((t) => (
              <button
                key={t.ticket_id}
                onClick={() => setSelectedId(t.ticket_id)}
                className={
                  "w-full border-b border-border px-3 py-3 text-left transition-colors hover:bg-secondary/40 " +
                  (selectedId === t.ticket_id ? "bg-secondary/60" : "")
                }
              >
                <div className="flex items-start gap-2">
                  <p className="flex-1 truncate text-sm font-medium">{t.title}</p>
                  <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {t.customer_name} · <span className="font-mono">{t.ticket_id}</span>
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {t.primary_intent && <Badge variant="outline">{t.primary_intent}</Badge>}
                  {t.severity && <Badge variant="outline">{t.severity}</Badge>}
                  {t.priority && <Badge variant="outline">{t.priority}</Badge>}
                  <span className="text-[10px] text-muted-foreground">
                    {t.message_count} msg · {t.run_count} run{t.run_count === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Updated {new Date(t.updated_at).toLocaleString()}
                </p>
              </button>
            ))}
          </div>
        </aside>

        {/* ── Detail: conversation + traces ───────────────────────── */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          {!selectedId ? (
            <p className="p-8 text-sm text-muted-foreground">Select a ticket to view its conversation and traces.</p>
          ) : detailLoading ? (
            <p className="p-8 text-sm text-muted-foreground">Loading ticket…</p>
          ) : !detail ? (
            <p className="p-8 text-sm text-muted-foreground">Ticket not found.</p>
          ) : (
            <TicketDetailPanel detail={detail} />
          )}
        </main>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-card px-2 py-1.5">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function TicketDetailPanel({ detail }: { detail: TicketDashboardDetail }) {
  const { ticket, messages, runs, escalation } = detail;

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{ticket.title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <span className="font-mono">{ticket.ticket_id}</span> · {ticket.customer_name}
            {ticket.customer_id && (
              <span className="ml-1 font-mono text-xs">({ticket.customer_id})</span>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant={statusVariant(ticket.status)}>{ticket.status}</Badge>
            {ticket.primary_intent && <Badge variant="outline">intent: {ticket.primary_intent}</Badge>}
            {ticket.severity && <Badge variant="outline">severity: {ticket.severity}</Badge>}
            {ticket.priority && <Badge variant="outline">{ticket.priority}</Badge>}
          </div>
        </div>
        <div className="flex gap-2">
          {escalation && (
            <Link href="/escalations">
              <Button variant="outline" size="sm">
                View escalation
              </Button>
            </Link>
          )}
          <Link href={`/?ticket=${ticket.ticket_id}`}>
            <Button variant="outline" size="sm" className="gap-2">
              <ExternalLink className="size-3.5" /> Open in chat
            </Button>
          </Link>
        </div>
      </div>

      {escalation && (
        <div className="mt-4 rounded-lg border border-foreground/30 bg-card p-4 text-sm">
          <p className="font-medium">
            Escalation {escalation.status} · {escalation.assignee_name} ({escalation.department})
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{escalation.reason}</p>
        </div>
      )}

      {/* Conversation thread */}
      <section className="mt-6">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
          <MessageSquare className="size-4" /> Conversation ({messages.length} messages)
        </h3>
        <div className="space-y-3 rounded-lg border border-border bg-card/50 p-4">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">No messages yet.</p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={
                "rounded-lg px-3 py-2 text-sm " +
                (m.role === "customer" ? "bg-secondary" : "border border-border")
              }
            >
              <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                <span>{m.role === "customer" ? "Customer" : "Support"}</span>
                {m.timestamp && (
                  <span className="font-mono normal-case">
                    {new Date(m.timestamp).toLocaleString()}
                  </span>
                )}
              </div>
              <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pipeline runs / traces */}
      <section className="mt-8">
        <h3 className="mb-3 text-sm font-medium">Pipeline runs ({runs.length})</h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Each customer message triggers one pipeline run. Expand a run to see the full audit trace and agent
          investigations.
        </p>
        <div className="space-y-3">
          {runs.length === 0 && (
            <p className="text-sm text-muted-foreground">No pipeline runs recorded.</p>
          )}
          {runs.map((run, idx) => (
            <RunTraceCard key={run.run_id} run={run} index={idx + 1} />
          ))}
        </div>
      </section>
    </div>
  );
}

function RunTraceCard({
  run,
  index,
}: {
  run: TicketDashboardDetail["runs"][number];
  index: number;
}) {
  const [open, setOpen] = useState(index === 1);

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-secondary/30"
      >
        {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
        <span className="font-mono text-xs text-muted-foreground">{run.run_id}</span>
        <span className="flex-1 truncate font-medium">
          Turn {run.message_count}: {run.message.slice(0, 80)}
          {run.message.length > 80 ? "…" : ""}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {new Date(run.created_at).toLocaleString()}
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-4 py-4">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {run.primary_intent && <Badge variant="outline">{run.primary_intent}</Badge>}
            {run.severity && <Badge variant="outline">severity {run.severity}</Badge>}
            {run.priority && <Badge variant="outline">{run.priority}</Badge>}
            {run.escalated && <Badge variant="destructive">escalated</Badge>}
          </div>

          {run.agent_reports.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Agent reports
              </p>
              <div className="space-y-2">
                {run.agent_reports.map((r) => (
                  <div key={r.sub_problem_id + r.agent} className="rounded-md border border-border p-2.5 text-xs">
                    <div className="flex items-center gap-2">
                      <strong className="capitalize">{r.agent}</strong>
                      <Badge variant="outline">{r.status}</Badge>
                      {r.duration_ms != null && (
                        <span className="ml-auto text-muted-foreground">{r.duration_ms}ms</span>
                      )}
                    </div>
                    {r.findings[0] && <p className="mt-1 text-muted-foreground">{r.findings[0]}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Audit trace ({run.audit_trail.length} steps)
          </p>
          <AuditList trail={run.audit_trail} />
        </div>
      )}
    </div>
  );
}

function AuditList({ trail }: { trail: AuditEvent[] }) {
  if (!trail.length) return <p className="text-xs text-muted-foreground">No audit events.</p>;
  return (
    <ol className="space-y-2">
      {trail.map((e, i) => (
        <li key={i} className="rounded-md border border-border/60 bg-background/50 p-2.5 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-muted-foreground">
              {new Date(e.timestamp).toLocaleTimeString()}
            </span>
            <KindTag kind={e.kind} />
            <span className="font-medium">{e.actor}</span>
          </div>
          <p className="mt-0.5 text-muted-foreground">{e.summary}</p>
          {e.detail && (
            <p className="mt-1 border-l border-border pl-2 italic text-muted-foreground/80">{e.detail}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
