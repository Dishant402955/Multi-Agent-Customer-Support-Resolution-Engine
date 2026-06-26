"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Headset,
  LayoutDashboard,
  Loader2,
  LogOut,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Route,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/notification-bell";
import {
  deleteTicket,
  getTicket,
  listTickets,
  postCustomerMessage,
  submitTicket,
  submitTicketStream,
} from "@/lib/api";
import { useAuth, useRequireRole } from "@/lib/auth";
import type {
  AuditEvent,
  Message,
  PipelineState,
  PipelineStepId,
  TicketLifecycleStatus,
  TicketSummary,
} from "@/lib/types";

// ── Per-turn thought: rich context extracted from the pipeline run ────────────
interface TurnThought {
  steps: PipelineStepId[];
  // The real audit events produced by the pipeline — persisted so the thought
  // panel shows the identical content after the reply arrives.
  audit?: AuditEvent[];
  intent?: string;
  isMultiIssue?: boolean;
  sentiment?: string;
  subProblems?: string[];
  specialists?: { agent: string; status: string; finding: string }[];
  severity?: string;
  priority?: string;
  escalated?: boolean;
  escalationTeam?: string;
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
          Loading…
        </div>
      }
    >
      <Home />
    </Suspense>
  );
}

function Home() {
  const account = useRequireRole("user");
  const searchParams = useSearchParams();
  const ticketFromUrl = searchParams.get("ticket");

  const [conversations, setConversations] = useState<TicketSummary[]>([]);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  // Per-turn thought history — rich context that persists after each reply.
  const [traceHistory, setTraceHistory] = useState<TurnThought[]>([]);
  const [_run, setRun] = useState<unknown>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [traceDone, setTraceDone] = useState<PipelineStepId[]>([]);
  const [liveAudit, setLiveAudit] = useState<AuditEvent[]>([]);
  // Index of the turn whose reply should reveal word-by-word (only the newest).
  const [animateTurnIdx, setAnimateTurnIdx] = useState<number>(-1);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [view, setView] = useState<"chat" | "dashboard" | "tracing">("chat");
  const [_escalationId, setEscalationId] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<TicketLifecycleStatus | null>(null);
  const [_activeSummary, setActiveSummary] = useState<string | null>(null);
  const [resolvedChoice, setResolvedChoice] = useState<string | null>(null);
  // Live human-chat mode: set when the open ticket has an active escalation, so
  // messages go straight to the assigned human agent (no AI pipeline).
  const [escStatus, setEscStatus] = useState<"open" | "resolved" | null>(null);
  const [escAssignee, setEscAssignee] = useState<string | null>(null);
  const [liveSending, setLiveSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);
  const liveMode = !!activeId && escStatus === "open";

  useEffect(() => {
    const saved = Number(window.localStorage.getItem("se.sidebarWidth"));
    if (saved >= 200 && saved <= 460) setSidebarWidth(saved);
  }, []);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizing.current) return;
      const w = Math.min(460, Math.max(200, e.clientX));
      setSidebarWidth(w);
    }
    function onUp() {
      if (!resizing.current) return;
      resizing.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.localStorage.setItem("se.sidebarWidth", String(sidebarWidth));
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [sidebarWidth]);

  useEffect(() => {
    if (!account) return;
    void (async () => {
      const list = await listTickets();
      setConversations(list);
      if (ticketFromUrl) {
        void openConversation(ticketFromUrl);
      } else if (list[0]) {
        void openConversation(list[0].ticket_id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  const thread = useMemo<Message[]>(() => {
    const turns = [...messages];
    if (loading && pending) turns.push({ role: "customer", text: pending });
    return turns;
  }, [messages, loading, pending]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [thread, loading, liveAudit]);

  // Live human-chat: poll for the agent's replies while an escalation is open.
  useEffect(() => {
    if (!liveMode || view !== "chat") return;
    const id = setInterval(async () => {
      if (loading || liveSending) return; // don't clobber an in-flight send
      const data = await getTicket(activeId);
      if (!data) return;
      setMessages(data.messages ?? []);
      setEscStatus(data.escalation_status ?? null);
      setEscAssignee(data.escalation_assignee ?? null);
      setActiveStatus(data.status ?? null);
    }, 6000);
    return () => clearInterval(id);
  }, [liveMode, view, activeId, loading, liveSending]);

  async function refreshList() {
    setConversations(await listTickets());
  }

  async function openConversation(id: string) {
    setView("chat");
    setActiveId(id);
    setError("");
    setResolvedChoice(null);
    setLiveAudit([]);
    setAnimateTurnIdx(-1); // loaded history should not re-stream
    const data = await getTicket(id);
    setMessages(data?.messages ?? []);
    // Rebuild thoughts from persisted runs. Attach the real audit_trail so the
    // thought panel shows actual reasoning, not a generated summary.
    setTraceHistory(
      (data?.runs ?? []).map((s) => ({
        ...thoughtFromState(s),
        audit: (s as PipelineState & { audit_trail?: AuditEvent[] }).audit_trail ?? [],
      })),
    );
    setRun(data?.run ?? null);
    setEscalationId(data?.escalation_id ?? data?.run?.escalation?.escalation_id ?? null);
    setActiveStatus(data?.status ?? null);
    setActiveSummary(data?.summary ?? data?.run?.resolution?.summary ?? null);
    setEscStatus(data?.escalation_status ?? null);
    setEscAssignee(data?.escalation_assignee ?? null);
  }

  function newChat() {
    setView("chat");
    setActiveId("");
    setMessages([]);
    setTraceHistory([]);
    setRun(null);
    setError("");
    setInput("");
    setPending(null);
    setResolvedChoice(null);
    setActiveStatus(null);
    setActiveSummary(null);
    setLiveAudit([]);
    setAnimateTurnIdx(-1);
    setEscStatus(null);
    setEscAssignee(null);
  }

  async function onDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await deleteTicket(id);
    if (id === activeId) newChat();
    await refreshList();
  }

  function send() {
    const msg = input.trim();
    if (!msg || loading || liveSending) return;
    // Live human-chat mode: deliver straight to the assigned agent.
    if (liveMode) {
      void sendLive(msg);
      return;
    }
    if (activeId && activeStatus === "resolved") {
      setResolvedChoice(msg);
      return;
    }
    void doSend(msg, { ticketId: activeId || undefined });
  }

  // Send a message to the human agent on an open escalation (no AI pipeline).
  async function sendLive(msg: string) {
    setError("");
    setInput("");
    // Optimistic append so the customer sees their message immediately.
    setMessages((prev) => [...prev, { role: "customer", text: msg }]);
    setLiveSending(true);
    const res = await postCustomerMessage(activeId, msg);
    if (res.needsPipeline) {
      // Escalation closed between loads — fall back to the AI pipeline.
      await doSend(msg, { ticketId: activeId || undefined });
    } else if (res.messages) {
      setMessages(res.messages);
    } else if (res.error) {
      setError(res.error);
      setInput(msg);
      setMessages((prev) => prev.slice(0, -1)); // roll back optimistic append
    }
    setLiveSending(false);
  }

  async function doSend(msg: string, opts: { ticketId?: string; linkTo?: string }) {
    setResolvedChoice(null);
    setError("");
    setInput("");
    setPending(msg);
    setLoading(true);
    setTraceDone([]);
    setLiveAudit([]);
    setEscalationId(null);
    let finalTrace: PipelineStepId[] = [];
    // Accumulate audit events locally — state updates are async so we can't
    // read `liveAudit` reliably at the end of the async function.
    let capturedAudit: AuditEvent[] = [];
    try {
      let data;
      try {
        data = await submitTicketStream(
          msg,
          (evt) => {
            if (evt.type === "step_done" && evt.step) {
              setTraceDone((prev) => {
                const next = prev.includes(evt.step!) ? prev : [...prev, evt.step!];
                finalTrace = next;
                return next;
              });
            }
            // Stream real reasoning into display AND local capture simultaneously.
            if (evt.audit && evt.audit.length) {
              capturedAudit = [...capturedAudit, ...evt.audit];
              setLiveAudit((prev) => [...prev, ...evt.audit!]);
            }
          },
          opts.ticketId,
          opts.linkTo,
        );
      } catch (streamErr) {
        data = await submitTicket(msg, opts.ticketId, opts.linkTo);
        setError(`Completed without live streaming. ${(streamErr as Error).message}`);
      }
      setActiveId(data.ticket_id);
      setMessages(data.messages);
      // Build a thought and attach the real audit so the thought panel keeps
      // showing the identical events after the reply arrives.
      const thought: TurnThought = {
        ...thoughtFromState(data.run as PipelineState | null, finalTrace),
        audit: capturedAudit.length
          ? capturedAudit
          : (data.run as PipelineState | null)?.audit_trail ?? [],
      };
      setTraceHistory((prev) => [...prev, thought]);
      // Mark the just-arrived reply (the last turn) for word-by-word reveal.
      const customerTurns = data.messages.filter((m) => m.role === "customer").length;
      setAnimateTurnIdx(customerTurns - 1);
      setTraceDone([]);
      setLiveAudit([]);
      setRun(data.run);
      setEscalationId(data.escalation_id ?? data.run?.escalation?.escalation_id ?? null);
      setActiveStatus(data.status ?? null);
      setActiveSummary(data.summary ?? data.run?.resolution?.summary ?? null);
      // If the pipeline escalated, switch to live human-chat mode so the next
      // message reaches the assigned agent instead of re-running the AI.
      if (data.status === "escalated") {
        setEscStatus("open");
        setEscAssignee(data.run?.escalation?.assigned_agent?.name ?? null);
      } else {
        setEscStatus(data.escalation_status ?? null);
        setEscAssignee(null);
      }
      await refreshList();
    } catch (err) {
      setError((err as Error).message);
      setInput(msg);
    } finally {
      setLoading(false);
      setPending(null);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  if (!account) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const activeConversation = conversations.find((c) => c.ticket_id === activeId);
  const activeTitle = activeConversation?.title;
  const activeDisplayId = activeConversation?.display_id;
  const hasThread = thread.length > 0;

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      {sidebarOpen && (
        <aside
          className="relative hidden shrink-0 flex-col border-r border-border bg-sidebar md:flex"
          style={{ width: sidebarWidth }}
        >
          {/* Brand row */}
          <div className="flex h-11 shrink-0 items-center justify-between px-3">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-[11px] font-bold text-primary-foreground shadow-sm">
                SE
              </span>
              <span className="text-sm font-semibold tracking-tight">Support Engine</span>
            </div>
            <Button variant="ghost" size="icon" className="size-7" title="Collapse sidebar" onClick={() => setSidebarOpen(false)}>
              <PanelLeftClose className="size-3.5" />
            </Button>
          </div>

          {/* New chat button — breathable space above and below */}
          <div className="px-2 pt-3 pb-3">
            <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-xs" onClick={newChat}>
              <MessageSquarePlus className="size-3.5" /> New chat
            </Button>
          </div>

          {/* Conversations — compact, scrollable */}
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
            Conversations
          </p>
          <nav className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1">
            {conversations.length === 0 && (
              <p className="px-2 py-2 text-xs text-muted-foreground">No conversations yet.</p>
            )}
            {conversations.map((c) => (
              <button
                key={c.ticket_id}
                onClick={() => void openConversation(c.ticket_id)}
                className={
                  "group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors " +
                  (c.ticket_id === activeId
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground")
                }
              >
                {/* Title — takes all available space, truncated */}
                <span className="min-w-0 flex-1 truncate text-xs leading-snug">{c.title}</span>
                {/* Status dot + ticket id — compact right side */}
                <span className="flex shrink-0 items-center gap-1">
                  <StatusDot status={c.status} />
                  <span className="hidden font-mono text-[9px] text-muted-foreground/50 xl:inline">
                    {c.display_id}
                  </span>
                </span>
                <Trash2
                  className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-40 hover:!opacity-90 hover:text-destructive"
                  onClick={(e) => void onDelete(c.ticket_id, e)}
                />
              </button>
            ))}
          </nav>

          {/* Nav: Tracing, Dashboard */}
          <div className="space-y-0.5 border-t border-border px-1.5 py-2">
            <Button
              variant={view === "tracing" ? "secondary" : "ghost"}
              size="sm"
              className="w-full justify-start gap-2 text-xs"
              onClick={() => setView("tracing")}
            >
              <Route className="size-3.5" /> Ticket tracing
            </Button>
            <Button
              variant={view === "dashboard" ? "secondary" : "ghost"}
              size="sm"
              className="w-full justify-start gap-2 text-xs"
              onClick={() => setView("dashboard")}
            >
              <LayoutDashboard className="size-3.5" /> Dashboard
            </Button>
          </div>

          <AccountFooter />

          {/* Drag handle */}
          <div
            onMouseDown={startResize}
            title="Drag to resize"
            className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize transition-colors hover:bg-foreground/20"
          />
        </aside>
      )}

      {/* ── Main content ─────────────────────────────────────────────── */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Compact header */}
        <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
          <div className="flex min-w-0 items-center gap-1.5">
            {!sidebarOpen && (
              <Button variant="ghost" size="icon" className="size-7" title="Open sidebar" onClick={() => setSidebarOpen(true)}>
                <PanelLeftOpen className="size-3.5" />
              </Button>
            )}
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-sm font-medium leading-none">
                {view === "dashboard"
                  ? "Dashboard"
                  : view === "tracing"
                  ? "Ticket tracing"
                  : activeId
                  ? activeTitle ?? "Conversation"
                  : "New chat"}
              </h1>
              {view === "chat" && activeStatus && <StatusBadge status={activeStatus} />}
              {view === "chat" && activeId && activeDisplayId && (
                <span className="font-mono text-[10px] text-muted-foreground/50">{activeDisplayId}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell onOpenTicket={(id) => void openConversation(id)} />
          </div>
        </header>

        {view === "dashboard" ? (
          <UserDashboard conversations={conversations} onOpen={(id) => void openConversation(id)} onNewChat={newChat} />
        ) : view === "tracing" ? (
          <TicketTracing conversations={conversations} onOpen={(id) => void openConversation(id)} />
        ) : (
          <>
            {/* Live human-chat banner — shown while an escalation is open */}
            {liveMode && <LiveModeBanner assignee={escAssignee} />}

            {/* Message thread */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto bg-gradient-to-b from-background via-background to-muted/20">
              {!hasThread && !loading ? (
                /* Empty state */
                <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
                  <span className="flex size-16 items-center justify-center rounded-2xl bg-primary text-xl font-bold text-primary-foreground shadow-xl shadow-primary/25 ring-1 ring-primary/30">
                    SE
                  </span>
                  <div>
                    <h2 className="bg-gradient-to-b from-foreground to-foreground/50 bg-clip-text text-2xl font-semibold tracking-tight text-transparent">
                      How can we help?
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground/80">
                      Describe your issue and our multi-agent team will investigate it right away.
                    </p>
                  </div>
                </div>
              ) : (
                /* Chat thread — turns with thoughts between each message pair */
                <div className="mx-auto max-w-2xl px-4 py-10">
                  <ChatThread
                    messages={thread}
                    traceHistory={traceHistory}
                    liveSteps={loading ? traceDone : null}
                    liveAudit={loading ? liveAudit : null}
                    animateTurnIdx={animateTurnIdx}
                  />
                </div>
              )}
            </div>

            {/* Composer */}
            <div className="shrink-0 border-t border-border bg-background/95 px-4 py-4 backdrop-blur-sm">
              <div className="mx-auto max-w-2xl space-y-2">
                {error && <p className="text-sm font-medium text-destructive">{error}</p>}
                {resolvedChoice && (
                  <div className="rounded-lg border border-border bg-card p-3">
                    <p className="text-sm font-medium">This conversation was already resolved.</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Continue with "{resolvedChoice.slice(0, 60)}{resolvedChoice.length > 60 ? "…" : ""}"?
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => void doSend(resolvedChoice, { ticketId: activeId || undefined })}>Reopen</Button>
                      <Button size="sm" variant="outline" onClick={() => void doSend(resolvedChoice, { linkTo: activeId || undefined })}>New linked ticket</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setInput(resolvedChoice); setResolvedChoice(null); }}>Cancel</Button>
                    </div>
                  </div>
                )}
                <div
                  className={
                    "flex items-end gap-2 rounded-2xl border bg-card p-2 transition-colors focus-within:ring-1 " +
                    (liveMode
                      ? "border-emerald-500/30 focus-within:border-emerald-500/50 focus-within:ring-emerald-500/20"
                      : "border-border focus-within:border-ring/60 focus-within:ring-ring/20")
                  }
                >
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    rows={1}
                    placeholder={
                      liveMode
                        ? `Message ${escAssignee ?? "your support agent"}…`
                        : activeId
                        ? "Reply to continue this conversation…"
                        : "Describe your issue…"
                    }
                    className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
                  />
                  <Button
                    size="icon"
                    className="size-8 shrink-0 rounded-xl"
                    onClick={() => send()}
                    disabled={loading || liveSending || !input.trim()}
                  >
                    {loading || liveSending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ArrowUp className="size-3.5" />
                    )}
                  </Button>
                </div>
                <p className="px-0.5 text-[10px] text-muted-foreground/40">
                  {liveMode
                    ? "You're chatting with a human agent · Enter to send"
                    : "Enter to send · Shift+Enter for new line"}
                </p>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// ── Live human-chat banner ────────────────────────────────────────────────────
// Shown while an escalation is open: the customer is now talking to a human.
function LiveModeBanner({ assignee }: { assignee: string | null }) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-emerald-500/20 bg-emerald-500/[0.07] px-4 py-2.5 backdrop-blur-sm">
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/70" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
      </span>
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-foreground/80">
        <span className="font-semibold text-emerald-500">Connected to support.</span>{" "}
        You're now chatting live with {assignee ? <span className="font-medium">{assignee}</span> : "a human agent"}. Replies appear here as they come in.
      </p>
    </div>
  );
}

// ── Tiny status dot (sidebar) ─────────────────────────────────────────────────
const DOT_META: Record<TicketLifecycleStatus, string> = {
  active: "bg-amber-400",
  escalated: "bg-red-500",
  resolved: "bg-emerald-500",
};
function StatusDot({ status }: { status: TicketLifecycleStatus }) {
  const cls = DOT_META[status] ?? DOT_META.active;
  return <span className={`size-1.5 shrink-0 rounded-full ${cls}`} title={status} />;
}

// ── Status badge (header, ticket cards) ──────────────────────────────────────
const STATUS_META: Record<TicketLifecycleStatus, { label: string; badge: string }> = {
  active:   { label: "Active",    badge: "bg-amber-500/15 text-amber-400 border border-amber-500/25" },
  escalated:{ label: "Escalated", badge: "bg-destructive/15 text-destructive border border-destructive/25" },
  resolved: { label: "Resolved",  badge: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25" },
};
function StatusBadge({ status }: { status: TicketLifecycleStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.active;
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${meta.badge}`}>
      {meta.label}
    </span>
  );
}

// ── Account footer ────────────────────────────────────────────────────────────
function AccountFooter() {
  const { account, logout } = useAuth();
  const router = useRouter();
  if (!account) return null;
  return (
    <div className="border-t border-border px-2 py-2">
      <div className="flex items-center gap-2 rounded-md px-1.5 py-1.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary">
          {account.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{account.name}</p>
          <p className="truncate text-[10px] text-muted-foreground/60">{account.email}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0"
          title="Sign out"
          onClick={async () => { await logout(); router.replace("/login"); }}
        >
          <LogOut className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ── Horizontal lifecycle stepper ──────────────────────────────────────────────
const LIFECYCLE_STAGES = ["Submitted", "In progress", "Escalated", "Resolved"];

function statusToStep(status: TicketLifecycleStatus): { current: number; complete: boolean } {
  if (status === "resolved") return { current: LIFECYCLE_STAGES.length - 1, complete: true };
  if (status === "escalated") return { current: 2, complete: false };
  return { current: 1, complete: false };
}

function Stepper({ current, complete }: { current: number; complete: boolean }) {
  return (
    <div className="flex w-full items-start gap-2">
      {LIFECYCLE_STAGES.map((label, idx) => {
        const state = complete || idx < current ? "done" : idx === current ? "current" : "upcoming";
        const bar = state === "done" ? "bg-emerald-500" : state === "current" ? "bg-amber-500" : "bg-border";
        const text = state === "upcoming" ? "text-muted-foreground/50" : "text-foreground";
        return (
          <div key={label} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={`truncate text-[11px] font-medium ${text}`}>{label}</span>
            <span className={`h-1 w-full rounded-full ${bar}`} />
          </div>
        );
      })}
    </div>
  );
}

// ── Ticket tracing page — with search + pagination ────────────────────────────
const PAGE_SIZE = 6;

function TicketTracing({
  conversations,
  onOpen,
}: {
  conversations: TicketSummary[];
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.display_id.toLowerCase().includes(q) ||
        c.status.toLowerCase().includes(q),
    );
  }, [conversations, query]);

  // Reset to first page when query changes
  useEffect(() => { setPage(0); }, [query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Ticket tracing</h2>
            <p className="text-sm text-muted-foreground">
              Track every ticket and see exactly where it is in our support process.
            </p>
          </div>
          <span className="text-sm text-muted-foreground tabular-nums">
            {filtered.length} ticket{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title, ticket ID, or status…"
            className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-9 text-sm placeholder:text-muted-foreground/60 outline-none focus:border-ring/60 focus:ring-1 focus:ring-ring/20"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Ticket cards */}
        {filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            {conversations.length === 0 ? "No tickets yet. Start a new chat to get help." : "No tickets match your search."}
          </p>
        ) : (
          <div className="space-y-3">
            {paged.map((c) => {
              const { current, complete } = statusToStep(c.status);
              const currentLabel = LIFECYCLE_STAGES[complete ? LIFECYCLE_STAGES.length - 1 : current];
              return (
                <button
                  key={c.ticket_id}
                  onClick={() => onOpen(c.ticket_id)}
                  className="block w-full rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-foreground/25 hover:bg-card/80"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{c.title}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <p className="mb-3 font-mono text-[10px] text-muted-foreground/60">
                    {c.display_id}{c.parent_ticket_id ? " · linked" : ""}
                  </p>
                  <Stepper current={current} complete={complete} />
                  <p className="mt-2.5 text-[11px] text-muted-foreground">
                    Current stage: <span className="font-medium text-foreground">{currentLabel}</span>
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="size-3.5" /> Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {safePage + 1} of {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              Next <ChevronRight className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}


// ── User dashboard ────────────────────────────────────────────────────────────
function UserDashboard({
  conversations,
  onOpen,
  onNewChat,
}: {
  conversations: TicketSummary[];
  onOpen: (id: string) => void;
  onNewChat: () => void;
}) {
  const { account, logout } = useAuth();
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "active" | "unresolved" | "resolved">("all");

  const total = conversations.length;
  const active = conversations.filter((c) => c.status === "active").length;
  const escalated = conversations.filter((c) => c.status === "escalated").length;
  const resolved = conversations.filter((c) => c.status === "resolved").length;
  const unresolved = active + escalated;

  const stats: { key: typeof filter; label: string; value: number; hint: string }[] = [
    { key: "all",        label: "Total tickets", value: total,      hint: "All conversations you've started" },
    { key: "active",     label: "Active",         value: active,     hint: "Being worked on right now" },
    { key: "unresolved", label: "Unresolved",     value: unresolved, hint: "Active + escalated, not closed yet" },
    { key: "resolved",   label: "Resolved",       value: resolved,   hint: "Closed and resolved" },
  ];

  const filtered = conversations.filter((c) => {
    if (filter === "all") return true;
    if (filter === "active") return c.status === "active";
    if (filter === "resolved") return c.status === "resolved";
    return c.status === "active" || c.status === "escalated";
  });
  const filterLabel = stats.find((s) => s.key === filter)?.label ?? "All";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">Welcome back, {account?.name}</h2>
            <p className="truncate text-sm text-muted-foreground">{account?.email}</p>
          </div>
          <Button variant="outline" size="sm" onClick={async () => { await logout(); router.replace("/login"); }}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => {
            const selected = filter === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setFilter(s.key)}
                aria-pressed={selected}
                className={
                  "rounded-lg border bg-card p-4 text-left transition-colors " +
                  (selected
                    ? "border-primary/60 ring-1 ring-primary/30"
                    : "border-border hover:border-foreground/30")
                }
              >
                <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
                <p className="mt-0.5 text-sm font-medium">{s.label}</p>
                <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{s.hint}</p>
              </button>
            );
          })}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {filterLabel} tickets
              {filter !== "all" && (
                <button onClick={() => setFilter("all")} className="ml-2 normal-case text-muted-foreground/60 underline-offset-2 hover:underline">
                  clear filter
                </button>
              )}
            </p>
            <Button variant="ghost" size="sm" onClick={onNewChat}>
              <MessageSquarePlus className="size-4" /> New chat
            </Button>
          </div>
          {filtered.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              {conversations.length === 0 ? "No tickets yet. Start a new chat to get help." : `No ${filterLabel.toLowerCase()} tickets.`}
            </p>
          ) : (
            <div className="space-y-2">
              {filtered.map((c) => (
                <button
                  key={c.ticket_id}
                  onClick={() => onOpen(c.ticket_id)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-foreground/25"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{c.title}</span>
                    <span className="font-mono text-[10px] text-muted-foreground/60">
                      {c.display_id}{c.parent_ticket_id ? " · linked" : ""}
                    </span>
                  </span>
                  <StatusBadge status={c.status} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Chat thread ───────────────────────────────────────────────────────────────
function ChatThread({
  messages,
  traceHistory,
  liveSteps,
  liveAudit,
  animateTurnIdx,
}: {
  messages: Message[];
  traceHistory: TurnThought[];
  liveSteps: PipelineStepId[] | null;
  liveAudit: AuditEvent[] | null;
  animateTurnIdx: number;
}) {
  // Build a render list. Customer→system pairs become AI turns (with a thought
  // block); standalone customer messages and human-agent messages render on
  // their own (live human-chat). `turnIdx` only advances for AI pairs so it
  // stays aligned with `traceHistory` (one entry per pipeline run).
  type Item =
    | { kind: "ai"; user: Message; ai: Message | null; turnIdx: number; key: string }
    | { kind: "user"; user: Message; key: string }
    | { kind: "agent"; msg: Message; key: string };
  const items: Item[] = [];
  let ti = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "customer") {
      const next = messages[i + 1];
      if (next?.role === "system") {
        items.push({ kind: "ai", user: m, ai: next, turnIdx: ti++, key: `ai-${i}` });
        i++;
      } else if (i === messages.length - 1 && liveSteps) {
        // The message currently being processed by the pipeline — render it as
        // an AI turn (ai=null) so the live, streaming thought process shows up
        // instantly beneath it. (A lone customer message that ISN'T generating
        // is a live human-chat message, handled below as a plain bubble.)
        items.push({ kind: "ai", user: m, ai: null, turnIdx: ti++, key: `ai-${i}` });
      } else {
        items.push({ kind: "user", user: m, key: `u-${i}` });
      }
    } else if (m.role === "agent") {
      items.push({ kind: "agent", msg: m, key: `a-${i}` });
    } else if (m.role === "system") {
      // A system reply without a preceding customer message (rare).
      items.push({ kind: "ai", user: { role: "customer", text: "" }, ai: m, turnIdx: ti++, key: `s-${i}` });
    }
  }

  return (
    <div className="space-y-8">
      {items.map((it) => {
        if (it.kind === "agent") {
          return <HumanAgentBubble key={it.key} text={it.msg.text} />;
        }
        if (it.kind === "user") {
          return (
            <div key={it.key} className="animate-rise">
              <UserBubble text={it.user.text} />
            </div>
          );
        }
        const { user, ai, turnIdx } = it;
        const thought: TurnThought | null = ai
          ? traceHistory[turnIdx] ?? null
          : liveSteps
          ? { steps: liveSteps }
          : null;
        return (
          <div key={it.key} className="animate-rise space-y-3">
            {user.text && <UserBubble text={user.text} />}
            {thought && (
              <ThinkingBlock thought={thought} isLive={!ai} liveAudit={!ai ? liveAudit : null} />
            )}
            {ai && <AgentBubble text={ai.text} animate={turnIdx === animateTurnIdx} />}
          </div>
        );
      })}
    </div>
  );
}

// ── User bubble ───────────────────────────────────────────────────────────────
function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[76%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary/[0.18] px-4 py-3 text-sm leading-relaxed text-foreground shadow-sm ring-1 ring-inset ring-primary/20">
        {text}
      </div>
    </div>
  );
}

// ── Human agent bubble (live support) ─────────────────────────────────────────
function HumanAgentBubble({ text }: { text: string }) {
  return (
    <div className="animate-rise flex items-start gap-3">
      <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-500 ring-1 ring-inset ring-emerald-500/30">
        <Headset className="size-3.5" />
      </span>
      <div className="max-w-[76%] space-y-1">
        <span className="ml-1 text-[10px] font-medium uppercase tracking-wider text-emerald-500/80">
          Support agent
        </span>
        <div className="whitespace-pre-wrap rounded-2xl rounded-tl-md border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3 text-sm leading-relaxed text-foreground shadow-sm">
          {text}
        </div>
      </div>
    </div>
  );
}

// ── Streaming text — character-level reveal with organic timing ───────────────
// Runs on requestAnimationFrame; emits ~4 chars/frame (~240 chars/sec at 60fps)
// with a slight burst-and-pause rhythm that mimics real token streaming.
function StreamingText({ text, animate }: { text: string; animate: boolean }) {
  const [shown, setShown] = useState(animate ? "" : text);
  const [done, setDone] = useState(!animate);
  const rafRef = useRef<number>(0);
  const accRef = useRef(0); // accumulated ms since last emit

  useEffect(() => {
    if (!animate) {
      setShown(text);
      setDone(true);
      return;
    }

    let cursor = 0;
    let prev = performance.now();
    setShown("");
    setDone(false);

    function tick(now: number) {
      const dt = now - prev;
      prev = now;
      accRef.current += dt;

      // Emit chars in bursts: 3–6 chars every ~18 ms, then a tiny pause.
      // This gives a realistic "tokens arriving in chunks" feel.
      const INTERVAL = 18;
      while (accRef.current >= INTERVAL && cursor < text.length) {
        accRef.current -= INTERVAL;
        // Burst size: slightly random so it feels organic.
        const burst = cursor % 7 === 0 ? 1 : cursor % 5 === 0 ? 6 : 3;
        cursor = Math.min(cursor + burst, text.length);
      }

      setShown(text.slice(0, cursor));

      if (cursor < text.length) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDone(true);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [text, animate]);

  return <span className={done ? "" : "stream-caret"}>{shown}</span>;
}

// ── Agent bubble ──────────────────────────────────────────────────────────────
function AgentBubble({ text, animate }: { text: string; animate: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-xl bg-primary text-[10px] font-bold text-primary-foreground shadow-md shadow-primary/30">
        AI
      </span>
      <div className="max-w-[76%] whitespace-pre-wrap rounded-2xl rounded-tl-md border border-border/60 bg-card px-4 py-3 text-sm leading-relaxed text-card-foreground shadow-sm">
        <StreamingText text={text} animate={animate} />
      </div>
    </div>
  );
}

// ── Thinking block ─────────────────────────────────────────────────────────────
// Collapsible, Claude-style. Auto-opens while live, auto-collapses shortly after
// the reply arrives, stays collapsible forever.
// • While live: streams the real audit events as they arrive, newest line
//   shown as "in progress". Falls back to a step checklist before the first
//   audit event appears.
// • After reply lands: shows the SAME audit events (stored in thought.audit),
//   all checked off — no generated summary replacement.
function ThinkingBlock({
  thought,
  isLive,
  liveAudit,
}: {
  thought: TurnThought;
  isLive: boolean;
  liveAudit: AuditEvent[] | null;
}) {
  const [open, setOpen] = useState(isLive);

  // Auto-collapse a beat after the reply lands.
  useEffect(() => {
    if (!isLive && open) {
      const t = setTimeout(() => setOpen(false), 1400);
      return () => clearTimeout(t);
    }
  }, [isLive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter out noisy sub-agent trace rows; keep step-level reasoning.
  const filterAudit = (events: AuditEvent[]) =>
    events.filter((e) => !e.step?.startsWith("agent:"));

  // Live path: events arriving via SSE.
  const liveThoughts = filterAudit(liveAudit ?? []);
  // Completed path: events stored on the thought (persisted).
  const doneThoughts = filterAudit(thought.audit ?? []);

  const lastLiveThought = liveThoughts[liveThoughts.length - 1]?.summary;

  // Header label: while live show the most recent thought; after done just a
  // neutral "Thought process" label (no summary clutter in the chat window).
  const headerLabel = isLive
    ? lastLiveThought ?? liveSummary(thought.steps)
    : "Thought process";

  return (
    <div className="ml-2 max-w-[76%]">
      {/* Toggle row */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="group flex items-center gap-1.5 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
      >
        {isLive ? (
          <Loader2 className="size-3 animate-spin text-primary/70" />
        ) : (
          <span
            className={
              "inline-block size-3 transition-transform duration-200 " +
              (open ? "rotate-90" : "rotate-0")
            }
          >
            ▶
          </span>
        )}
        <span className="italic">{headerLabel}</span>
      </button>

      {/* Expandable body */}
      {open && (
        <div className="mt-2 ml-[18px] space-y-1.5 border-l-2 border-primary/15 pl-3">
          {isLive ? (
            liveThoughts.length > 0 ? (
              /* Real thoughts streaming in. */
              liveThoughts.map((e, i) => {
                const last = i === liveThoughts.length - 1;
                return (
                  <div key={i} className="animate-thought flex items-start gap-2">
                    {last ? (
                      <Loader2 className="mt-0.5 size-2.5 shrink-0 animate-spin text-primary/70" />
                    ) : (
                      <Check className="mt-0.5 size-2.5 shrink-0 text-emerald-500/80" />
                    )}
                    <span
                      className={
                        "text-[11px] leading-relaxed " +
                        (last ? "text-foreground/80" : "text-muted-foreground/55")
                      }
                    >
                      {e.summary}
                    </span>
                  </div>
                );
              })
            ) : (
              /* Before first audit: show step checklist placeholder. */
              PIPELINE_STEPS.map((s) => {
                const done = thought.steps.includes(s.id);
                const active =
                  !done &&
                  thought.steps.length === PIPELINE_STEPS.findIndex((x) => x.id === s.id);
                return (
                  <div key={s.id} className="flex items-center gap-2">
                    {done ? (
                      <Check className="size-2.5 shrink-0 text-emerald-500/80" />
                    ) : active ? (
                      <Loader2 className="size-2.5 shrink-0 animate-spin text-primary/70" />
                    ) : (
                      <span className="size-2.5 shrink-0 rounded-full border border-border/40" />
                    )}
                    <span
                      className={
                        "text-[11px] italic " +
                        (done
                          ? "text-muted-foreground/50"
                          : active
                          ? "text-foreground/80"
                          : "text-muted-foreground/25")
                      }
                    >
                      {s.label}
                    </span>
                  </div>
                );
              })
            )
          ) : doneThoughts.length > 0 ? (
            /* Completed: show the SAME real thoughts, all checked off. */
            doneThoughts.map((e, i) => (
              <div
                key={i}
                className="animate-thought flex items-start gap-2"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <Check className="mt-0.5 size-2.5 shrink-0 text-emerald-500/70" />
                <span className="text-[11px] leading-relaxed text-muted-foreground/60">
                  {e.summary}
                </span>
              </div>
            ))
          ) : (
            /* Fallback if audit somehow wasn't captured (non-streaming path). */
            buildNarrative(thought).map((line, i) => (
              <p
                key={i}
                className="animate-thought text-[11px] italic leading-relaxed text-muted-foreground/60"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                {line}
              </p>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Thought helpers ───────────────────────────────────────────────────────────
const PIPELINE_STEPS: { id: PipelineStepId; label: string }[] = [
  { id: "guard",       label: "Screening for sensitive signals…" },
  { id: "classify",    label: "Classifying the intent…" },
  { id: "sentiment",   label: "Reading the emotional tone…" },
  { id: "decompose",   label: "Breaking into sub-problems…" },
  { id: "investigate", label: "Specialist agents investigating…" },
  { id: "severity",    label: "Assessing severity and priority…" },
  { id: "escalation",  label: "Checking if escalation is needed…" },
  { id: "synthesize",  label: "Composing the reply…" },
];

function liveSummary(steps: PipelineStepId[]): string {
  const last = steps[steps.length - 1];
  const labels: Partial<Record<PipelineStepId, string>> = {
    guard: "Screening…",
    classify: "Classifying intent…",
    sentiment: "Reading tone…",
    decompose: "Decomposing…",
    investigate: "Investigating with specialists…",
    severity: "Assessing severity…",
    escalation: "Checking escalation…",
    synthesize: "Composing reply…",
  };
  return labels[last] ?? "Thinking…";
}

// Reconstruct a rich per-turn thought from a persisted pipeline state. Used both
// live (with the streamed step trail) and when rehydrating a saved conversation.
function thoughtFromState(state: PipelineState | null, liveSteps?: PipelineStepId[]): TurnThought {
  const s = state as (PipelineState & Record<string, any>) | null;
  return {
    steps: liveSteps && liveSteps.length ? liveSteps : stepsFromState(s),
    intent: s?.classification?.primary_intent,
    isMultiIssue: (s?.classification as any)?.is_multi_issue,
    sentiment: s?.sentiment?.label,
    subProblems: s?.sub_problems?.map((p: any) => p.description as string),
    specialists: s?.agent_reports?.map((r: any) => ({
      agent: r.agent as string,
      status: r.status as string,
      finding: (r.findings?.[0] ?? "") as string,
    })),
    severity: s?.severity?.level,
    priority: (s?.severity as any)?.priority,
    escalated: s?.escalation?.escalate,
    escalationTeam: (s?.escalation as any)?.recommended_team,
  };
}

// Infer which pipeline stages ran from the fields present on a persisted state.
function stepsFromState(s: (PipelineState & Record<string, any>) | null): PipelineStepId[] {
  if (!s) return [];
  const steps: PipelineStepId[] = [];
  if (s.guard) steps.push("guard");
  if (s.classification) steps.push("classify");
  if (s.sentiment) steps.push("sentiment");
  if (s.sub_problems?.length) steps.push("decompose");
  if (s.agent_reports?.length) steps.push("investigate");
  if (s.severity) steps.push("severity");
  if (s.escalation) steps.push("escalation");
  if (s.resolution) steps.push("synthesize");
  return steps;
}

function buildNarrative(t: TurnThought): string[] {
  const lines: string[] = [];
  if (t.intent) {
    lines.push(
      `Recognized intent as "${t.intent}"${t.isMultiIssue ? ", which is a multi-part issue" : ""}.`,
    );
  }
  if (t.sentiment) {
    const tone =
      t.sentiment === "negative"
        ? "frustrated or negative"
        : t.sentiment === "positive"
        ? "positive"
        : "neutral";
    lines.push(`Customer tone appears ${tone}.`);
  }
  if (t.subProblems?.length) {
    if (t.subProblems.length === 1) {
      lines.push(`Focused on: ${t.subProblems[0]}.`);
    } else {
      lines.push(`Broke into ${t.subProblems.length} sub-problems: ${t.subProblems.join("; ")}.`);
    }
  }
  if (t.specialists?.length) {
    for (const s of t.specialists) {
      const verdict =
        s.status === "resolved"
          ? "resolved"
          : s.status === "unresolved"
          ? "unresolved"
          : s.status;
      const finding = s.finding ? ` — "${s.finding}"` : "";
      lines.push(`${cap(s.agent)} specialist: ${verdict}${finding}.`);
    }
  }
  if (t.severity && t.priority) {
    lines.push(`Severity assessed as ${t.severity} (${t.priority}).`);
  }
  if (t.escalated) {
    lines.push(
      `Routing to ${t.escalationTeam ?? "human support"} for escalation.`,
    );
  }
  if (!lines.length) lines.push("Processed the request and composed a reply.");
  return lines;
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
