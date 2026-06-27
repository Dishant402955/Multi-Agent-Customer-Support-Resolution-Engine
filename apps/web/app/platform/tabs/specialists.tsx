"use client";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { platform } from "@/lib/api";
import type { SpecialistAgentRecord, StoredUseCase } from "@/lib/types";
import { ErrorNote, Field, MultiSearchSelect, Pager, usePager } from "../ui";

interface SpecialistForm {
  name: string;
  label: string;
  description: string;
  team: string;
  keywords: string;
  tools: string[];
  kbFiles: string[];
}
const EMPTY: SpecialistForm = { name: "", label: "", description: "", team: "", keywords: "", tools: [], kbFiles: [] };

// The starter use case we seed/sync so that tools + KB picked at creation time
// actually become capabilities the agent can use.
const STARTER_USE_CASE = "general";

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function SpecialistsTab() {
  const [agents, setAgents] = useState<SpecialistAgentRecord[]>([]);
  const [usecases, setUsecases] = useState<StoredUseCase[]>([]);
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [availableKb, setAvailableKb] = useState<string[]>([]);
  const [form, setForm] = useState<SpecialistForm>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ agents }, { usecases }, tools, kb] = await Promise.all([
      platform.listSpecialists(),
      platform.listUseCases(),
      platform.listTools(),
      platform.listKb(),
    ]);
    setAgents(agents);
    setUsecases(usecases);
    setAvailableTools([...tools.builtins.map((t) => t.name), ...tools.declarative.map((t) => t.name)]);
    setAvailableKb(kb.docs.map((d) => d.file));
  }, []);
  useEffect(() => void load(), [load]);

  // The starter use case for an agent (if it exists), so tools/KB round-trip on edit.
  function starterFor(name: string): StoredUseCase | undefined {
    return usecases.find((u) => u.agent === name && u.def.use_case_id === STARTER_USE_CASE);
  }

  function fresh() { setForm(EMPTY); setEditing(false); setErr(""); }
  function edit(a: SpecialistAgentRecord) {
    const starter = starterFor(a.name);
    setForm({
      name: a.name,
      label: a.label,
      description: a.description,
      team: a.team,
      keywords: a.keywords.join(", "),
      tools: starter?.def.capabilities?.tools ?? [],
      kbFiles: (starter?.def.capabilities?.knowledge_base ?? []).map((k) => k.knowledge_file),
    });
    setEditing(true);
    setErr("");
  }

  async function save() {
    setErr(""); setBusy(true);
    try {
      const name = form.name.trim();
      const label = form.label.trim();
      const keywords = form.keywords.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      await platform.putSpecialist(name, { name, label, description: form.description.trim(), team: form.team.trim(), keywords });

      // Seed/sync the starter use case so the picked tools + KB become real
      // capabilities. Only write it when something is selected or one already
      // exists (so we don't create empty use cases for meta-only edits).
      const hasCaps = form.tools.length > 0 || form.kbFiles.length > 0;
      if (hasCaps || starterFor(name)) {
        await platform.putUseCase(name, {
          use_case_id: STARTER_USE_CASE,
          description: `General ${label || name} requests`,
          example_utterances: [],
          prompt: `You are the ${label || name} specialist. Help the customer using the available tools and knowledge.`,
          capabilities: {
            tools: form.tools,
            knowledge_base: form.kbFiles.map((knowledge_file) => ({ knowledge_file })),
            can_ask_user: true,
          },
        });
      }
      await load();
      fresh();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  async function remove(name: string) {
    await platform.deleteSpecialist(name);
    if (form.name === name) fresh();
    await load();
  }

  const { pageItems, ...pager } = usePager(agents, 5);

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_380px]">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Registered specialists ({agents.length})
        </p>
        <div className="space-y-2">
          {pageItems.map((a) => {
            const starter = starterFor(a.name);
            const tools = starter?.def.capabilities?.tools ?? [];
            const kb = (starter?.def.capabilities?.knowledge_base ?? []).map((k) => k.knowledge_file);
            return (
              <div key={a.name} className="rounded-lg border border-border px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{a.name}</Badge>
                    <span className="text-sm font-medium">{a.label}</span>
                    {a.builtin ? (
                      <Badge variant="secondary" className="gap-1"><Lock className="size-3" /> built-in</Badge>
                    ) : (
                      <Badge variant="success">custom</Badge>
                    )}
                  </div>
                  {!a.builtin && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => edit(a)} className="text-xs text-muted-foreground hover:text-foreground">Edit</button>
                      <button onClick={() => void remove(a.name)} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>
                    </div>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{a.description}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px]">team: {a.team}</span>
                  {a.keywords.slice(0, 6).map((k) => <span key={k} className="rounded bg-secondary px-1.5 py-0.5 text-[10px]">{k}</span>)}
                  {a.keywords.length > 6 && <span className="text-[10px] text-muted-foreground">+{a.keywords.length - 6} more</span>}
                </div>
                {(tools.length > 0 || kb.length > 0) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {tools.map((t) => <span key={t} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">tool:{t}</span>)}
                    {kb.map((f) => <span key={f} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">KB:{f}</span>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <Pager {...pager} />
      </div>

      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {editing ? `Edit specialist "${form.name}"` : "New specialist"}
        </p>
        <Field label="Agent id (lowercase, e.g. shipping)">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toLowerCase() })} placeholder="shipping" disabled={editing} className="input disabled:opacity-60" />
        </Field>
        <Field label="Display label">
          <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Shipping & Delivery" className="input" />
        </Field>
        <Field label="Description (guides the LLM router)">
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="shipment tracking, delivery delays, lost packages" className="input" />
        </Field>
        <Field label="Escalation team (handoff target)">
          <input value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} placeholder="Logistics Lead" className="input" />
        </Field>
        <Field label="Routing keywords (comma or newline separated)">
          <textarea value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} rows={2} placeholder="shipping, delivery, tracking, package" className="input" />
        </Field>
        <Field label="Tools this agent can use">
          {availableTools.length === 0 ? (
            <span className="text-xs text-muted-foreground">No tools available — add some under HTTP tools.</span>
          ) : (
            <MultiSearchSelect
              options={availableTools.map((t) => ({ value: t, label: t }))}
              values={form.tools}
              onToggle={(t) => setForm({ ...form, tools: toggle(form.tools, t) })}
              placeholder="Choose tools…"
              searchPlaceholder="Search tools…"
              emptyText="No tools match"
            />
          )}
        </Field>
        <Field label="Knowledge base docs">
          {availableKb.length === 0 ? (
            <span className="text-xs text-muted-foreground">No KB docs available — add some under Knowledge base.</span>
          ) : (
            <MultiSearchSelect
              options={availableKb.map((f) => ({ value: f, label: f }))}
              values={form.kbFiles}
              onToggle={(f) => setForm({ ...form, kbFiles: toggle(form.kbFiles, f) })}
              placeholder="Choose KB docs…"
              searchPlaceholder="Search docs…"
              emptyText="No docs match"
            />
          )}
        </Field>
        <ErrorNote msg={err} />
        <div className="flex gap-2">
          <Button size="sm" className="gap-2" onClick={() => void save()} disabled={busy || !form.name || !form.label || !form.description || !form.team}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            {editing ? "Save specialist" : "Create specialist"}
          </Button>
          <Button size="sm" variant="outline" onClick={fresh}>Clear</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Selecting tools or KB seeds a <span className="font-medium text-foreground">{STARTER_USE_CASE}</span> use case so the agent can use them right away.
        </p>
      </div>
    </div>
  );
}
