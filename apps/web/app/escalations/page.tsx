"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, LayoutDashboard, Loader2, LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NotificationBell } from "@/components/notification-bell";
import { getDashboardTicket, handoffEscalation, listEscalations, resolveEscalation } from "@/lib/api";
import { useAuth, useRequireRole } from "@/lib/auth";
import type { EscalationRecord, TicketDashboardDetail } from "@/lib/types";

type Filter = "open" | "resolved" | "all";

function urgencyVariant(u: string | null) {
  if (u === "P1") return "destructive" as const;
  if (u === "P2") return "warning" as const;
  return "secondary" as const;
}

export default function EscalationsPage() {
  const account = useRequireRole("admin", "agent");
  const { logout } = useAuth();
  const router = useRouter();
  const [escalations, setEscalations] = useState<EscalationRecord[]>([]);
  const [filter, setFilter] = useState<Filter>("open");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const isAgent = account?.role === "agent";

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const data = await listEscalations();
    setEscalations(data.escalations);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!account) return;
    void load();
  }, [account, load]);

  // Near-real-time: poll so newly assigned cases appear without a manual refresh.
  useEffect(() => {
    if (!account) return;
    const t = setInterval(() => void load(true), 10000);
    return () => clearInterval(t);
  }, [account, load]);

  async function onResolve(id: string) {
    await resolveEscalation(id);
    await load(true);
  }

  async function onHandoff(id: string, note: string) {
    await handoffEscalation(id, note);
    await load(true);
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

  if (!account) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 px-6 py-4 backdrop-blur">
        <span className="flex size-7 items-center justify-center rounded bg-foreground text-xs font-bold text-background">
          SE
        </span>
        <div className="flex-1">
          <h1 className="text-base font-semibold tracking-tight">
            {isAgent ? "My assigned cases" : "Escalation dashboard"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {isAgent
              ? `Signed in as ${account.name} — cases routed to you`
              : "Human handoffs across departments"}
          </p>
        </div>
        {!isAgent && (
          <Link href="/tickets">
            <Button variant="outline" size="sm" className="gap-2">
              <LayoutDashboard className="size-3.5" /> Tickets
            </Button>
          </Link>
        )}
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()}>
          <RefreshCw className={"size-3.5 " + (loading ? "animate-spin" : "")} /> Refresh
        </Button>
        <NotificationBell />
        <Button
          variant="ghost"
          size="icon"
          title="Sign out"
          onClick={async () => {
            await logout();
            router.replace("/login");
          }}
        >
          <LogOut className="size-4" />
        </Button>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label={isAgent ? "My open cases" : "Open cases"} value={open.length} />
          <Stat label="Resolved" value={escalations.length - open.length} />
          <Stat label="Total" value={escalations.length} />
        </div>

        {/* Load by department (admin view only) */}
        {!isAgent && byDept.length > 0 && (
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
        <div className="mt-4 space-y-2">
          {visible.length === 0 ? (
            <p className="rounded-lg border border-border px-4 py-10 text-center text-sm text-muted-foreground">
              {loading ? "Loading…" : `No ${filter === "all" ? "" : filter} cases.`}
            </p>
          ) : (
            visible.map((e) => (
              <CaseRow
                key={e.id}
                e={e}
                isAgent={isAgent}
                expanded={expanded === e.id}
                onToggle={() => setExpanded((cur) => (cur === e.id ? null : e.id))}
                onResolve={() => void onResolve(e.id)}
                onHandoff={(note) => onHandoff(e.id, note)}
              />
            ))
          )}
        </div>
      </main>
    </div>
  );
}

function CaseRow({
  e,
  isAgent,
  expanded,
  onToggle,
  onResolve,
  onHandoff,
}: {
  e: EscalationRecord;
  isAgent: boolean;
  expanded: boolean;
  onToggle: () => void;
  onResolve: () => void;
  onHandoff: (note: string) => Promise<void>;
}) {
  const [detail, setDetail] = useState<TicketDashboardDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const atManager = (e.assignee_level ?? "agent") === "manager";

  async function confirmHandoff() {
    setBusy(true);
    await onHandoff(note.trim());
    setBusy(false);
    setHandoffOpen(false);
    setNote("");
  }

  useEffect(() => {
    if (!expanded || detail) return;
    setLoadingDetail(true);
    void getDashboardTicket(e.ticket_id).then((d) => {
      setDetail(d);
      setLoadingDetail(false);
    });
  }, [expanded, detail, e.ticket_id]);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[1fr_140px_170px_80px_150px] md:items-center">
        <button onClick={onToggle} className="flex min-w-0 items-start gap-2 text-left">
          {expanded ? (
            <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{e.subject || "(no subject)"}</span>
              {e.status === "resolved" && <Badge variant="success">resolved</Badge>}
              {e.status === "open" && atManager && <Badge variant="warning">with manager</Badge>}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {e.customer_name} · {new Date(e.created_at).toLocaleString()}
            </p>
          </div>
        </button>

        <div className="text-sm text-muted-foreground">{e.department}</div>

        {!isAgent ? (
          <div className="text-sm">
            <div>{e.assignee_name}</div>
            <div className="text-xs text-muted-foreground">{e.assignee_title}</div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">{e.reason}</div>
        )}

        <div>
          <Badge variant={urgencyVariant(e.urgency)}>{e.urgency || "—"}</Badge>
        </div>

        <div className="flex flex-wrap gap-1 md:justify-end">
          <Button variant="outline" size="sm" onClick={onToggle}>
            {expanded ? "Hide" : "View"}
          </Button>
          {e.status === "open" && !atManager && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHandoffOpen((v) => !v)}
              title="Pass this case up to the department manager"
            >
              Pass to manager
            </Button>
          )}
          {e.status === "open" ? (
            <Button size="sm" onClick={onResolve}>
              Resolve
            </Button>
          ) : (
            <Button variant="ghost" size="sm" disabled>
              Closed
            </Button>
          )}
        </div>
      </div>

      {handoffOpen && (
        <div className="border-t border-border bg-card/40 px-4 py-3">
          <p className="mb-1 text-sm font-medium">
            Pass this case up to the {e.department} manager
          </p>
          <p className="mb-2 text-xs text-muted-foreground">
            Add a short description of what you tried and what the manager needs to know.
          </p>
          <textarea
            value={note}
            onChange={(ev) => setNote(ev.target.value)}
            placeholder="e.g. Customer disputes the charge; refund needs manager approval over $200."
            className="input min-h-[72px] resize-y"
          />
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => void confirmHandoff()} disabled={busy}>
              {busy ? "Passing…" : "Pass to manager"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setHandoffOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {expanded && (
        <div className="border-t border-border bg-card/40 px-4 py-4">
          {loadingDetail ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading conversation…
            </p>
          ) : !detail ? (
            <p className="text-sm text-muted-foreground">Could not load this conversation.</p>
          ) : (
            <div>
              {e.handoff_note && (
                <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                    Handoff note → {e.assignee_name}
                  </p>
                  <p className="text-sm">{e.handoff_note}</p>
                </div>
              )}
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Conversation ({detail.messages.length})
              </p>
              <div className="space-y-2">
                {detail.messages.map((m, i) => (
                  <div
                    key={i}
                    className={
                      "rounded-md px-3 py-2 text-sm " +
                      (m.role === "customer" ? "bg-secondary" : "border border-border")
                    }
                  >
                    <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-muted-foreground">
                      {m.role === "customer" ? "Customer" : "Support"}
                    </span>
                    <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
                  </div>
                ))}
              </div>
              {detail.runs.length > 0 && detail.runs[detail.runs.length - 1].state.resolution && (
                <div className="mt-3 rounded-md border border-border bg-background/50 p-3">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Suggested resolution (from the engine)
                  </p>
                  <p className="text-sm">
                    {detail.runs[detail.runs.length - 1].state.resolution?.summary}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
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
