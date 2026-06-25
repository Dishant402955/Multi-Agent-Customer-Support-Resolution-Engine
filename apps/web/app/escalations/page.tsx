"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listEscalations, resolveEscalation } from "@/lib/api";
import type { EscalationRecord, HumanAgent } from "@/lib/types";

type Filter = "open" | "resolved" | "all";

function urgencyVariant(u: string | null) {
  if (u === "P1") return "destructive" as const;
  if (u === "P2") return "warning" as const;
  return "secondary" as const;
}

export default function EscalationsPage() {
  const [escalations, setEscalations] = useState<EscalationRecord[]>([]);
  const [agents, setAgents] = useState<HumanAgent[]>([]);
  const [filter, setFilter] = useState<Filter>("open");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const data = await listEscalations();
    setEscalations(data.escalations);
    setAgents(data.agents);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function onResolve(id: string) {
    await resolveEscalation(id);
    await load();
  }

  const open = escalations.filter((e) => e.status === "open");
  const visible = useMemo(
    () => escalations.filter((e) => (filter === "all" ? true : e.status === filter)),
    [escalations, filter]
  );

  const byDept = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of open) m.set(e.department, (m.get(e.department) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [open]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 px-6 py-4 backdrop-blur">
        <Link href="/">
          <Button variant="ghost" size="icon" title="Back to chat">
            <ArrowLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-semibold tracking-tight">Escalation dashboard</h1>
          <p className="text-xs text-muted-foreground">Human handoffs across departments</p>
        </div>
        <Link href="/tickets">
          <Button variant="outline" size="sm">
            Tickets
          </Button>
        </Link>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()}>
          <RefreshCw className={"size-3.5 " + (loading ? "animate-spin" : "")} /> Refresh
        </Button>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Open cases" value={open.length} />
          <Stat label="Resolved" value={escalations.length - open.length} />
          <Stat label="Departments" value={new Set(open.map((e) => e.department)).size} />
          <Stat label="Agents on duty" value={agents.length} />
        </div>

        {/* Load by department */}
        {byDept.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {byDept.map(([dept, n]) => (
              <Badge key={dept} variant="outline">
                {dept}: {n}
              </Badge>
            ))}
          </div>
        )}

        {/* Filter */}
        <div className="mt-6 flex gap-1">
          {(["open", "resolved", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={
                "rounded-md px-3 py-1.5 text-sm capitalize transition-colors " +
                (filter === f
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60")
              }
            >
              {f}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <div className="hidden grid-cols-[1fr_140px_180px_90px_110px] gap-3 border-b border-border bg-card px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
            <span>Case</span>
            <span>Department</span>
            <span>Assignee</span>
            <span>Urgency</span>
            <span className="text-right">Action</span>
          </div>

          {visible.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              {loading ? "Loading…" : `No ${filter === "all" ? "" : filter} escalations.`}
            </p>
          ) : (
            visible.map((e) => (
              <div
                key={e.id}
                className="grid grid-cols-1 gap-3 border-b border-border px-4 py-3 last:border-b-0 md:grid-cols-[1fr_140px_180px_90px_110px] md:items-center"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{e.subject || "(no subject)"}</span>
                    {e.status === "resolved" && <Badge variant="success">resolved</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {e.customer_name} · <span className="font-mono">{e.ticket_id}</span> ·{" "}
                    {new Date(e.created_at).toLocaleString()}
                  </p>
                  {e.reason && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground/80">{e.reason}</p>
                  )}
                </div>

                <div className="text-sm text-muted-foreground">{e.department}</div>

                <div className="text-sm">
                  <div>{e.assignee_name}</div>
                  <div className="text-xs text-muted-foreground">{e.assignee_title}</div>
                </div>

                <div>
                  <Badge variant={urgencyVariant(e.urgency)}>{e.urgency || "—"}</Badge>
                </div>

                <div className="md:text-right">
                  {e.status === "open" ? (
                    <Button variant="outline" size="sm" onClick={() => void onResolve(e.id)}>
                      Resolve
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Closed</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
