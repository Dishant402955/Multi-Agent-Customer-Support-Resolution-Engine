"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Inbox, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetBody, SheetHeader } from "@/components/ui/sheet";
import { AdminHeader } from "@/components/admin-nav";
import { getDashboardTicket, handoffEscalation, listEscalations, resolveEscalation } from "@/lib/api";
import { useRequireRole } from "@/lib/auth";
import type { EscalationRecord, TicketDashboardDetail } from "@/lib/types";

type Filter = "open" | "resolved" | "all";
type SortKey = "recent" | "oldest" | "urgency";

const PAGE_SIZE = 10;
const URGENCY_RANK: Record<string, number> = { P1: 3, P2: 2, P3: 1 };

function urgencyVariant(u: string | null) {
  if (u === "P1") return "destructive" as const;
  if (u === "P2") return "warning" as const;
  return "secondary" as const;
}

export default function EscalationsPage() {
  const account = useRequireRole("admin", "agent");
  const [escalations, setEscalations] = useState<EscalationRecord[]>([]);
  const [filter, setFilter] = useState<Filter>("open");
  const [query, setQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  useEffect(() => {
    setPage(0);
  }, [filter, query, deptFilter, sort]);

  async function onResolve(id: string) {
    await resolveEscalation(id);
    await load(true);
  }

  async function onHandoff(id: string, note: string) {
    await handoffEscalation(id, note);
    await load(true);
  }

  const open = escalations.filter((e) => e.status === "open");

  const departments = useMemo(() => {
    const s = new Set<string>();
    for (const e of escalations) if (e.department) s.add(e.department);
    return [...s].sort();
  }, [escalations]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = escalations.filter((e) => {
      if (filter !== "all" && e.status !== filter) return false;
      if (deptFilter !== "all" && e.department !== deptFilter) return false;
      if (!q) return true;
      return (
        (e.subject ?? "").toLowerCase().includes(q) ||
        e.customer_name.toLowerCase().includes(q) ||
        e.assignee_name.toLowerCase().includes(q) ||
        (e.reason ?? "").toLowerCase().includes(q)
      );
    });
    out.sort((a, b) => {
      if (sort === "recent") return +new Date(b.created_at) - +new Date(a.created_at);
      if (sort === "oldest") return +new Date(a.created_at) - +new Date(b.created_at);
      return (URGENCY_RANK[b.urgency ?? ""] ?? 0) - (URGENCY_RANK[a.urgency ?? ""] ?? 0);
    });
    return out;
  }, [escalations, filter, query, deptFilter, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const byDept = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of open) m.set(e.department, (m.get(e.department) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [open]);

  const hasFilters = filter !== "open" || !!query || deptFilter !== "all";
  const selected = escalations.find((e) => e.id === selectedId) ?? null;

  if (!account) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AdminHeader
        title={isAgent ? "My cases" : "Escalations"}
        subtitle={isAgent ? `Signed in as ${account.name} — cases routed to you` : "Human handoffs across departments"}
        role={account.role as "admin" | "agent"}
        onRefresh={() => void load()}
        refreshing={loading}
      />

      <main className="mx-auto max-w-6xl px-6 py-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <Stat label={isAgent ? "My open cases" : "Open cases"} value={open.length} tone="amber" />
          <Stat label="Resolved" value={escalations.length - open.length} tone="green" />
          <Stat label="Total" value={escalations.length} tone="neutral" />
        </div>

        {/* Load by department (admin view only) */}
        {!isAgent && byDept.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {byDept.map(([dept, n]) => (
              <Badge key={dept} variant="outline">{dept}: {n}</Badge>
            ))}
          </div>
        )}

        {/* Toolbar */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {(["open", "resolved", "all"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={
                  "rounded-lg px-3 py-1.5 text-sm capitalize transition-colors " +
                  (filter === f ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60")
                }
              >
                {f}
              </button>
            ))}
          </div>
          <div className="relative ml-auto">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search subject, customer, assignee…"
              className="w-56 rounded-lg border border-border bg-card py-1.5 pl-8 pr-8 text-sm outline-none focus:border-ring/60 focus:ring-1 focus:ring-ring/20"
            />
            {query && (
              <button onClick={() => setQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {departments.length > 1 && (
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm outline-none focus:border-ring/60"
            >
              <option value="all">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          )}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm outline-none focus:border-ring/60"
          >
            <option value="recent">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="urgency">Urgency</option>
          </select>
        </div>

        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{filtered.length} case{filtered.length === 1 ? "" : "s"}</span>
          {hasFilters && (
            <button
              onClick={() => {
                setFilter("open");
                setQuery("");
                setDeptFilter("all");
              }}
              className="underline-offset-2 hover:text-foreground hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Table */}
        <div className="mt-3 overflow-hidden rounded-xl border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-card/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Subject</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Department</th>
                <th className="px-4 py-2.5 font-medium">{isAgent ? "Reason" : "Assignee"}</th>
                <th className="px-4 py-2.5 font-medium">Urgency</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Created</th>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                      <Inbox className="size-6 opacity-40" />
                      {loading ? "Loading…" : "No cases match your filters."}
                    </div>
                  </td>
                </tr>
              ) : (
                paged.map((e) => {
                  const atManager = (e.assignee_level ?? "agent") === "manager";
                  return (
                    <tr
                      key={e.id}
                      onClick={() => setSelectedId(e.id)}
                      className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-secondary/40"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="max-w-[280px] truncate font-medium">{e.subject || "(no subject)"}</span>
                          {e.status === "open" && atManager && <Badge variant="warning">with manager</Badge>}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{e.customer_name}</p>
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{e.department}</td>
                      <td className="px-4 py-3">
                        {!isAgent ? (
                          <>
                            <div className="text-sm">{e.assignee_name}</div>
                            <div className="text-xs text-muted-foreground">{e.assignee_title}</div>
                          </>
                        ) : (
                          <span className="line-clamp-2 max-w-[260px] text-xs text-muted-foreground">{e.reason}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={urgencyVariant(e.urgency)}>{e.urgency || "—"}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={e.status === "open" ? "warning" : "success"}>{e.status}</Badge>
                      </td>
                      <td className="hidden px-4 py-3 text-right text-xs text-muted-foreground sm:table-cell">
                        {new Date(e.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <Button variant="ghost" size="sm" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              <ChevronLeft className="size-3.5" /> Prev
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Showing {safePage * PAGE_SIZE + 1}–{Math.min(filtered.length, (safePage + 1) * PAGE_SIZE)} of {filtered.length} · Page {safePage + 1}/{totalPages}
            </span>
            <Button variant="ghost" size="sm" disabled={safePage >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>
              Next <ChevronRight className="size-3.5" />
            </Button>
          </div>
        )}
      </main>

      {/* ── Case sheet ─────────────────────────────────────────── */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)} side="right">
        {selected && (
          <CaseDetail
            e={selected}
            isAgent={isAgent}
            onResolve={async () => {
              await onResolve(selected.id);
              setSelectedId(null);
            }}
            onHandoff={async (note) => {
              await onHandoff(selected.id, note);
              setSelectedId(null);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}

function CaseDetail({
  e,
  isAgent,
  onResolve,
  onHandoff,
}: {
  e: EscalationRecord;
  isAgent: boolean;
  onResolve: () => Promise<void>;
  onHandoff: (note: string) => Promise<void>;
}) {
  const [detail, setDetail] = useState<TicketDashboardDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const atManager = (e.assignee_level ?? "agent") === "manager";

  useEffect(() => {
    setLoadingDetail(true);
    setDetail(null);
    void getDashboardTicket(e.ticket_id).then((d) => {
      setDetail(d);
      setLoadingDetail(false);
    });
  }, [e.ticket_id]);

  async function confirmHandoff() {
    setBusy(true);
    await onHandoff(note.trim());
    setBusy(false);
  }

  const suggested =
    detail && detail.runs.length > 0 ? detail.runs[detail.runs.length - 1].state.resolution?.summary : null;

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2">
          <Badge variant={e.status === "open" ? "warning" : "success"}>{e.status}</Badge>
          <Badge variant={urgencyVariant(e.urgency)}>{e.urgency || "—"}</Badge>
          {e.status === "open" && atManager && <Badge variant="outline">with manager</Badge>}
        </div>
        <h2 className="mt-2 text-lg font-semibold leading-snug">{e.subject || "(no subject)"}</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {e.customer_name} · {e.department} · routed to {e.assignee_name}
          {e.assignee_title ? ` (${e.assignee_title})` : ""} · {new Date(e.created_at).toLocaleString()}
        </p>
        {e.reason && <p className="mt-2 text-sm text-muted-foreground">{e.reason}</p>}

        {/* Actions */}
        <div className="mt-3 flex flex-wrap gap-2">
          {e.status === "open" ? (
            <Button size="sm" onClick={() => void onResolve()}>Resolve case</Button>
          ) : (
            <Button size="sm" variant="ghost" disabled>Closed</Button>
          )}
          {e.status === "open" && !atManager && (
            <Button variant="outline" size="sm" onClick={() => setHandoffOpen((v) => !v)}>
              Pass to manager
            </Button>
          )}
        </div>

        {handoffOpen && (
          <div className="mt-3 rounded-lg border border-border bg-card/60 p-3">
            <p className="mb-1 text-sm font-medium">Pass this case up to the {e.department} manager</p>
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
      </SheetHeader>

      <SheetBody>
        {e.handoff_note && (
          <div className="mb-4 rounded-md border border-amber-500/25 bg-amber-500/10 p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
              Handoff note → {e.assignee_name}
            </p>
            <p className="text-sm">{e.handoff_note}</p>
          </div>
        )}

        {suggested && (
          <div className="mb-4 rounded-md border border-border bg-card/40 p-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Suggested resolution (from the engine)
            </p>
            <p className="text-sm">{suggested}</p>
          </div>
        )}

        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Conversation {detail ? `(${detail.messages.length})` : ""}
        </p>
        {loadingDetail ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading conversation…
          </p>
        ) : !detail ? (
          <p className="text-sm text-muted-foreground">Could not load this conversation.</p>
        ) : (
          <div className="space-y-2">
            {detail.messages.map((m, i) => (
              <div
                key={i}
                className={
                  "rounded-lg px-3 py-2 text-sm " +
                  (m.role === "customer"
                    ? "bg-primary/10 ring-1 ring-inset ring-primary/15"
                    : "border border-border bg-background/40")
                }
              >
                <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-muted-foreground">
                  {m.role === "customer" ? "Customer" : "Support"}
                </span>
                <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
              </div>
            ))}
          </div>
        )}
      </SheetBody>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "amber" | "green" | "neutral" }) {
  const dot = tone === "amber" ? "bg-amber-400" : tone === "green" ? "bg-emerald-500" : "bg-muted-foreground/40";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={`size-1.5 rounded-full ${dot}`} /> {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
