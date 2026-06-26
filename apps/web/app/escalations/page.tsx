"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Headset,
  Inbox,
  Loader2,
  Search,
  Workflow,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetBody, SheetHeader } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminHeader } from "@/components/admin-nav";
import {
  getDashboardTicket,
  handoffEscalation,
  listEscalations,
  postAgentReply,
  resolveEscalation,
} from "@/lib/api";
import { useRequireRole } from "@/lib/auth";
import type { EscalationRecord, Message, TicketDashboardDetail } from "@/lib/types";

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
              {loading ? (
                Array.from({ length: 7 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3">
                      <Skeleton className="h-3.5 w-52" />
                      <Skeleton className="mt-1.5 h-3 w-28" />
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell"><Skeleton className="h-3.5 w-20" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-3.5 w-28" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
                    <td className="hidden px-4 py-3 sm:table-cell"><Skeleton className="ml-auto h-3.5 w-14" /></td>
                  </tr>
                ))
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                      <Inbox className="size-6 opacity-40" />
                      No cases match your filters.
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
  onResolve,
  onHandoff,
}: {
  e: EscalationRecord;
  onResolve: () => Promise<void>;
  onHandoff: (note: string) => Promise<void>;
}) {
  const [detail, setDetail] = useState<TicketDashboardDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState("");
  const convoRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const atManager = (e.assignee_level ?? "agent") === "manager";

  // Load once on open, then poll so the agent sees customer replies live.
  useEffect(() => {
    let alive = true;
    setLoadingDetail(true);
    setDetail(null);
    setMessages([]);
    const fetchDetail = async (initial: boolean) => {
      const d = await getDashboardTicket(e.ticket_id);
      if (!alive) return;
      if (d) {
        setDetail(d);
        setMessages(d.messages ?? []);
      }
      if (initial) setLoadingDetail(false);
    };
    void fetchDetail(true);
    const id = setInterval(() => {
      if (!sendingRef.current) void fetchDetail(false);
    }, 6000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.ticket_id]);

  // Keep the conversation pinned to the newest message.
  useEffect(() => {
    convoRef.current?.scrollTo({ top: convoRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  async function confirmHandoff() {
    setBusy(true);
    await onHandoff(note.trim());
    setBusy(false);
  }

  async function sendReply() {
    const text = reply.trim();
    if (!text || sending) return;
    setReplyError("");
    setSending(true);
    sendingRef.current = true;
    // Optimistic append.
    setMessages((prev) => [...prev, { role: "agent", text }]);
    setReply("");
    const res = await postAgentReply(e.id, text);
    if (res.messages) setMessages(res.messages);
    else if (res.error) {
      setReplyError(res.error);
      setMessages((prev) => prev.slice(0, -1));
      setReply(text);
    }
    setSending(false);
    sendingRef.current = false;
  }

  const suggested =
    detail && detail.runs.length > 0 ? detail.runs[detail.runs.length - 1].state.resolution?.summary : null;
  const canReply = e.status === "open";

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2">
          <Badge variant={e.status === "open" ? "warning" : "success"}>{e.status}</Badge>
          <Badge variant={urgencyVariant(e.urgency)}>{e.urgency || "—"}</Badge>
          {e.status === "open" && atManager && <Badge variant="outline">with manager</Badge>}
        </div>
        <h2 className="mt-2 text-lg font-semibold leading-snug">{e.subject || "(no subject)"}</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
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
          <div className="mt-3 rounded-xl border border-border bg-card/60 p-3">
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
          <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3.5">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
              Handoff note → {e.assignee_name}
            </p>
            <p className="text-sm leading-relaxed">{e.handoff_note}</p>
          </div>
        )}

        {suggested && (
          <div className="mb-4 rounded-xl border border-border bg-card/40 p-3.5">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Suggested resolution (from the engine)
            </p>
            <p className="text-sm leading-relaxed">{suggested}</p>
          </div>
        )}

        {/* Conversation */}
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Conversation {messages.length ? `(${messages.length})` : ""}
        </p>
        {loadingDetail ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-3/4 rounded-xl" />
            <Skeleton className="ml-auto h-12 w-2/3 rounded-xl" />
            <Skeleton className="h-12 w-4/5 rounded-xl" />
          </div>
        ) : !detail ? (
          <p className="text-sm text-muted-foreground">Could not load this conversation.</p>
        ) : (
          <div ref={convoRef} className="max-h-[42vh] space-y-2.5 overflow-y-auto pr-1">
            {messages.map((m, i) => (
              <CaseMessage key={i} m={m} agentName={e.assignee_name} />
            ))}
          </div>
        )}

        {/* Reply composer — the assigned agent talks to the customer directly */}
        {canReply && (
          <div className="mt-3">
            {replyError && <p className="mb-1.5 text-xs font-medium text-destructive">{replyError}</p>}
            <div className="flex items-end gap-2 rounded-2xl border border-emerald-500/30 bg-card p-2 transition-colors focus-within:border-emerald-500/50 focus-within:ring-1 focus-within:ring-emerald-500/20">
              <textarea
                value={reply}
                onChange={(ev) => setReply(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" && !ev.shiftKey) {
                    ev.preventDefault();
                    void sendReply();
                  }
                }}
                rows={1}
                placeholder={`Reply to ${e.customer_name} as ${e.assignee_name}…`}
                className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
              />
              <Button size="icon" className="size-8 shrink-0 rounded-xl" onClick={() => void sendReply()} disabled={sending || !reply.trim()}>
                {sending ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
              </Button>
            </div>
            <p className="mt-1 px-0.5 text-[10px] text-muted-foreground/50">
              The customer is notified and sees your reply in their chat. Enter to send.
            </p>
          </div>
        )}

        {/* Full pipeline trace — opens the dedicated trace viewer in a new tab */}
        {detail && detail.runs.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Full pipeline trace ({detail.runs.length} run{detail.runs.length === 1 ? "" : "s"})
            </p>
            <Link href={`/trace/${encodeURIComponent(e.ticket_id)}`} target="_blank">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Workflow className="size-3.5" /> Open full trace in new tab
                <ExternalLink className="size-3 opacity-60" />
              </Button>
            </Link>
          </div>
        )}
      </SheetBody>
    </>
  );
}

// One message row in the case conversation, styled by role.
function CaseMessage({ m, agentName }: { m: Message; agentName: string }) {
  if (m.role === "customer") {
    return (
      <div className="rounded-xl bg-primary/10 px-3.5 py-2.5 text-sm ring-1 ring-inset ring-primary/15">
        <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-primary/70">Customer</span>
        <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
      </div>
    );
  }
  if (m.role === "agent") {
    return (
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-3.5 py-2.5 text-sm">
        <span className="mb-0.5 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-emerald-500/80">
          <Headset className="size-3" /> {agentName}
        </span>
        <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-background/40 px-3.5 py-2.5 text-sm">
      <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">AI assistant</span>
      <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
    </div>
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
