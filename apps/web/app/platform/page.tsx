"use client";
// Platform admin console — the LIVE config store. Admins add/edit KB docs,
// declarative use cases, and SSRF-safe HTTP tools; everything hot-reloads on the
// agent and every change is written to the audit log.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Bot,
  ChevronDown,
  ChevronRight,
  FileJson,
  History,
  Loader2,
  Lock,
  MessageCircleQuestion,
  Plus,
  Save,
  Scale,
  Sparkles,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AdminHeader } from "@/components/admin-nav";
import { adminAgents, listDashboardTickets, listEscalations, platform } from "@/lib/api";
import { useRequireRole } from "@/lib/auth";
import type {
  ConfigAuditRecord,
  EscalationRecord,
  FaqEntry,
  FaqMatchMode,
  HttpToolSpec,
  HumanAgentAdmin,
  KbDoc,
  PolicyConfig,
  SpecialistAgentRecord,
  StoredUseCase,
  TicketDashboardRow,
  ToolInfo,
} from "@/lib/types";

type Tab = "kb" | "usecases" | "tools" | "specialists" | "policies" | "faq" | "agents" | "audit";

const TABS: { id: Tab; label: string; icon: typeof BookOpen }[] = [
  { id: "specialists", label: "Specialists", icon: Bot },
  { id: "usecases", label: "Use cases", icon: FileJson },
  { id: "policies", label: "Policies", icon: Scale },
  { id: "faq", label: "FAQ", icon: MessageCircleQuestion },
  { id: "kb", label: "Knowledge base", icon: BookOpen },
  { id: "tools", label: "HTTP tools", icon: Wrench },
  { id: "agents", label: "Human agents", icon: Users },
  { id: "audit", label: "Audit log", icon: History },
];

export default function PlatformPage() {
  const account = useRequireRole("admin");
  const [tab, setTab] = useState<Tab>("specialists");

  if (!account) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AdminHeader title="Platform" subtitle="Live config store — changes hot-reload the agent" role="admin" />

      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="mb-6 flex flex-wrap gap-1 border-b border-border">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  "flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors " +
                  (tab === t.id
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground")
                }
              >
                <Icon className="size-4" /> {t.label}
              </button>
            );
          })}
        </div>

        {tab === "specialists" && <SpecialistsTab />}
        {tab === "usecases" && <UseCasesTab />}
        {tab === "policies" && <PoliciesTab />}
        {tab === "faq" && <FaqTab />}
        {tab === "kb" && <KbTab />}
        {tab === "tools" && <ToolsTab />}
        {tab === "agents" && <HumanAgentsTab />}
        {tab === "audit" && <AuditTab />}
      </div>
    </div>
  );
}

function ErrorNote({ msg }: { msg: string }) {
  if (!msg) return null;
  return <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{msg}</p>;
}

// ---- KB tab ----------------------------------------------------------------
function KbTab() {
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [file, setFile] = useState("");
  const [content, setContent] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // AI suggestion state
  const [resolved, setResolved] = useState<TicketDashboardRow[]>([]);
  const [suggestTicket, setSuggestTicket] = useState("");
  const [generating, setGenerating] = useState(false);
  const [draftNote, setDraftNote] = useState("");

  const load = useCallback(async () => {
    const { docs } = await platform.listKb();
    setDocs(docs);
  }, []);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    void listDashboardTickets().then((all) =>
      setResolved(all.filter((t) => t.status === "resolved" || t.run_count > 0))
    );
  }, []);

  async function generate() {
    if (!suggestTicket) return;
    setErr("");
    setDraftNote("");
    setGenerating(true);
    try {
      const { draft } = await platform.suggestKb({ ticket_id: suggestTicket });
      // Load the draft into the editor as a NEW document for review + edit.
      setSel(null);
      setFile(draft.filename);
      setContent(draft.content);
      setDraftNote(
        draft.source === "llm"
          ? "AI draft loaded — review and edit, then Save to publish."
          : "Draft assembled from the ticket (no LLM configured) — review and edit, then Save."
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  function edit(d: KbDoc) {
    setSel(d.file);
    setFile(d.file);
    setContent(d.content);
    setErr("");
  }
  function fresh() {
    setSel(null);
    setFile("");
    setContent("");
    setErr("");
  }

  async function save() {
    setErr("");
    setBusy(true);
    try {
      await platform.putKb(file, content);
      await load();
      setSel(file);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(f: string) {
    await platform.deleteKb(f);
    if (sel === f) fresh();
    await load();
  }

  return (
    <div className="grid gap-6 md:grid-cols-[240px_1fr]">
      <div>
        <Button size="sm" variant="outline" className="mb-2 w-full gap-2" onClick={fresh}>
          <Plus className="size-3.5" /> New document
        </Button>
        <div className="space-y-1">
          {docs.map((d) => (
            <div
              key={d.file}
              className={
                "flex items-center justify-between rounded-md px-2 py-1.5 text-sm " +
                (sel === d.file ? "bg-secondary" : "hover:bg-secondary/50")
              }
            >
              <button onClick={() => edit(d)} className="min-w-0 flex-1 truncate text-left">
                {d.file}
                <span className="ml-1 text-[10px] text-muted-foreground">{d.bytes}b</span>
              </button>
              <button onClick={() => void remove(d.file)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {/* AI: suggest an article from a resolved ticket */}
        <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <span className="text-sm font-medium">Suggest an article from a resolved ticket</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={suggestTicket}
              onChange={(e) => setSuggestTicket(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-foreground/40"
            >
              <option value="">Choose a ticket…</option>
              {resolved.map((t) => (
                <option key={t.ticket_id} value={t.ticket_id}>
                  {t.display_id} — {t.title?.slice(0, 60) || "(no title)"}
                </option>
              ))}
            </select>
            <Button size="sm" className="gap-2" onClick={() => void generate()} disabled={generating || !suggestTicket}>
              {generating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              Generate draft
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Drafts the article from the ticket&apos;s resolution and findings. Nothing is saved until you review and click Save.
          </p>
          {draftNote && <p className="mt-1.5 text-xs font-medium text-primary">{draftNote}</p>}
        </div>

        <input
          value={file}
          onChange={(e) => setFile(e.target.value)}
          placeholder="filename.md"
          disabled={!!sel}
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-foreground/40 disabled:opacity-60"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="# Heading&#10;Markdown content the agents can retrieve…"
          rows={18}
          className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs outline-none focus:border-foreground/40"
        />
        <ErrorNote msg={err} />
        <div className="flex items-center gap-2">
          <Button size="sm" className="gap-2" onClick={() => void save()} disabled={busy || !file}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save
          </Button>
          <span className="text-xs text-muted-foreground">Edits are live on the next ticket.</span>
        </div>
      </div>
    </div>
  );
}

// ---- Use cases tab ---------------------------------------------------------
interface UseCaseForm {
  use_case_id: string;
  description: string;
  prompt: string;
  utterances: string;
  tools: string[];
  kbFiles: string[];
  canAskUser: boolean;
}

const EMPTY_FORM: UseCaseForm = {
  use_case_id: "",
  description: "",
  prompt: "",
  utterances: "",
  tools: [],
  kbFiles: [],
  canAskUser: true,
};

function UseCasesTab() {
  const [agents, setAgents] = useState<string[]>([]);
  const [items, setItems] = useState<StoredUseCase[]>([]);
  const [agent, setAgent] = useState("");
  const [mode, setMode] = useState<"form" | "json">("form");
  const [form, setForm] = useState<UseCaseForm>(EMPTY_FORM);
  const [json, setJson] = useState("");
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [availableKb, setAvailableKb] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ agents, usecases }, tools, kb] = await Promise.all([
      platform.listUseCases(),
      platform.listTools(),
      platform.listKb(),
    ]);
    setAgents(agents);
    setItems(usecases);
    setAvailableTools([...tools.builtins.map((t) => t.name), ...tools.declarative.map((t) => t.name)]);
    setAvailableKb(kb.docs.map((d) => d.file));
    if (!agent && agents.length) setAgent(agents[0]);
  }, [agent]);
  useEffect(() => void load(), [load]);

  function formToDef(f: UseCaseForm) {
    const utterances = f.utterances
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      use_case_id: f.use_case_id.trim(),
      description: f.description.trim(),
      example_utterances: utterances,
      prompt: f.prompt.trim(),
      capabilities: {
        tools: f.tools,
        knowledge_base: f.kbFiles.map((knowledge_file) => ({ knowledge_file })),
        can_ask_user: f.canAskUser,
      },
    };
  }

  async function save() {
    setErr("");
    setBusy(true);
    try {
      const def = mode === "form" ? formToDef(form) : JSON.parse(json);
      await platform.putUseCase(agent, def);
      await load();
      setForm(EMPTY_FORM);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(a: string, id: string) {
    await platform.deleteUseCase(a, id);
    await load();
  }
  function editInForm(u: StoredUseCase) {
    setAgent(u.agent);
    setMode("form");
    setForm({
      use_case_id: u.def.use_case_id,
      description: u.def.description ?? "",
      prompt: (u.def as any).prompt ?? "",
      utterances: (u.def.example_utterances ?? []).join("\n"),
      tools: u.def.capabilities?.tools ?? [],
      kbFiles: (u.def.capabilities?.knowledge_base ?? []).map((k) => k.knowledge_file),
      canAskUser: (u.def.capabilities as any)?.can_ask_user ?? true,
    });
  }

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_420px]">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Registered use cases
        </p>
        <div className="space-y-2">
          {items.map((u) => (
            <div key={`${u.agent}/${u.def.use_case_id}`} className="rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{u.agent}</Badge>
                  <span className="text-sm font-medium">{u.def.use_case_id}</span>
                  {u.def.enabled === false && <Badge variant="secondary">disabled</Badge>}
                </div>
                <button
                  onClick={() => void remove(u.agent, u.def.use_case_id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              {u.def.description && (
                <p className="mt-1 text-xs text-muted-foreground">{u.def.description}</p>
              )}
              <div className="mt-1 flex flex-wrap gap-1">
                {(u.def.capabilities?.tools ?? []).map((t) => (
                  <span key={t} className="rounded bg-secondary px-1.5 py-0.5 text-[10px]">{t}</span>
                ))}
                {(u.def.capabilities?.knowledge_base ?? []).map((k) => (
                  <span key={k.knowledge_file} className="rounded bg-secondary px-1.5 py-0.5 text-[10px]">
                    KB:{k.knowledge_file}
                  </span>
                ))}
              </div>
              <button
                onClick={() => editInForm(u)}
                className="mt-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              >
                Edit →
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">Agent</label>
          <select value={agent} onChange={(e) => setAgent(e.target.value)} className="input max-w-[140px]">
            {agents.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <div className="ml-auto flex rounded-md border border-border p-0.5 text-xs">
            {(["form", "json"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  if (m === "json") setJson(JSON.stringify(formToDef(form), null, 2));
                  setMode(m);
                }}
                className={
                  "rounded px-2 py-1 capitalize " +
                  (mode === m ? "bg-secondary text-foreground" : "text-muted-foreground")
                }
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {mode === "form" ? (
          <div className="space-y-3">
            <Field label="Use case id (e.g. reset_password)">
              <input
                value={form.use_case_id}
                onChange={(e) => setForm({ ...form, use_case_id: e.target.value })}
                placeholder="reset_password"
                className="input"
              />
            </Field>
            <Field label="Description">
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What this use case handles"
                className="input"
              />
            </Field>
            <Field label="Example utterances (one per line)">
              <textarea
                value={form.utterances}
                onChange={(e) => setForm({ ...form, utterances: e.target.value })}
                rows={3}
                placeholder={"I forgot my password\nhow do I reset my login"}
                className="input"
              />
            </Field>
            <Field label="Prompt (instructions for the handler)">
              <textarea
                value={form.prompt}
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                rows={4}
                className="input"
              />
            </Field>
            <Field label="Tools">
              <div className="flex flex-wrap gap-1.5">
                {availableTools.length === 0 && (
                  <span className="text-xs text-muted-foreground">No tools available.</span>
                )}
                {availableTools.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm({ ...form, tools: toggle(form.tools, t) })}
                    className={
                      "rounded-md border px-2 py-1 text-xs transition-colors " +
                      (form.tools.includes(t)
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted-foreground hover:text-foreground")
                    }
                  >
                    {t}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Knowledge base docs">
              <div className="flex flex-wrap gap-1.5">
                {availableKb.length === 0 && (
                  <span className="text-xs text-muted-foreground">No KB docs available.</span>
                )}
                {availableKb.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setForm({ ...form, kbFiles: toggle(form.kbFiles, f) })}
                    className={
                      "rounded-md border px-2 py-1 text-xs transition-colors " +
                      (form.kbFiles.includes(f)
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted-foreground hover:text-foreground")
                    }
                  >
                    {f}
                  </button>
                ))}
              </div>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.canAskUser}
                onChange={(e) => setForm({ ...form, canAskUser: e.target.checked })}
              />
              Can ask the user follow-up questions
            </label>
          </div>
        ) : (
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            rows={20}
            className="input font-mono text-xs"
          />
        )}

        <ErrorNote msg={err} />
        <div className="flex gap-2">
          <Button size="sm" className="gap-2" onClick={() => void save()} disabled={busy || !agent}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save & reload agent
          </Button>
          <Button size="sm" variant="outline" onClick={() => setForm(EMPTY_FORM)}>
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- Human agents tab ------------------------------------------------------
function HumanAgentsTab() {
  const [agents, setAgents] = useState<HumanAgentAdmin[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [escalations, setEscalations] = useState<EscalationRecord[]>([]);
  const [query, setQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [caseFilter, setCaseFilter] = useState<"open" | "resolved" | "all">("all");

  // New-agent form
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [dept, setDept] = useState("");
  const [level, setLevel] = useState<"agent" | "manager">("agent");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ agents, departments }, esc] = await Promise.all([adminAgents.list(), listEscalations()]);
    setAgents(agents);
    setDepartments(departments);
    setEscalations(esc.escalations);
    if (!dept && departments.length) setDept(departments[0]);
  }, [dept]);
  useEffect(() => void load(), [load]);

  const visible = useMemo(
    () =>
      agents.filter(
        (a) =>
          (deptFilter === "all" || a.department === deptFilter) &&
          a.name.toLowerCase().includes(query.toLowerCase())
      ),
    [agents, deptFilter, query]
  );

  async function create() {
    setErr("");
    setBusy(true);
    try {
      await adminAgents.create({ name, title, department: dept, level, email, password: password || undefined });
      setName("");
      setTitle("");
      setEmail("");
      setPassword("");
      setLevel("agent");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_360px]">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            className="input max-w-[220px]"
          />
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="input max-w-[200px]">
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">{visible.length} agents</span>
        </div>

        <div className="space-y-2">
          {visible.map((a) => {
            const isOpen = expanded === a.id;
            const cases = escalations
              .filter((e) => e.assignee_id === a.id)
              .filter((e) => (caseFilter === "all" ? true : e.status === caseFilter));
            return (
              <div key={a.id} className="overflow-hidden rounded-lg border border-border">
                <button
                  onClick={() => setExpanded(isOpen ? null : a.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-secondary/40"
                >
                  {isOpen ? (
                    <ChevronDown className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{a.name}</span>
                      <Badge variant="outline">{a.department}</Badge>
                      {a.level === "manager" && <Badge variant="secondary">Manager</Badge>}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {a.title} · {a.email ?? "no login"}
                    </p>
                  </div>
                  <div className="flex gap-1.5 text-[11px]">
                    <Badge variant="warning">{a.counts.open} open</Badge>
                    <Badge variant="success">{a.counts.resolved} resolved</Badge>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-border bg-card/40 px-3 py-3">
                    <div className="mb-2 flex gap-1">
                      {(["open", "resolved", "all"] as const).map((f) => (
                        <button
                          key={f}
                          onClick={() => setCaseFilter(f)}
                          className={
                            "rounded px-2 py-1 text-xs capitalize " +
                            (caseFilter === f ? "bg-secondary text-foreground" : "text-muted-foreground")
                          }
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                    {cases.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No {caseFilter === "all" ? "" : caseFilter} cases.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {cases.map((e) => (
                          <div key={e.id} className="rounded-md border border-border px-2.5 py-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate font-medium">{e.subject || "(no subject)"}</span>
                              <Badge variant={e.status === "open" ? "warning" : "success"}>{e.status}</Badge>
                            </div>
                            <p className="mt-0.5 text-muted-foreground">
                              {e.customer_name} · {new Date(e.created_at).toLocaleString()}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          New escalation agent
        </p>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" className="input" />
        </Field>
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Billing Specialist" className="input" />
        </Field>
        <Field label="Department">
          <select value={dept} onChange={(e) => setDept(e.target.value)} className="input">
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </Field>
        <Field label="Level">
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as "agent" | "manager")}
            className="input"
          >
            <option value="agent">Agent (front-line)</option>
            <option value="manager">Manager (handles handoffs)</option>
          </select>
        </Field>
        <Field label="Login email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@support.test"
            className="input"
          />
        </Field>
        <Field label="Password (optional — defaults to demo1234)">
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="demo1234"
            className="input"
          />
        </Field>
        <ErrorNote msg={err} />
        <Button size="sm" className="gap-2" onClick={() => void create()} disabled={busy || !name || !email}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Create agent + login
        </Button>
      </div>
    </div>
  );
}

// ---- Tools tab -------------------------------------------------------------
const EMPTY_TOOL: HttpToolSpec = {
  name: "",
  description: "",
  method: "GET",
  url_template: "https://api.example.com/resource/{id}",
};

function ToolsTab() {
  const [builtins, setBuiltins] = useState<ToolInfo[]>([]);
  const [declarative, setDeclarative] = useState<HttpToolSpec[]>([]);
  const [form, setForm] = useState<HttpToolSpec>(EMPTY_TOOL);
  const [hostsText, setHostsText] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { builtins, declarative } = await platform.listTools();
    setBuiltins(builtins);
    setDeclarative(declarative);
  }, []);
  useEffect(() => void load(), [load]);

  function editTool(t: HttpToolSpec) {
    setForm(t);
    setHostsText((t.allowed_hosts ?? []).join(", "));
    setHeadersText(t.headers ? JSON.stringify(t.headers, null, 2) : "");
    setErr("");
  }
  function fresh() {
    setForm(EMPTY_TOOL);
    setHostsText("");
    setHeadersText("");
    setErr("");
  }

  async function save() {
    setErr("");
    setBusy(true);
    try {
      const spec: Record<string, unknown> = {
        description: form.description,
        method: form.method,
        url_template: form.url_template,
      };
      const hosts = hostsText.split(",").map((s) => s.trim()).filter(Boolean);
      if (hosts.length) spec.allowed_hosts = hosts;
      if (form.timeout_ms) spec.timeout_ms = Number(form.timeout_ms);
      if (headersText.trim()) spec.headers = JSON.parse(headersText);
      await platform.putTool(form.name, spec);
      await load();
      fresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(name: string) {
    await platform.deleteTool(name);
    await load();
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_380px]">
      <div className="space-y-5">
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
          <p className="text-xs text-muted-foreground">
            HTTP tools are declarative (data, not code). Every call is SSRF-guarded: scheme + host
            allowlist, private/loopback IPs blocked, no redirects, bounded timeout, and only the
            headers you declare are sent.
          </p>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Declarative HTTP tools
          </p>
          <div className="space-y-2">
            {declarative.length === 0 && (
              <p className="text-sm text-muted-foreground">None yet — add one on the right.</p>
            )}
            {declarative.map((t) => (
              <div key={t.name} className="rounded-lg border border-border px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{t.method}</Badge>
                    <span className="text-sm font-medium">{t.name}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => editTool(t)} className="text-xs text-muted-foreground hover:text-foreground">
                      Edit
                    </button>
                    <button onClick={() => void remove(t.name)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">{t.url_template}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Built-in tools (read-only)
          </p>
          <div className="flex flex-wrap gap-1">
            {builtins.map((t) => (
              <span key={t.name} className="rounded bg-secondary px-2 py-1 text-xs" title={t.description}>
                {t.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <Field label="Name">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="weatherLookup"
            className="input"
          />
        </Field>
        <Field label="Description">
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="What this tool fetches"
            className="input"
          />
        </Field>
        <Field label="Method">
          <select
            value={form.method}
            onChange={(e) => setForm({ ...form, method: e.target.value as HttpToolSpec["method"] })}
            className="input"
          >
            {["GET", "POST", "PUT", "DELETE"].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="URL template ({param} placeholders)">
          <input
            value={form.url_template}
            onChange={(e) => setForm({ ...form, url_template: e.target.value })}
            className="input font-mono text-xs"
          />
        </Field>
        <Field label="Allowed hosts (comma-separated; defaults to URL host)">
          <input
            value={hostsText}
            onChange={(e) => setHostsText(e.target.value)}
            placeholder="api.example.com"
            className="input"
          />
        </Field>
        <Field label="Headers (JSON, optional)">
          <textarea
            value={headersText}
            onChange={(e) => setHeadersText(e.target.value)}
            rows={3}
            placeholder='{ "X-Api-Key": "..." }'
            className="input font-mono text-xs"
          />
        </Field>
        <Field label="Timeout ms (optional)">
          <input
            type="number"
            value={form.timeout_ms ?? ""}
            onChange={(e) => setForm({ ...form, timeout_ms: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="5000"
            className="input"
          />
        </Field>
        <ErrorNote msg={err} />
        <div className="flex gap-2">
          <Button size="sm" className="gap-2" onClick={() => void save()} disabled={busy || !form.name}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save tool
          </Button>
          <Button size="sm" variant="outline" onClick={fresh}>Clear</Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

// Small accessible toggle used across the policy editors.
function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:bg-secondary/30">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors " +
          (checked ? "bg-primary" : "bg-secondary")
        }
      >
        <span
          className={
            "inline-block size-4 transform rounded-full bg-background shadow transition-transform " +
            (checked ? "translate-x-4" : "translate-x-0.5")
          }
        />
      </button>
    </label>
  );
}

// ---- Specialists tab -------------------------------------------------------
interface SpecialistForm {
  name: string;
  label: string;
  description: string;
  team: string;
  keywords: string;
}
const EMPTY_SPECIALIST: SpecialistForm = { name: "", label: "", description: "", team: "", keywords: "" };

function SpecialistsTab() {
  const [agents, setAgents] = useState<SpecialistAgentRecord[]>([]);
  const [form, setForm] = useState<SpecialistForm>(EMPTY_SPECIALIST);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { agents } = await platform.listSpecialists();
    setAgents(agents);
  }, []);
  useEffect(() => void load(), [load]);

  function fresh() {
    setForm(EMPTY_SPECIALIST);
    setEditing(false);
    setErr("");
  }
  function edit(a: SpecialistAgentRecord) {
    setForm({
      name: a.name,
      label: a.label,
      description: a.description,
      team: a.team,
      keywords: a.keywords.join(", "),
    });
    setEditing(true);
    setErr("");
  }

  async function save() {
    setErr("");
    setBusy(true);
    try {
      const keywords = form.keywords
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      await platform.putSpecialist(form.name.trim(), {
        name: form.name.trim(),
        label: form.label.trim(),
        description: form.description.trim(),
        team: form.team.trim(),
        keywords,
      });
      await load();
      fresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(name: string) {
    await platform.deleteSpecialist(name);
    if (form.name === name) fresh();
    await load();
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_380px]">
      <div>
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5">
          <Bot className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="text-xs text-muted-foreground">
            Specialists are the AI agents the pipeline routes work to. The three built-ins are fixed;
            add your own, then give it behavior under <span className="font-medium text-foreground">Use cases</span>{" "}
            (prompts, tools, knowledge). Keywords help the router pick it offline; the description guides the LLM router.
          </p>
        </div>

        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Registered specialists ({agents.length})
        </p>
        <div className="space-y-2">
          {agents.map((a) => (
            <div key={a.name} className="rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{a.name}</Badge>
                  <span className="text-sm font-medium">{a.label}</span>
                  {a.builtin ? (
                    <Badge variant="secondary" className="gap-1">
                      <Lock className="size-3" /> built-in
                    </Badge>
                  ) : (
                    <Badge variant="success">custom</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!a.builtin && (
                    <>
                      <button onClick={() => edit(a)} className="text-xs text-muted-foreground hover:text-foreground">
                        Edit
                      </button>
                      <button
                        onClick={() => void remove(a.name)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{a.description}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px]">team: {a.team}</span>
                {a.keywords.slice(0, 8).map((k) => (
                  <span key={k} className="rounded bg-secondary px-1.5 py-0.5 text-[10px]">{k}</span>
                ))}
                {a.keywords.length > 8 && (
                  <span className="text-[10px] text-muted-foreground">+{a.keywords.length - 8} more</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {editing ? `Edit specialist "${form.name}"` : "New specialist"}
        </p>
        <Field label="Agent id (lowercase, e.g. shipping)">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase() })}
            placeholder="shipping"
            disabled={editing}
            className="input disabled:opacity-60"
          />
        </Field>
        <Field label="Display label">
          <input
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="Shipping & Delivery"
            className="input"
          />
        </Field>
        <Field label="Description (guides the LLM router)">
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            placeholder="shipment tracking, delivery delays, lost packages, address changes"
            className="input"
          />
        </Field>
        <Field label="Escalation team (handoff target)">
          <input
            value={form.team}
            onChange={(e) => setForm({ ...form, team: e.target.value })}
            placeholder="Logistics Lead"
            className="input"
          />
        </Field>
        <Field label="Routing keywords (comma or newline separated)">
          <textarea
            value={form.keywords}
            onChange={(e) => setForm({ ...form, keywords: e.target.value })}
            rows={3}
            placeholder="shipping, delivery, tracking, package, courier"
            className="input"
          />
        </Field>
        <ErrorNote msg={err} />
        <div className="flex gap-2">
          <Button
            size="sm"
            className="gap-2"
            onClick={() => void save()}
            disabled={busy || !form.name || !form.label || !form.description || !form.team}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            {editing ? "Save specialist" : "Create specialist"}
          </Button>
          <Button size="sm" variant="outline" onClick={fresh}>
            Clear
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          New agents start empty — add use cases to give them tools, prompts and knowledge.
        </p>
      </div>
    </div>
  );
}

// ---- FAQ tab ---------------------------------------------------------------
interface FaqForm {
  id: string | null;
  label: string;
  enabled: boolean;
  match: FaqMatchMode;
  triggers: string;
  answer: string;
}
const EMPTY_FAQ: FaqForm = {
  id: null,
  label: "",
  enabled: true,
  match: "contains",
  triggers: "",
  answer: "",
};

function FaqTab() {
  const [faqs, setFaqs] = useState<FaqEntry[]>([]);
  const [form, setForm] = useState<FaqForm>(EMPTY_FAQ);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { faqs } = await platform.listFaqs();
    setFaqs(faqs);
  }, []);
  useEffect(() => void load(), [load]);

  function fresh() {
    setForm(EMPTY_FAQ);
    setErr("");
  }
  function edit(f: FaqEntry) {
    setForm({
      id: f.id,
      label: f.label,
      enabled: f.enabled,
      match: f.match,
      triggers: f.triggers.join("\n"),
      answer: f.answer,
    });
    setErr("");
  }

  async function save() {
    setErr("");
    setBusy(true);
    try {
      const triggers = form.triggers
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const body = {
        label: form.label.trim(),
        enabled: form.enabled,
        match: form.match,
        triggers,
        answer: form.answer.trim(),
      };
      if (form.id) await platform.putFaq(form.id, body);
      else await platform.createFaq(body);
      await load();
      fresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    await platform.deleteFaq(id);
    if (form.id === id) fresh();
    await load();
  }
  async function toggleEnabled(f: FaqEntry) {
    await platform.putFaq(f.id, {
      label: f.label,
      enabled: !f.enabled,
      match: f.match,
      triggers: f.triggers,
      answer: f.answer,
    });
    await load();
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_380px]">
      <div>
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5">
          <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="text-xs text-muted-foreground">
            FAQs are canned answers checked <span className="font-medium text-foreground">first</span> — before
            intent routing and any specialist agent (the same way greetings are handled). When a customer message
            matches an entry&apos;s triggers, the engine replies with its answer and runs nothing else. Great for
            hours, locations, generic policies, and other repeat questions.
          </p>
        </div>

        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          FAQ entries ({faqs.length})
        </p>
        {faqs.length === 0 && (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            No FAQs yet. Add one on the right — e.g. trigger “what are your hours” → answer “We&apos;re open 9–6,
            Mon–Sat.”
          </p>
        )}
        <div className="space-y-2">
          {faqs.map((f) => (
            <div key={f.id} className="rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{f.label}</span>
                  <Badge variant="outline">{f.match}</Badge>
                  {f.enabled ? (
                    <Badge variant="success">enabled</Badge>
                  ) : (
                    <Badge variant="secondary">disabled</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void toggleEnabled(f)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {f.enabled ? "Disable" : "Enable"}
                  </button>
                  <button onClick={() => edit(f)} className="text-xs text-muted-foreground hover:text-foreground">
                    Edit
                  </button>
                  <button onClick={() => void remove(f.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
              <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{f.answer}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {f.triggers.slice(0, 6).map((t, i) => (
                  <span key={i} className="rounded bg-secondary px-1.5 py-0.5 text-[10px]">{t}</span>
                ))}
                {f.triggers.length > 6 && (
                  <span className="text-[10px] text-muted-foreground">+{f.triggers.length - 6} more</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {form.id ? `Edit FAQ “${form.label || "entry"}”` : "New FAQ"}
        </p>
        <Field label="Label (internal name)">
          <input
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="Store hours"
            className="input"
          />
        </Field>
        <Field label="Match mode">
          <select
            value={form.match}
            onChange={(e) => setForm({ ...form, match: e.target.value as FaqMatchMode })}
            className="input"
          >
            <option value="contains">contains — message includes the phrase</option>
            <option value="exact">exact — message equals the phrase</option>
            <option value="regex">regex — advanced pattern</option>
          </select>
        </Field>
        <Field label="Trigger phrases (one per line)">
          <textarea
            value={form.triggers}
            onChange={(e) => setForm({ ...form, triggers: e.target.value })}
            rows={4}
            placeholder={"what are your hours\nwhen are you open\nopening hours"}
            className="input"
          />
        </Field>
        <Field label="Answer (sent to the customer verbatim)">
          <textarea
            value={form.answer}
            onChange={(e) => setForm({ ...form, answer: e.target.value })}
            rows={4}
            placeholder="We're open 9am–6pm, Monday to Saturday."
            className="input"
          />
        </Field>
        <Toggle
          checked={form.enabled}
          onChange={(v) => setForm({ ...form, enabled: v })}
          label="Enabled"
          hint="Only enabled FAQs are matched against incoming messages."
        />
        <ErrorNote msg={err} />
        <div className="flex gap-2">
          <Button
            size="sm"
            className="gap-2"
            onClick={() => void save()}
            disabled={busy || !form.label.trim() || !form.triggers.trim() || !form.answer.trim()}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            {form.id ? "Save FAQ" : "Create FAQ"}
          </Button>
          <Button size="sm" variant="outline" onClick={fresh}>
            Clear
          </Button>
        </div>
        {form.match === "regex" && (
          <p className="text-xs text-muted-foreground">
            Regex is matched case-insensitively against the raw message. Invalid patterns simply never match.
          </p>
        )}
      </div>
    </div>
  );
}

// ---- Policies tab ----------------------------------------------------------
function PoliciesTab() {
  const [cfg, setCfg] = useState<PolicyConfig | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void platform.getPolicies().then(({ policies }) => setCfg(policies));
  }, []);

  async function save() {
    if (!cfg) return;
    setErr("");
    setBusy(true);
    setSaved(false);
    try {
      const { policies } = await platform.putPolicies(cfg);
      setCfg(policies);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading policies…
      </div>
    );
  }

  const rules = cfg.escalation.rules;
  const setRule = (k: keyof PolicyConfig["escalation"]["rules"], v: boolean) =>
    setCfg({ ...cfg, escalation: { rules: { ...rules, [k]: v } } });

  return (
    <div className="space-y-6">
      {/* Hard checks */}
      <section className="rounded-xl border border-border bg-card/40 p-5">
        <div className="mb-3 flex items-center gap-2">
          <ShieldAlert className="size-4 text-amber-500" />
          <h3 className="text-sm font-semibold">Hard checks</h3>
          <span className="text-xs text-muted-foreground">Explicit phrases that force an escalation</span>
          <div className="ml-auto w-36">
            <Toggle
              checked={cfg.guard.enabled}
              onChange={(v) => setCfg({ ...cfg, guard: { ...cfg.guard, enabled: v } })}
              label={cfg.guard.enabled ? "Enabled" : "Disabled"}
            />
          </div>
        </div>
        <div className="space-y-2">
          {cfg.guard.signals.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={s.phrase}
                onChange={(e) => {
                  const signals = [...cfg.guard.signals];
                  signals[i] = { ...signals[i], phrase: e.target.value };
                  setCfg({ ...cfg, guard: { ...cfg.guard, signals } });
                }}
                placeholder="phrase (substring, case-insensitive)"
                className="input flex-1"
              />
              <input
                value={s.category}
                onChange={(e) => {
                  const signals = [...cfg.guard.signals];
                  signals[i] = { ...signals[i], category: e.target.value };
                  setCfg({ ...cfg, guard: { ...cfg.guard, signals } });
                }}
                placeholder="category"
                className="input max-w-[180px]"
              />
              <button
                onClick={() => {
                  const signals = cfg.guard.signals.filter((_, j) => j !== i);
                  setCfg({ ...cfg, guard: { ...cfg.guard, signals } });
                }}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="mt-3 gap-1.5"
          onClick={() =>
            setCfg({
              ...cfg,
              guard: { ...cfg.guard, signals: [...cfg.guard.signals, { phrase: "", category: "human_request" }] },
            })
          }
        >
          <Plus className="size-3.5" /> Add phrase
        </Button>
      </section>

      {/* Escalation rules */}
      <section className="rounded-xl border border-border bg-card/40 p-5">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">Escalation rules</h3>
          <span className="text-xs text-muted-foreground">Which conditions are allowed to open a human escalation</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle checked={rules.hard_guard} onChange={(v) => setRule("hard_guard", v)} label="Hard signal match" hint="A hard-check phrase was detected" />
          <Toggle checked={rules.high_severity} onChange={(v) => setRule("high_severity", v)} label="High severity" hint="Impact assessed as high" />
          <Toggle checked={rules.unresolved} onChange={(v) => setRule("unresolved", v)} label="Unresolved by agents" hint="Investigation could not resolve it" />
          <Toggle checked={rules.conflicts} onChange={(v) => setRule("conflicts", v)} label="Conflicting findings" hint="Agents disagreed" />
          <Toggle checked={rules.specialist_handoff} onChange={(v) => setRule("specialist_handoff", v)} label="Specialist handoff" hint="A specialist explicitly requested a human" />
          <Toggle checked={rules.frustration_repeat} onChange={(v) => setRule("frustration_repeat", v)} label="Frustration + repeat" hint="Frustrated tone on a repeat/unresolved contact" />
        </div>
      </section>

      {/* Intent router */}
      <section className="rounded-xl border border-border bg-card/40 p-5">
        <div className="mb-3 flex items-center gap-2">
          <Scale className="size-4 text-emerald-500" />
          <h3 className="text-sm font-semibold">Intent router</h3>
          <span className="text-xs text-muted-foreground">Confidence thresholds for routing</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <ThresholdField
            label="Multi-issue threshold"
            hint="A domain counts toward a multi-issue split at/above this confidence."
            value={cfg.intents.multi_threshold}
            onChange={(v) => setCfg({ ...cfg, intents: { ...cfg.intents, multi_threshold: v } })}
          />
          <ThresholdField
            label="Fallback threshold"
            hint="Below this top confidence, route to the safe policy review instead of guessing."
            value={cfg.intents.fallback_threshold}
            onChange={(v) => setCfg({ ...cfg, intents: { ...cfg.intents, fallback_threshold: v } })}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Per-domain routing keywords live on each specialist (Specialists tab).
        </p>
      </section>

      <ErrorNote msg={err} />
      <div className="flex items-center gap-3">
        <Button size="sm" className="gap-2" onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save policies
        </Button>
        {saved && <span className="text-xs text-emerald-500">Saved — live on the next ticket.</span>}
      </div>
    </div>
  );
}

function ThresholdField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{label}</label>
        <span className="font-mono text-sm tabular-nums text-primary">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-primary"
      />
      <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

// ---- Audit tab -------------------------------------------------------------
function AuditTab() {
  const [rows, setRows] = useState<ConfigAuditRecord[]>([]);
  useEffect(() => {
    void platform.listAudit().then((d) => setRows(d.audit));
  }, []);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-card/60 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">When</th>
            <th className="px-3 py-2 font-medium">Who</th>
            <th className="px-3 py-2 font-medium">Action</th>
            <th className="px-3 py-2 font-medium">Target</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                No config changes recorded yet.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-3 py-2">{r.actor_name}</td>
                <td className="px-3 py-2">
                  <Badge variant="outline">{r.action}</Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{r.target}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
