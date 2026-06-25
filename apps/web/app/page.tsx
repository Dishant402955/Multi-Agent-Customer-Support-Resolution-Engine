"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowUp,
  Check,
  ChevronDown,
  LayoutDashboard,
  Loader2,
  Lock,
  MessageSquarePlus,
  PanelRightClose,
  PanelRightOpen,
  ShieldAlert,
  Trash2,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  claimUser,
  deleteTicket,
  getTicket,
  listTickets,
  listUsers,
  releaseUser,
  submitTicket,
  submitTicketStream,
} from "@/lib/api";
import type {
  Message,
  PipelineProgressEvent,
  PipelineState,
  RunProgress,
  TicketSummary,
  UserPresence,
} from "@/lib/types";
import { ChatActivity, LiveAuditTrail, LiveSteps, RunDetails } from "@/components/views";
import { PipelineFlow } from "@/components/flow";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SAMPLES = [
  "I was charged $49 twice this month — why?",
  "I keep getting ERR_AUTH_401 when calling your API.",
  "The app crashes after login and I was also charged twice.",
  "Am I eligible for a refund if I cancel my annual plan early?",
  "My payment failed but money was deducted from my account.",
  "I can't log in — it says my account is locked.",
  "How do I add more seats to my subscription?",
  "I want to cancel my plan and delete all my data under GDPR.",
  "Your API is returning 500 errors on every request — this is urgent.",
  "I was overcharged and I'm extremely frustrated, this is the third time.",
];

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
  const searchParams = useSearchParams();
  const ticketFromUrl = searchParams.get("ticket");
  const [session, setSession] = useState("");
  const [users, setUsers] = useState<UserPresence[]>([]);
  const [selectedUser, setSelectedUser] = useState("");

  const [conversations, setConversations] = useState<TicketSummary[]>([]);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [run, setRun] = useState<PipelineState | null>(null);
  const [input, setInput] = useState("");
  const [manualTicketId, setManualTicketId] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDetails, setShowDetails] = useState(true);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [escalationId, setEscalationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const emptyProgress = (): RunProgress => ({
    activeStep: null,
    completedSteps: [],
    liveAudit: [],
    agentsDone: [],
    snapshot: {},
  });

  function applyProgressEvent(evt: PipelineProgressEvent) {
    setProgress((prev) => {
      const p = prev ?? emptyProgress();
      if (evt.type === "step_start" && evt.step) {
        return { ...p, activeStep: evt.step };
      }
      if (evt.type === "step_done" && evt.step) {
        const completed = p.completedSteps.includes(evt.step)
          ? p.completedSteps
          : [...p.completedSteps, evt.step];
        return {
          ...p,
          activeStep: null,
          completedSteps: completed,
          liveAudit: evt.audit?.length ? [...p.liveAudit, ...(evt.audit as RunProgress["liveAudit"])] : p.liveAudit,
          snapshot: { ...p.snapshot, ...(evt.snapshot ?? {}) },
        };
      }
      if (evt.type === "agent_done" && evt.agent) {
        const agentsDone = p.agentsDone.includes(evt.agent)
          ? p.agentsDone
          : [...p.agentsDone, evt.agent];
        return {
          ...p,
          agentsDone,
          liveAudit: evt.audit?.length ? [...p.liveAudit, ...(evt.audit as RunProgress["liveAudit"])] : p.liveAudit,
        };
      }
      return p;
    });
  }

  // 1. Establish a stable per-browser session id (used for the presence lock).
  useEffect(() => {
    let s = localStorage.getItem("se_session");
    if (!s) {
      s = crypto.randomUUID();
      localStorage.setItem("se_session", s);
    }
    setSession(s);
  }, []);

  // 2. Once we have a session: restore the last identity (re-claim it if free),
  //    load the roster, and load that identity's tickets.
  useEffect(() => {
    if (!session) return;
    void (async () => {
      const stored = localStorage.getItem("se_user") || "";
      let active = "";
      if (stored) {
        const r = await claimUser(stored, session);
        if (r.ok) {
          active = stored;
          setUsers(r.users);
        } else {
          localStorage.removeItem("se_user");
          setUsers(await listUsers(session));
        }
      } else {
        setUsers(await listUsers(session));
      }
      setSelectedUser(active);
      const list = await listTickets(active || undefined);
      setConversations(list);
      if (ticketFromUrl) {
        void openConversation(ticketFromUrl);
      } else if (list[0]) {
        void openConversation(list[0].ticket_id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // 3. Keep the roster fresh so occupancy by other sessions shows up.
  useEffect(() => {
    if (!session) return;
    const t = setInterval(async () => setUsers(await listUsers(session)), 15000);
    return () => clearInterval(t);
  }, [session]);

  // 4. While acting as someone, renew the lease; release it when we switch away
  //    or the component unmounts.
  useEffect(() => {
    if (!session || !selectedUser) return;
    const hb = setInterval(() => void claimUser(selectedUser, session), 20000);
    return () => {
      clearInterval(hb);
      void releaseUser(selectedUser, session);
    };
  }, [session, selectedUser]);

  // 5. Best-effort release if the tab is closed (TTL frees it otherwise).
  useEffect(() => {
    function onUnload() {
      if (session && selectedUser) void releaseUser(selectedUser, session);
    }
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [session, selectedUser]);

  const thread = useMemo<Message[]>(() => {
    const turns = [...messages];
    if (loading && pending) turns.push({ role: "customer", text: pending });
    return turns;
  }, [messages, loading, pending]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [thread, loading]);

  async function refreshList() {
    setConversations(await listTickets(selectedUser || undefined));
  }

  async function openConversation(id: string) {
    setActiveId(id);
    setManualTicketId(id);
    setError("");
    const data = await getTicket(id, selectedUser || undefined);
    setMessages(data?.messages ?? []);
    setRun(data?.run ?? null);
    setEscalationId(data?.escalation_id ?? data?.run?.escalation?.escalation_id ?? null);
  }

  function newChat() {
    setActiveId("");
    setMessages([]);
    setRun(null);
    setError("");
    setInput("");
    setManualTicketId("");
    setPending(null);
  }

  async function selectUser(id: string) {
    if (id === selectedUser) return;
    setError("");
    if (id) {
      const r = await claimUser(id, session);
      setUsers(r.users.length ? r.users : await listUsers(session));
      if (!r.ok) {
        setError(
          r.reason === "occupied"
            ? "That customer is currently in use by another session."
            : "Could not switch to that customer."
        );
        return;
      }
      localStorage.setItem("se_user", id);
    } else {
      if (selectedUser) await releaseUser(selectedUser, session);
      localStorage.removeItem("se_user");
      setUsers(await listUsers(session));
    }
    setSelectedUser(id);
    newChat();
    const list = await listTickets(id || undefined);
    setConversations(list);
    if (list[0]) void openConversation(list[0].ticket_id);
  }

  async function onDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await deleteTicket(id, selectedUser || undefined);
    if (id === activeId) newChat();
    await refreshList();
  }

  async function send() {
    const msg = input.trim();
    if (!msg || loading) return;
    setError("");
    setInput("");
    setPending(msg);
    setLoading(true);
    setProgress(emptyProgress());
    setEscalationId(null);
    const ticketId = activeId || manualTicketId.trim() || undefined;
    try {
      let data;
      try {
        data = await submitTicketStream(
          msg,
          (evt) => applyProgressEvent(evt),
          ticketId,
          selectedUser || undefined
        );
      } catch (streamErr) {
        // If SSE is blocked or interrupted, complete the same ticket through the
        // regular endpoint so the user still gets a result.
        setProgress(null);
        data = await submitTicket(msg, ticketId, selectedUser || undefined);
        setError(`Live progress unavailable; completed without streaming. ${(streamErr as Error).message}`);
      }
      setActiveId(data.ticket_id);
      setManualTicketId(data.ticket_id);
      setMessages(data.messages);
      setRun(data.run);
      setEscalationId(data.escalation_id ?? data.run?.escalation?.escalation_id ?? null);
      await refreshList();
    } catch (err) {
      setError((err as Error).message);
      setInput(msg);
    } finally {
      setLoading(false);
      setPending(null);
      setProgress(null);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const activeTitle = conversations.find((c) => c.ticket_id === activeId)?.title;
  const activeUser = users.find((u) => u.id === selectedUser);
  const hasThread = thread.length > 0;

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* ── Sidebar: identity + conversations ──────────────────────── */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border md:flex">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="flex size-6 items-center justify-center rounded bg-foreground text-[11px] font-bold text-background">
            SE
          </span>
          <span className="text-sm font-semibold tracking-tight">Support Engine</span>
        </div>

        <div className="px-3">
          <UserPicker users={users} selected={selectedUser} onSelect={selectUser} />
        </div>

        <div className="mt-2 px-3">
          <Button variant="outline" className="w-full justify-start" onClick={newChat}>
            <MessageSquarePlus className="size-4" /> New chat
          </Button>
        </div>

        <p className="px-4 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {activeUser ? `${activeUser.name.split(" ")[0]}’s history` : "Guest history"}
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
              <span className="flex-1 truncate">{c.title}</span>
              <Trash2
                className="size-3.5 shrink-0 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-60"
                onClick={(e) => void onDelete(c.ticket_id, e)}
              />
            </button>
          ))}
        </nav>
        <div className="space-y-0.5 border-t border-border p-3">
          <Link
            href="/tickets"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <LayoutDashboard className="size-4" /> Tickets dashboard
          </Link>
          <Link
            href="/escalations"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <ShieldAlert className="size-4" /> Escalation dashboard
          </Link>
        </div>
      </aside>

      {/* ── Center: chat ───────────────────────────────────────────── */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium">
              {activeId ? activeTitle ?? "Conversation" : "New chat"}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {activeUser ? `Acting as ${activeUser.name} · ${activeUser.plan}` : "Guest (no account)"}
              {activeId && run ? ` · ${run.message_count} message${run.message_count === 1 ? "" : "s"}` : ""}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowDetails((v) => !v)}
            title={showDetails ? "Hide details" : "Show details"}
          >
            {showDetails ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
          </Button>
        </header>

        <div className="border-b border-border p-3 md:hidden">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <UserPicker users={users} selected={selectedUser} onSelect={selectUser} />
            </div>
            <Button variant="outline" size="sm" onClick={newChat}>
              New
            </Button>
          </div>
          <div className="mt-2 flex gap-2">
            <Link href="/tickets" className="flex-1">
              <Button variant="outline" size="sm" className="w-full gap-2">
                <LayoutDashboard className="size-3.5" /> Tickets
              </Button>
            </Link>
            <Link href="/escalations" className="flex-1">
              <Button variant="outline" size="sm" className="w-full gap-2">
                <ShieldAlert className="size-3.5" /> Escalations
              </Button>
            </Link>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {!hasThread && !loading ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6 text-center">
              <h2 className="text-lg font-medium">How can we help?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {activeUser
                  ? `You’re acting as ${activeUser.name}. Account lookups use this identity automatically.`
                  : "Describe a customer issue. Pick a customer above to attach their account automatically."}
              </p>
              <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
                {SAMPLES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="rounded-lg border border-border p-3 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
              {thread.map((t, i) => (
                <Bubble key={i} role={t.role} text={t.text} />
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="flex w-full gap-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded bg-foreground text-[10px] font-bold text-background">
                      AI
                    </span>
                    <div className="min-w-0 flex-1">
                      <LiveSteps progress={progress ?? emptyProgress()} />
                      <LiveAuditTrail audit={progress?.liveAudit ?? []} />
                    </div>
                  </div>
                </div>
              )}

              {!loading && run && (
                <div className="space-y-2 pl-9">
                  <ChatActivity s={run} />
                  {run.escalation?.escalate ||
                  run.escalation?.assigned_agent ||
                  escalationId ? (
                    <Link href="/escalations">
                      <Button variant="outline" size="sm" className="gap-2">
                        <ShieldAlert className="size-4" />
                        {run.escalation?.assigned_agent
                          ? `Escalated to ${run.escalation.assigned_agent.name} · View dashboard`
                          : "View escalation dashboard"}
                      </Button>
                    </Link>
                  ) : null}
                </div>
              )}

              {!loading && run && (
                <div className="rounded-lg border border-border bg-card/40 lg:hidden">
                  <Tabs defaultValue="details" className="w-full">
                    <div className="border-b border-border p-2">
                      <TabsList className="grid w-full grid-cols-2 bg-secondary">
                        <TabsTrigger value="details">Details</TabsTrigger>
                        <TabsTrigger value="flow">Flow</TabsTrigger>
                      </TabsList>
                    </div>
                    <TabsContent value="details" className="mt-0">
                      <RunDetails s={run} />
                    </TabsContent>
                    <TabsContent value="flow" className="mt-0 p-3">
                      <PipelineFlow s={run} loading={loading} progress={progress} />
                    </TabsContent>
                  </Tabs>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-border px-4 py-3">
          <div className="mx-auto max-w-2xl">
            {error && <p className="mb-2 text-sm font-medium text-destructive">{error}</p>}
            <div className="mb-2 flex flex-col gap-1.5 sm:flex-row sm:items-center">
              <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Continue ticket
              </label>
              <input
                value={manualTicketId}
                onChange={(e) => setManualTicketId(e.target.value)}
                placeholder="Optional ticket ID, e.g. T-1234abcd"
                className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs outline-none focus:border-foreground/40"
              />
              {manualTicketId.trim() && manualTicketId.trim() !== activeId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void openConversation(manualTicketId.trim())}
                >
                  Load
                </Button>
              )}
            </div>
            <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 focus-within:border-foreground/40">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder={activeId ? "Reply to continue this ticket…" : "Describe the customer’s issue…"}
                className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
              />
              <Button size="icon" onClick={() => void send()} disabled={loading || !input.trim()}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
              </Button>
            </div>
            <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
              Enter to send · Shift+Enter for a new line.{" "}
              {manualTicketId.trim() && !activeId ? `Will continue ${manualTicketId.trim()}. ` : ""}
              {activeUser
                ? `Lookups run as ${activeUser.name} — no need to give an id.`
                : "No customer selected — billing/technical lookups will ask for an id."}
            </p>
          </div>
        </div>
      </main>

      {/* ── Right: run details ─────────────────────────────────────── */}
      {showDetails && (
        <aside className="hidden w-[360px] shrink-0 flex-col border-l border-border lg:flex">
          <Tabs defaultValue="details" className="flex h-full min-h-0 flex-col">
            <div className="border-b border-border px-4 py-3">
              <TabsList className="bg-secondary">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="flow">Flow</TabsTrigger>
              </TabsList>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <TabsContent value="details" className="mt-0">
                {run ? (
                  <RunDetails s={run} />
                ) : (
                  <p className="px-4 py-6 text-sm text-muted-foreground">
                    Send a message to see the classification, decomposition, severity, and escalation.
                  </p>
                )}
              </TabsContent>
              <TabsContent value="flow" className="mt-0">
                <PipelineFlow s={run ?? undefined} loading={loading} progress={progress} />
              </TabsContent>
            </div>
          </Tabs>
        </aside>
      )}
    </div>
  );
}

/** "Act as" dropdown: choose a customer (or Guest). Occupied customers are
 *  shown locked and can't be selected by another session. */
function UserPicker({
  users,
  selected,
  onSelect,
}: {
  users: UserPresence[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const current = users.find((u) => u.id === selected);
  const label = current ? current.name : "Guest (no account)";

  function choose(id: string) {
    setOpen(false);
    onSelect(id);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-left text-sm transition-colors hover:bg-secondary/60"
      >
        <UserRound className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{label}</span>
        {current && (
          <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {current.plan}
          </span>
        )}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-md">
          <Row label="Guest (no account)" active={!selected} onClick={() => choose("")} />
          {users.map((u) => {
            const locked = u.occupied && !u.mine;
            return (
              <Row
                key={u.id}
                label={u.name}
                hint={locked ? "in use" : u.plan}
                locked={locked}
                active={u.id === selected}
                onClick={() => (locked ? undefined : choose(u.id))}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  hint,
  active,
  locked,
  onClick,
}: {
  label: string;
  hint?: string;
  active?: boolean;
  locked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={locked}
      className={
        "flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm transition-colors " +
        (locked
          ? "cursor-not-allowed text-muted-foreground/60"
          : "hover:bg-secondary/60") +
        (active ? " bg-secondary/40" : "")
      }
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {active ? <Check className="size-3.5" /> : locked ? <Lock className="size-3 opacity-60" /> : null}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {hint && (
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{hint}</span>
      )}
    </button>
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

