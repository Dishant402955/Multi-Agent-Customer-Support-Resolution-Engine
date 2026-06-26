"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUp,
  Check,
  FileText,
  LayoutDashboard,
  Loader2,
  LogOut,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Route,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/notification-bell";
import {
  deleteTicket,
  getTicket,
  listTickets,
  submitTicket,
  submitTicketStream,
} from "@/lib/api";
import { useAuth, useRequireRole } from "@/lib/auth";
import type {
  Message,
  PipelineState,
  PipelineStepId,
  TicketLifecycleStatus,
  TicketSummary,
} from "@/lib/types";

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
  const [run, setRun] = useState<PipelineState | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [traceDone, setTraceDone] = useState<PipelineStepId[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(264);
  const [view, setView] = useState<"chat" | "dashboard" | "tracing">("chat");
  const [escalationId, setEscalationId] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<TicketLifecycleStatus | null>(null);
  const [activeSummary, setActiveSummary] = useState<string | null>(null);
  // When the user replies on a resolved conversation we hold the message here and
  // ask whether to reopen it or branch a new linked ticket.
  const [resolvedChoice, setResolvedChoice] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);

  // Restore a previously chosen sidebar width.
  useEffect(() => {
    const saved = Number(window.localStorage.getItem("se.sidebarWidth"));
    if (saved >= 200 && saved <= 460) setSidebarWidth(saved);
  }, []);

  // Drag-to-resize the left sidebar.
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

  // Once signed in, load this customer's tickets and open one.
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
  }, [thread, loading]);

  async function refreshList() {
    setConversations(await listTickets());
  }

  async function openConversation(id: string) {
    setView("chat");
    setActiveId(id);
    setError("");
    setResolvedChoice(null);
    const data = await getTicket(id);
    setMessages(data?.messages ?? []);
    setRun(data?.run ?? null);
    setEscalationId(data?.escalation_id ?? data?.run?.escalation?.escalation_id ?? null);
    setActiveStatus(data?.status ?? null);
    setActiveSummary(data?.summary ?? data?.run?.resolution?.summary ?? null);
  }

  function newChat() {
    setView("chat");
    setActiveId("");
    setMessages([]);
    setRun(null);
    setError("");
    setInput("");
    setPending(null);
    setResolvedChoice(null);
    setActiveStatus(null);
    setActiveSummary(null);
  }

  async function onDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await deleteTicket(id);
    if (id === activeId) newChat();
    await refreshList();
  }

  function send() {
    const msg = input.trim();
    if (!msg || loading) return;
    // Replying on a resolved conversation → ask reopen vs. new linked ticket.
    if (activeId && activeStatus === "resolved") {
      setResolvedChoice(msg);
      return;
    }
    void doSend(msg, { ticketId: activeId || undefined });
  }

  async function doSend(msg: string, opts: { ticketId?: string; linkTo?: string }) {
    setResolvedChoice(null);
    setError("");
    setInput("");
    setPending(msg);
    setLoading(true);
    setTraceDone([]);
    setEscalationId(null);
    try {
      let data;
      try {
        data = await submitTicketStream(
          msg,
          (evt) => {
            if (evt.type === "step_done" && evt.step) {
              setTraceDone((prev) => (prev.includes(evt.step!) ? prev : [...prev, evt.step!]));
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
      setRun(data.run);
      setEscalationId(data.escalation_id ?? data.run?.escalation?.escalation_id ?? null);
      setActiveStatus(data.status ?? null);
      setActiveSummary(data.summary ?? data.run?.resolution?.summary ?? null);
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
      {/* ── Sidebar: identity + conversations (collapsible + resizable) ─ */}
      {sidebarOpen && (
        <aside
          className="relative hidden shrink-0 flex-col border-r border-border md:flex"
          style={{ width: sidebarWidth }}
        >
          <div className="flex items-center justify-between px-4 py-4">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded bg-foreground text-[11px] font-bold text-background">
                SE
              </span>
              <span className="text-sm font-semibold tracking-tight">Support Engine</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              title="Collapse sidebar"
              onClick={() => setSidebarOpen(false)}
            >
              <PanelLeftClose className="size-4" />
            </Button>
          </div>

          <div className="px-3">
            <Button variant="outline" className="w-full justify-start" onClick={newChat}>
              <MessageSquarePlus className="size-4" /> New chat
            </Button>
          </div>

          <p className="px-4 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Your conversations
          </p>
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
            {conversations.length === 0 && (
              <p className="px-2 py-3 text-xs text-muted-foreground">No conversations yet.</p>
            )}
            {conversations.map((c) => (
              <button
                key={c.ticket_id}
                onClick={() => void openConversation(c.ticket_id)}
                className={
                  "group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors " +
                  (c.ticket_id === activeId
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60")
                }
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate">{c.title}</span>
                  <span className="flex items-center gap-1.5">
                    <StatusBadge status={c.status} />
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {c.display_id}
                      {c.parent_ticket_id ? " · linked" : ""}
                    </span>
                  </span>
                </span>
                <Trash2
                  className="size-3.5 shrink-0 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-60"
                  onClick={(e) => void onDelete(c.ticket_id, e)}
                />
              </button>
            ))}
          </nav>
          <div className="space-y-0.5 px-3 pb-1">
            <Button
              variant={view === "tracing" ? "secondary" : "ghost"}
              className="w-full justify-start"
              onClick={() => setView("tracing")}
            >
              <Route className="size-4" /> Ticket tracing
            </Button>
            <Button
              variant={view === "dashboard" ? "secondary" : "ghost"}
              className="w-full justify-start"
              onClick={() => setView("dashboard")}
            >
              <LayoutDashboard className="size-4" /> Dashboard
            </Button>
          </div>
          <AccountFooter />

          {/* Drag handle to resize the sidebar */}
          <div
            onMouseDown={startResize}
            title="Drag to resize"
            className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize transition-colors hover:bg-foreground/20"
          />
        </aside>
      )}

      {/* ── Center: chat ───────────────────────────────────────────── */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {!sidebarOpen && (
              <Button
                variant="ghost"
                size="icon"
                title="Open sidebar"
                onClick={() => setSidebarOpen(true)}
              >
                <PanelLeftOpen className="size-4" />
              </Button>
            )}
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 truncate text-sm font-medium">
                {view === "dashboard"
                  ? "Dashboard"
                  : view === "tracing"
                    ? "Ticket tracing"
                    : activeId
                      ? activeTitle ?? "Conversation"
                      : "New chat"}
                {view === "chat" && activeStatus && <StatusBadge status={activeStatus} />}
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                {account.name}
                {view === "chat" && activeId && activeDisplayId ? ` · ${activeDisplayId}` : ""}
                {view === "chat" && activeId && run
                  ? ` · ${run.message_count} message${run.message_count === 1 ? "" : "s"}`
                  : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell onOpenTicket={(id) => void openConversation(id)} />
          </div>
        </header>

        {view === "dashboard" ? (
          <UserDashboard
            conversations={conversations}
            onOpen={(id) => void openConversation(id)}
            onNewChat={newChat}
          />
        ) : view === "tracing" ? (
          <TicketTracing conversations={conversations} onOpen={(id) => void openConversation(id)} />
        ) : (
          <>
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {!hasThread && !loading ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6 text-center">
              <h2 className="text-lg font-medium">How can we help?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Describe your issue and our support team will look into it right away.
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
              {activeSummary && !loading && (
                <div className="rounded-lg border border-border bg-card/50 p-3">
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    <FileText className="size-3.5" /> Conversation summary
                  </p>
                  <p className="text-sm leading-relaxed text-foreground/90">{activeSummary}</p>
                </div>
              )}
              {thread.map((t, i) => (
                <Bubble key={i} role={t.role} text={t.text} />
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="flex gap-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded bg-foreground text-[10px] font-bold text-background">
                      AI
                    </span>
                    <div className="rounded-2xl border border-border bg-card px-4 py-3">
                      <UserTrace done={traceDone} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-border px-4 py-3">
          <div className="mx-auto max-w-2xl">
            {error && <p className="mb-2 text-sm font-medium text-destructive">{error}</p>}
            {resolvedChoice && (
              <div className="mb-2 rounded-lg border border-border bg-card p-3">
                <p className="text-sm font-medium">This conversation was already resolved.</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  How would you like to continue with “{resolvedChoice.slice(0, 80)}
                  {resolvedChoice.length > 80 ? "…" : ""}”?
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => void doSend(resolvedChoice, { ticketId: activeId || undefined })}
                  >
                    Reopen this conversation
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void doSend(resolvedChoice, { linkTo: activeId || undefined })}
                  >
                    Start a new linked ticket
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setInput(resolvedChoice);
                      setResolvedChoice(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 focus-within:border-foreground/40">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder={activeId ? "Reply to continue this conversation…" : "Describe your issue…"}
                className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
              />
              <Button size="icon" onClick={() => send()} disabled={loading || !input.trim()}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
              </Button>
            </div>
            <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
              Enter to send · Shift+Enter for a new line.
            </p>
          </div>
        </div>
          </>
        )}
      </main>
    </div>
  );
}

function AccountFooter() {
  const { account, logout } = useAuth();
  const router = useRouter();
  if (!account) return null;
  return (
    <div className="border-t border-border p-3">
      <div className="flex items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold">
          {account.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{account.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{account.email}</p>
        </div>
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
      </div>
    </div>
  );
}

const STATUS_META: Record<TicketLifecycleStatus, { label: string; badge: string }> = {
  active: { label: "Active", badge: "bg-amber-100 text-amber-700" },
  escalated: { label: "Escalated", badge: "bg-red-100 text-red-700" },
  resolved: { label: "Resolved", badge: "bg-emerald-100 text-emerald-700" },
};

function StatusBadge({ status }: { status: TicketLifecycleStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.active;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.badge}`}>{meta.label}</span>
  );
}


// ── Horizontal lifecycle stepper (labels with colored progress bars) ──────────
const LIFECYCLE_STAGES = ["Submitted", "In progress", "Escalated", "Resolved"];

function statusToStep(status: TicketLifecycleStatus): { current: number; complete: boolean } {
  if (status === "resolved") return { current: LIFECYCLE_STAGES.length - 1, complete: true };
  if (status === "escalated") return { current: 2, complete: false };
  return { current: 1, complete: false }; // active
}

function Stepper({ current, complete }: { current: number; complete: boolean }) {
  return (
    <div className="flex w-full items-start gap-2">
      {LIFECYCLE_STAGES.map((label, idx) => {
        const state = complete || idx < current ? "done" : idx === current ? "current" : "upcoming";
        const bar =
          state === "done" ? "bg-emerald-500" : state === "current" ? "bg-amber-500" : "bg-border";
        const text = state === "upcoming" ? "text-muted-foreground" : "text-foreground";
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

function TicketTracing({
  conversations,
  onOpen,
}: {
  conversations: TicketSummary[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <div>
          <h2 className="text-lg font-medium">Ticket tracing</h2>
          <p className="text-sm text-muted-foreground">
            Track every ticket and see exactly where it is in our support process.
          </p>
        </div>
        {conversations.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            No tickets yet. Start a new chat to get help.
          </p>
        ) : (
          <div className="space-y-3">
            {conversations.map((c) => {
              const { current, complete } = statusToStep(c.status);
              const currentLabel = LIFECYCLE_STAGES[complete ? LIFECYCLE_STAGES.length - 1 : current];
              return (
                <button
                  key={c.ticket_id}
                  onClick={() => onOpen(c.ticket_id)}
                  className="block w-full rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-foreground/30"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{c.title}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  <p className="mb-3 font-mono text-[10px] text-muted-foreground">
                    {c.display_id}
                    {c.parent_ticket_id ? " · linked" : ""}
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
      </div>
    </div>
  );
}

// User-level live trace shown while a reply is being prepared. Pipeline steps are
// grouped into a few friendly phases — no developer internals are exposed.
const TRACE_PHASES: { label: string; steps: PipelineStepId[] }[] = [
  { label: "Understanding your request", steps: ["guard", "classify", "sentiment"] },
  { label: "Looking into your issue", steps: ["decompose", "investigate"] },
  { label: "Checking if a specialist is needed", steps: ["severity", "escalation"] },
  { label: "Preparing your answer", steps: ["synthesize"] },
];

function UserTrace({ done }: { done: PipelineStepId[] }) {
  const firstIncomplete = TRACE_PHASES.findIndex((p) => !p.steps.every((s) => done.includes(s)));
  const current = firstIncomplete === -1 ? TRACE_PHASES.length : firstIncomplete;
  return (
    <div className="space-y-2">
      {TRACE_PHASES.map((p, i) => {
        const state = i < current ? "done" : i === current ? "active" : "pending";
        return (
          <div key={p.label} className="flex items-center gap-2 text-sm">
            {state === "done" ? (
              <Check className="size-3.5 shrink-0 text-emerald-600" />
            ) : state === "active" ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-foreground" />
            ) : (
              <span className="size-3.5 shrink-0 rounded-full border border-border" />
            )}
            <span className={state === "active" ? "text-foreground" : "text-muted-foreground"}>
              {p.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

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
    { key: "all", label: "Total tickets", value: total, hint: "All conversations you've started" },
    { key: "active", label: "Active", value: active, hint: "Being worked on right now" },
    { key: "unresolved", label: "Unresolved", value: unresolved, hint: "Active + escalated, not closed yet" },
    { key: "resolved", label: "Resolved", value: resolved, hint: "Closed and resolved" },
  ];

  const matchesFilter = (c: TicketSummary) => {
    if (filter === "all") return true;
    if (filter === "active") return c.status === "active";
    if (filter === "resolved") return c.status === "resolved";
    return c.status === "active" || c.status === "escalated"; // unresolved
  };
  const filtered = conversations.filter(matchesFilter);
  const filterLabel = stats.find((s) => s.key === filter)?.label ?? "All";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-medium">Welcome back, {account?.name}</h2>
            <p className="truncate text-sm text-muted-foreground">{account?.email}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
          >
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
                    ? "border-foreground ring-1 ring-foreground"
                    : "border-border hover:border-foreground/40")
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
                <button
                  onClick={() => setFilter("all")}
                  className="ml-2 normal-case text-muted-foreground underline-offset-2 hover:underline"
                >
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
              {conversations.length === 0
                ? "No tickets yet. Start a new chat to get help."
                : `No ${filterLabel.toLowerCase()} tickets.`}
            </p>
          ) : (
            <div className="space-y-2">
              {filtered.map((c) => (
                <button
                  key={c.ticket_id}
                  onClick={() => onOpen(c.ticket_id)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-foreground/30"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{c.title}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {c.display_id}
                      {c.parent_ticket_id ? " · linked" : ""}
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

function Bubble({ role, text }: { role: Message["role"]; text: string }) {
  const isUser = role === "customer";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div className="flex max-w-[85%] gap-3">
        {!isUser && (
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded bg-foreground text-[10px] font-bold text-background">
            AI
          </span>
        )}
        <div
          className={
            "whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed " +
            (isUser ? "bg-secondary" : "border border-border bg-card")
          }
        >
          {text}
        </div>
      </div>
    </div>
  );
}
