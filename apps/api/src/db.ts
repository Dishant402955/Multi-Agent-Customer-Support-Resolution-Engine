// SQLite store for tickets, messages, and pipeline runs.
// Uses Node's built-in node:sqlite (Node 22.5+/24) — no native build step.
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { ENV } from "./env";

export const db = new DatabaseSync(resolve(process.cwd(), ENV.DB_PATH));
db.exec("PRAGMA journal_mode = WAL;");
// Wait (up to 5s) for a held write lock instead of failing immediately — avoids
// transient "database is locked" errors when a watcher restart briefly overlaps.
db.exec("PRAGMA busy_timeout = 5000;");

db.exec(`
  CREATE TABLE IF NOT EXISTS tickets (
    ticket_id   TEXT PRIMARY KEY,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id   TEXT NOT NULL,
    role        TEXT NOT NULL,
    text        TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    run_id      TEXT PRIMARY KEY,
    ticket_id   TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    state_json  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS escalations (
    id             TEXT PRIMARY KEY,
    ticket_id      TEXT NOT NULL,
    customer_id    TEXT,
    customer_name  TEXT NOT NULL,
    subject        TEXT NOT NULL,
    department     TEXT NOT NULL,
    team           TEXT,
    urgency        TEXT,
    reason         TEXT,
    assignee_id    TEXT NOT NULL,
    assignee_name  TEXT NOT NULL,
    assignee_title TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'open',
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS presence_locks (
    customer_id TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    expires_at  INTEGER NOT NULL
  );
`);

// Migrations: columns added after the initial schema. Each is guarded by a
// column check before ALTER so boot is idempotent.
{
  const cols = db.prepare("PRAGMA table_info(tickets)").all() as any[];
  const has = (name: string) => cols.some((c) => c.name === name);

  if (!has("customer_id")) {
    db.exec("ALTER TABLE tickets ADD COLUMN customer_id TEXT");
  }
  // Friendly per-customer sequence number → displayed as T-001, T-002, …
  if (!has("seq")) {
    db.exec("ALTER TABLE tickets ADD COLUMN seq INTEGER");
    // Backfill existing tickets per customer, ordered by creation.
    const owners = db.prepare("SELECT DISTINCT customer_id FROM tickets").all() as any[];
    for (const o of owners) {
      const rows = db
        .prepare(
          "SELECT ticket_id FROM tickets WHERE customer_id IS ? ORDER BY created_at ASC, ticket_id ASC"
        )
        .all(o.customer_id) as any[];
      rows.forEach((r, i) => {
        db.prepare("UPDATE tickets SET seq = ? WHERE ticket_id = ?").run(i + 1, r.ticket_id);
      });
    }
  }
  // Links a follow-up "new linked ticket" back to the ticket it branched from.
  if (!has("parent_ticket_id")) {
    db.exec("ALTER TABLE tickets ADD COLUMN parent_ticket_id TEXT");
  }
}

// Escalation handoffs: who currently holds it (agent/manager) and the short note
// the agent wrote when passing it up.
{
  const cols = db.prepare("PRAGMA table_info(escalations)").all() as any[];
  const has = (name: string) => cols.some((c) => c.name === name);
  if (!has("assignee_level")) db.exec("ALTER TABLE escalations ADD COLUMN assignee_level TEXT");
  if (!has("handoff_note")) db.exec("ALTER TABLE escalations ADD COLUMN handoff_note TEXT");
}

/** Friendly per-customer display id from a stored seq (T-001), or the raw id. */
export function friendlyId(seq: number | null | undefined, ticketId: string): string {
  return seq ? `T-${String(seq).padStart(3, "0")}` : ticketId;
}

// Roles: customer = end user, system = AI assistant, agent = human support agent.
export type MessageRole = "customer" | "system" | "agent";

export interface StoredMessage {
  id?: number;
  role: MessageRole;
  text: string;
  timestamp: string;
}

export function ensureTicket(
  ticketId: string,
  customerId?: string | null,
  parentTicketId?: string | null
): void {
  const exists = db.prepare("SELECT 1 FROM tickets WHERE ticket_id = ?").get(ticketId);
  if (!exists) {
    const next = db
      .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM tickets WHERE customer_id IS ?")
      .get(customerId ?? null) as any;
    db.prepare(
      "INSERT INTO tickets (ticket_id, created_at, customer_id, seq, parent_ticket_id) VALUES (?, ?, ?, ?, ?)"
    ).run(
      ticketId,
      new Date().toISOString(),
      customerId ?? null,
      Number(next?.next ?? 1),
      parentTicketId ?? null
    );
  }
}

/** The friendly display id (T-001) for a ticket. */
export function getTicketDisplayId(ticketId: string): string {
  const row = db.prepare("SELECT seq FROM tickets WHERE ticket_id = ?").get(ticketId) as any;
  return friendlyId(row?.seq, ticketId);
}

/** The customer a ticket was opened as (null for anonymous/guest tickets). */
export function getTicketCustomer(ticketId: string): string | null {
  const row = db
    .prepare("SELECT customer_id FROM tickets WHERE ticket_id = ?")
    .get(ticketId) as any;
  return row?.customer_id ?? null;
}

export function ticketExists(ticketId: string): boolean {
  return !!db.prepare("SELECT 1 FROM tickets WHERE ticket_id = ?").get(ticketId);
}

export function getCustomerHistory(ticketId: string): StoredMessage[] {
  const rows = db
    .prepare("SELECT role, text, created_at FROM messages WHERE ticket_id = ? AND role = 'customer' ORDER BY id ASC")
    .all(ticketId) as any[];
  return rows.map((r) => ({ role: r.role, text: r.text, timestamp: r.created_at }));
}

/** Full conversation (both roles), ordered — used for display + agent context. */
export function getMessages(ticketId: string): StoredMessage[] {
  const rows = db
    .prepare("SELECT id, role, text, created_at FROM messages WHERE ticket_id = ? ORDER BY id ASC")
    .all(ticketId) as any[];
  return rows.map((r) => ({ id: r.id, role: r.role, text: r.text, timestamp: r.created_at }));
}

export interface TicketSummary {
  ticket_id: string;
  display_id: string;
  title: string;
  message_count: number;
  updated_at: string;
  status: TicketLifecycleStatus;
  parent_ticket_id: string | null;
}

/**
 * Tickets scoped to a customer, each with a friendly display id, lifecycle
 * status (active/escalated/resolved), and any parent link.
 */
export function listTickets(customerId?: string | null): TicketSummary[] {
  const sql = `SELECT t.ticket_id AS ticket_id,
              t.seq AS seq,
              t.parent_ticket_id AS parent_ticket_id,
              (SELECT m.text FROM messages m
                 WHERE m.ticket_id = t.ticket_id AND m.role = 'customer'
                 ORDER BY m.id ASC LIMIT 1) AS title,
              (SELECT COUNT(*) FROM messages m
                 WHERE m.ticket_id = t.ticket_id AND m.role = 'customer') AS message_count,
              (SELECT COUNT(*) FROM runs r WHERE r.ticket_id = t.ticket_id) AS run_count,
              (SELECT r.state_json FROM runs r
                 WHERE r.ticket_id = t.ticket_id
                 ORDER BY r.created_at DESC LIMIT 1) AS latest_state,
              (SELECT e.status FROM escalations e
                 WHERE e.ticket_id = t.ticket_id
                 ORDER BY e.created_at DESC LIMIT 1) AS escalation_status,
              COALESCE((SELECT MAX(m.created_at) FROM messages m
                 WHERE m.ticket_id = t.ticket_id), t.created_at) AS updated_at
         FROM tickets t
         WHERE t.customer_id IS ?
         ORDER BY updated_at DESC`;
  const rows = db.prepare(sql).all(customerId ?? null) as any[];
  return rows.map((r) => {
    let overall: string | undefined;
    if (r.latest_state) {
      try {
        overall = JSON.parse(r.latest_state)?.investigation?.overall_status;
      } catch {
        overall = undefined;
      }
    }
    return {
      ticket_id: r.ticket_id,
      display_id: friendlyId(r.seq, r.ticket_id),
      title: r.title || friendlyId(r.seq, r.ticket_id),
      message_count: Number(r.message_count ?? 0),
      updated_at: r.updated_at,
      status: lifecycleStatus(r.escalation_status, Number(r.run_count ?? 0), overall),
      parent_ticket_id: r.parent_ticket_id ?? null,
    };
  });
}

/** Delete a ticket and everything attached to it. */
export function deleteTicket(ticketId: string): void {
  db.prepare("DELETE FROM escalations WHERE ticket_id = ?").run(ticketId);
  db.prepare("DELETE FROM runs WHERE ticket_id = ?").run(ticketId);
  db.prepare("DELETE FROM messages WHERE ticket_id = ?").run(ticketId);
  db.prepare("DELETE FROM tickets WHERE ticket_id = ?").run(ticketId);
}

// ---- Durable-ish presence locks -------------------------------------------
// SQLite keeps "act as customer" locks out of process memory, so a restarted API
// or another API instance using the same DB sees the same ownership state.

export interface PresenceClaim {
  customer_id: string;
  session_id: string;
  expires_at: number;
}

export function prunePresenceLocks(now = Date.now()): void {
  db.prepare("DELETE FROM presence_locks WHERE expires_at <= ?").run(now);
}

export function listPresenceLocks(now = Date.now()): Map<string, PresenceClaim> {
  prunePresenceLocks(now);
  const rows = db.prepare("SELECT customer_id, session_id, expires_at FROM presence_locks").all() as any[];
  return new Map(
    rows.map((r) => [
      String(r.customer_id),
      {
        customer_id: String(r.customer_id),
        session_id: String(r.session_id),
        expires_at: Number(r.expires_at),
      },
    ])
  );
}

export function claimPresenceLock(customerId: string, sessionId: string, ttlMs: number): "ok" | "occupied" {
  const now = Date.now();
  prunePresenceLocks(now);
  const existing = db
    .prepare("SELECT session_id FROM presence_locks WHERE customer_id = ?")
    .get(customerId) as any;
  if (existing && existing.session_id !== sessionId) return "occupied";

  const expiresAt = now + ttlMs;
  db.prepare("DELETE FROM presence_locks WHERE session_id = ? AND customer_id <> ?").run(sessionId, customerId);
  db.prepare(
    "INSERT OR REPLACE INTO presence_locks (customer_id, session_id, expires_at) VALUES (?, ?, ?)"
  ).run(customerId, sessionId, expiresAt);
  return "ok";
}

export function releasePresenceLock(customerId: string, sessionId: string): void {
  db.prepare("DELETE FROM presence_locks WHERE customer_id = ? AND session_id = ?").run(customerId, sessionId);
}

export function releasePresenceSession(sessionId: string): void {
  db.prepare("DELETE FROM presence_locks WHERE session_id = ?").run(sessionId);
}

export function countCustomerMessages(ticketId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE ticket_id = ? AND role = 'customer'")
    .get(ticketId) as any;
  return Number(row?.n ?? 0);
}

export function addMessage(ticketId: string, role: MessageRole, text: string): void {
  db.prepare("INSERT INTO messages (ticket_id, role, text, created_at) VALUES (?, ?, ?, ?)").run(
    ticketId,
    role,
    text,
    new Date().toISOString()
  );
}

export function saveRun(runId: string, ticketId: string, state: unknown): void {
  db.prepare(
    "INSERT OR REPLACE INTO runs (run_id, ticket_id, created_at, state_json) VALUES (?, ?, ?, ?)"
  ).run(runId, ticketId, new Date().toISOString(), JSON.stringify(state));
}

export function getLatestRun(ticketId: string): any | null {
  const row = db
    .prepare("SELECT state_json FROM runs WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(ticketId) as any;
  return row ? JSON.parse(row.state_json) : null;
}

export interface LatestRunContext {
  run_id?: string;
  message?: string;
  resolution?: unknown;
  agent_reports?: unknown[];
  investigation?: unknown;
  severity?: unknown;
  escalation?: unknown;
}

/** Compact structured context from the latest previous run for follow-ups. */
export function getLatestRunContext(ticketId: string): LatestRunContext | null {
  const state = getLatestRun(ticketId);
  if (!state) return null;
  return {
    run_id: state.run_id,
    message: state.message,
    resolution: state.resolution,
    agent_reports: Array.isArray(state.agent_reports) ? state.agent_reports : [],
    investigation: state.investigation,
    severity: state.severity,
    escalation: state.escalation,
  };
}

// ---- Dashboard (all tickets / full traces) ---------------------------------

export type TicketLifecycleStatus = "active" | "escalated" | "resolved";

export interface TicketDashboardRow {
  ticket_id: string;
  display_id: string;
  title: string;
  customer_id: string | null;
  parent_ticket_id: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  run_count: number;
  status: TicketLifecycleStatus;
  primary_intent: string | null;
  severity: string | null;
  priority: string | null;
  sentiment: string | null;
  sentiment_score: number | null;
  frustration: boolean;
  summary: string | null;
  escalation_id: string | null;
  escalation_status: "open" | "resolved" | null;
}

export interface StoredRun {
  run_id: string;
  ticket_id: string;
  created_at: string;
  state: any;
}

function lifecycleStatus(
  escalationStatus: string | null | undefined,
  _runCount: number,
  overallStatus?: string | null
): TicketLifecycleStatus {
  if (escalationStatus === "open") return "escalated";
  if (escalationStatus === "resolved") return "resolved";
  if (overallStatus === "resolved") return "resolved";
  return "active";
}

function rowFromDb(r: any): TicketDashboardRow {
  let state: any = null;
  if (r.latest_state) {
    try {
      state = JSON.parse(r.latest_state);
    } catch {
      state = null;
    }
  }
  const escalation_status = r.escalation_status ?? null;
  return {
    ticket_id: r.ticket_id,
    display_id: friendlyId(r.seq, r.ticket_id),
    title: r.title || friendlyId(r.seq, r.ticket_id),
    customer_id: r.customer_id ?? null,
    parent_ticket_id: r.parent_ticket_id ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    message_count: Number(r.message_count ?? 0),
    run_count: Number(r.run_count ?? 0),
    status: lifecycleStatus(
      escalation_status,
      Number(r.run_count ?? 0),
      state?.investigation?.overall_status
    ),
    primary_intent: state?.classification?.primary_intent ?? null,
    severity: state?.severity?.level ?? null,
    priority: state?.severity?.priority ?? null,
    sentiment: state?.sentiment?.label ?? null,
    sentiment_score: typeof state?.sentiment?.score === "number" ? state.sentiment.score : null,
    frustration: !!state?.sentiment?.frustration,
    summary: state?.resolution?.summary ?? null,
    escalation_id: r.escalation_id ?? null,
    escalation_status,
  };
}

/** Every ticket in the system — for the ops dashboard (not scoped to a customer). */
export function listTicketsDashboard(): TicketDashboardRow[] {
  const rows = db
    .prepare(
      `SELECT t.ticket_id,
              t.seq,
              t.parent_ticket_id,
              t.customer_id,
              t.created_at,
              (SELECT m.text FROM messages m
                 WHERE m.ticket_id = t.ticket_id AND m.role = 'customer'
                 ORDER BY m.id ASC LIMIT 1) AS title,
              (SELECT COUNT(*) FROM messages m
                 WHERE m.ticket_id = t.ticket_id AND m.role = 'customer') AS message_count,
              (SELECT COUNT(*) FROM runs r WHERE r.ticket_id = t.ticket_id) AS run_count,
              COALESCE((SELECT MAX(m.created_at) FROM messages m
                 WHERE m.ticket_id = t.ticket_id), t.created_at) AS updated_at,
              (SELECT r.state_json FROM runs r
                 WHERE r.ticket_id = t.ticket_id
                 ORDER BY r.created_at DESC LIMIT 1) AS latest_state,
              (SELECT e.id FROM escalations e
                 WHERE e.ticket_id = t.ticket_id
                 ORDER BY e.created_at DESC LIMIT 1) AS escalation_id,
              (SELECT e.status FROM escalations e
                 WHERE e.ticket_id = t.ticket_id
                 ORDER BY e.created_at DESC LIMIT 1) AS escalation_status
         FROM tickets t
         ORDER BY updated_at DESC`
    )
    .all() as any[];
  return rows.map(rowFromDb);
}

export function getTicketDashboardRow(ticketId: string): TicketDashboardRow | null {
  const row = db
    .prepare(
      `SELECT t.ticket_id,
              t.seq,
              t.parent_ticket_id,
              t.customer_id,
              t.created_at,
              (SELECT m.text FROM messages m
                 WHERE m.ticket_id = t.ticket_id AND m.role = 'customer'
                 ORDER BY m.id ASC LIMIT 1) AS title,
              (SELECT COUNT(*) FROM messages m
                 WHERE m.ticket_id = t.ticket_id AND m.role = 'customer') AS message_count,
              (SELECT COUNT(*) FROM runs r WHERE r.ticket_id = t.ticket_id) AS run_count,
              COALESCE((SELECT MAX(m.created_at) FROM messages m
                 WHERE m.ticket_id = t.ticket_id), t.created_at) AS updated_at,
              (SELECT r.state_json FROM runs r
                 WHERE r.ticket_id = t.ticket_id
                 ORDER BY r.created_at DESC LIMIT 1) AS latest_state,
              (SELECT e.id FROM escalations e
                 WHERE e.ticket_id = t.ticket_id
                 ORDER BY e.created_at DESC LIMIT 1) AS escalation_id,
              (SELECT e.status FROM escalations e
                 WHERE e.ticket_id = t.ticket_id
                 ORDER BY e.created_at DESC LIMIT 1) AS escalation_status
         FROM tickets t
         WHERE t.ticket_id = ?`
    )
    .get(ticketId) as any;
  return row ? rowFromDb(row) : null;
}

/** One row in the observability "sessions" table — a single pipeline run. */
export interface RunSessionRow {
  run_id: string;
  ticket_id: string;
  display_id: string;
  created_at: string;
  message: string;
  category: string | null;
  primary_intent: string | null;
  is_multi_issue: boolean;
  sentiment: string | null;
  sentiment_score: number | null;
  frustration: boolean;
  sentiment_trend: string | null;
  severity: string | null;
  priority: string | null;
  escalated: boolean;
  guard_flagged: boolean;
  overall_status: string | null;
  agent_count: number;
  step_count: number;
  llm_steps: number;
}

function sessionRowFromRun(r: any): RunSessionRow {
  let s: any = {};
  try {
    s = JSON.parse(r.state_json) || {};
  } catch {
    s = {};
  }
  const audit = Array.isArray(s.audit_trail) ? s.audit_trail : [];
  return {
    run_id: r.run_id,
    ticket_id: r.ticket_id,
    display_id: friendlyId(r.seq, r.ticket_id),
    created_at: r.created_at,
    message: s.message ?? "",
    category: s.classification?.category ?? null,
    primary_intent: s.classification?.primary_intent ?? null,
    is_multi_issue: !!s.classification?.is_multi_issue,
    sentiment: s.sentiment?.label ?? null,
    sentiment_score: typeof s.sentiment?.score === "number" ? s.sentiment.score : null,
    frustration: !!s.sentiment?.frustration,
    sentiment_trend: s.sentiment?.trend ?? null,
    severity: s.severity?.level ?? null,
    priority: s.severity?.priority ?? null,
    escalated: !!s.escalation?.escalate,
    guard_flagged: !!s.guard?.force_escalation,
    overall_status: s.investigation?.overall_status ?? (s.resolution ? "resolved" : null),
    agent_count: Array.isArray(s.agent_reports) ? s.agent_reports.length : 0,
    step_count: audit.length,
    llm_steps: audit.filter((e: any) => e?.kind === "llm").length,
  };
}

/** Every pipeline run across all tickets, newest first — observability table. */
export function listAllRuns(): RunSessionRow[] {
  const rows = db
    .prepare(
      `SELECT r.run_id, r.ticket_id, r.created_at, r.state_json, t.seq
         FROM runs r
         LEFT JOIN tickets t ON t.ticket_id = r.ticket_id
         ORDER BY r.created_at DESC`
    )
    .all() as any[];
  return rows.map(sessionRowFromRun);
}

/** A single run with its full pipeline state — powers the run detail + trace. */
export function getRunById(
  runId: string
): { run_id: string; ticket_id: string; display_id: string; created_at: string; state: any } | null {
  const row = db
    .prepare(
      `SELECT r.run_id, r.ticket_id, r.created_at, r.state_json, t.seq
         FROM runs r
         LEFT JOIN tickets t ON t.ticket_id = r.ticket_id
         WHERE r.run_id = ?`
    )
    .get(runId) as any;
  if (!row) return null;
  return {
    run_id: row.run_id,
    ticket_id: row.ticket_id,
    display_id: friendlyId(row.seq, row.ticket_id),
    created_at: row.created_at,
    state: JSON.parse(row.state_json),
  };
}

/** Every pipeline run for a ticket, oldest first — powers the trace viewer. */
export function listRunsForTicket(ticketId: string): StoredRun[] {
  const rows = db
    .prepare(
      "SELECT run_id, ticket_id, created_at, state_json FROM runs WHERE ticket_id = ? ORDER BY created_at ASC"
    )
    .all(ticketId) as any[];
  return rows.map((r) => ({
    run_id: r.run_id,
    ticket_id: r.ticket_id,
    created_at: r.created_at,
    state: JSON.parse(r.state_json),
  }));
}

// ---- Escalations -----------------------------------------------------------

export interface EscalationRecord {
  id: string;
  ticket_id: string;
  customer_id: string | null;
  customer_name: string;
  subject: string;
  department: string;
  team: string | null;
  urgency: string | null;
  reason: string | null;
  assignee_id: string;
  assignee_name: string;
  assignee_title: string;
  // "agent" (front-line) or "manager" (handed up). Older rows may be null → treat as agent.
  assignee_level?: string | null;
  // Short note the agent wrote when passing the case up to a manager.
  handoff_note?: string | null;
  status: "open" | "resolved";
  created_at: string;
}

export function createEscalation(
  rec: Omit<EscalationRecord, "id" | "created_at" | "status" | "assignee_level" | "handoff_note">
): EscalationRecord {
  const id = `ESC-${randomUUID().slice(0, 8)}`;
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO escalations
       (id, ticket_id, customer_id, customer_name, subject, department, team,
        urgency, reason, assignee_id, assignee_name, assignee_title, assignee_level, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'agent', 'open', ?)`
  ).run(
    id,
    rec.ticket_id,
    rec.customer_id ?? null,
    rec.customer_name,
    rec.subject,
    rec.department,
    rec.team ?? null,
    rec.urgency ?? null,
    rec.reason ?? null,
    rec.assignee_id,
    rec.assignee_name,
    rec.assignee_title,
    created_at
  );
  return { id, status: "open", created_at, assignee_level: "agent", handoff_note: null, ...rec };
}

/** Reassign an escalation to another handler (e.g. hand it up to a manager). */
export function reassignEscalation(
  id: string,
  assignee: { id: string; name: string; title: string },
  level: string,
  note: string | null
): void {
  db.prepare(
    `UPDATE escalations
        SET assignee_id = ?, assignee_name = ?, assignee_title = ?, assignee_level = ?, handoff_note = ?
      WHERE id = ?`
  ).run(assignee.id, assignee.name, assignee.title, level, note ?? null, id);
}

/** The open escalation for a ticket, if one already exists (avoid duplicates). */
export function getOpenEscalationForTicket(ticketId: string): EscalationRecord | null {
  const row = db
    .prepare("SELECT * FROM escalations WHERE ticket_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1")
    .get(ticketId) as any;
  return row ?? null;
}

/** The most recent escalation for a ticket regardless of status (for follow-up status). */
export function getLatestEscalationForTicket(ticketId: string): EscalationRecord | null {
  const row = db
    .prepare("SELECT * FROM escalations WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(ticketId) as any;
  return row ?? null;
}

export function listEscalations(): EscalationRecord[] {
  return db.prepare("SELECT * FROM escalations ORDER BY created_at DESC").all() as any[];
}

export function getEscalationById(id: string): EscalationRecord | null {
  const row = db.prepare("SELECT * FROM escalations WHERE id = ?").get(id) as any;
  return row ?? null;
}

/** Open-case counts per assignee — used to balance new assignments. */
export function countOpenByAssignee(): Record<string, number> {
  const rows = db
    .prepare("SELECT assignee_id, COUNT(*) AS n FROM escalations WHERE status = 'open' GROUP BY assignee_id")
    .all() as any[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.assignee_id] = Number(r.n);
  return out;
}

export function resolveEscalation(id: string): void {
  db.prepare("UPDATE escalations SET status = 'resolved' WHERE id = ?").run(id);
}

// ---- Notifications ---------------------------------------------------------
// In-app notifications addressed to an account (currently: a customer is told
// when their escalated case is resolved).

db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id          TEXT PRIMARY KEY,
    account_id  TEXT NOT NULL,
    kind        TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT,
    ticket_id   TEXT,
    read        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );
`);

export interface NotificationRecord {
  id: string;
  account_id: string;
  kind: string;
  title: string;
  body: string | null;
  ticket_id: string | null;
  read: number;
  created_at: string;
}

export function createNotification(rec: {
  account_id: string;
  kind: string;
  title: string;
  body?: string | null;
  ticket_id?: string | null;
}): NotificationRecord {
  const id = `NTF-${randomUUID().slice(0, 8)}`;
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO notifications (id, account_id, kind, title, body, ticket_id, read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(id, rec.account_id, rec.kind, rec.title, rec.body ?? null, rec.ticket_id ?? null, created_at);
  return {
    id,
    account_id: rec.account_id,
    kind: rec.kind,
    title: rec.title,
    body: rec.body ?? null,
    ticket_id: rec.ticket_id ?? null,
    read: 0,
    created_at,
  };
}

export function listNotifications(accountId: string): NotificationRecord[] {
  return db
    .prepare("SELECT * FROM notifications WHERE account_id = ? ORDER BY created_at DESC LIMIT 50")
    .all(accountId) as any[];
}

export function countUnread(accountId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM notifications WHERE account_id = ? AND read = 0")
    .get(accountId) as any;
  return Number(row?.n ?? 0);
}

export function markNotificationRead(id: string, accountId: string): void {
  db.prepare("UPDATE notifications SET read = 1 WHERE id = ? AND account_id = ?").run(id, accountId);
}

export function markAllNotificationsRead(accountId: string): void {
  db.prepare("UPDATE notifications SET read = 1 WHERE account_id = ?").run(accountId);
}

// ---- Config-change audit log -----------------------------------------------
// Who changed what in the live config store (KB / use cases / tools). Tied to
// the authenticated admin account so the "platform" story is accountable.

db.exec(`
  CREATE TABLE IF NOT EXISTS config_audit (
    id          TEXT PRIMARY KEY,
    actor_id    TEXT NOT NULL,
    actor_name  TEXT NOT NULL,
    action      TEXT NOT NULL,
    target      TEXT NOT NULL,
    detail      TEXT,
    created_at  TEXT NOT NULL
  );
`);

export interface ConfigAuditRecord {
  id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  target: string;
  detail: string | null;
  created_at: string;
}

export function recordConfigAudit(rec: {
  actor_id: string;
  actor_name: string;
  action: string;
  target: string;
  detail?: string | null;
}): void {
  db.prepare(
    `INSERT INTO config_audit (id, actor_id, actor_name, action, target, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `CFG-${randomUUID().slice(0, 8)}`,
    rec.actor_id,
    rec.actor_name,
    rec.action,
    rec.target,
    rec.detail ?? null,
    new Date().toISOString()
  );
}

export function listConfigAudit(limit = 100): ConfigAuditRecord[] {
  return db
    .prepare("SELECT * FROM config_audit ORDER BY created_at DESC LIMIT ?")
    .all(limit) as any[];
}

// ---- Feedback (thumbs up/down on AI replies) -------------------------------
// One row per (message). Re-rating a message replaces the previous row, so a
// customer's latest sentiment on a reply is what's stored and shown.

db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id          TEXT PRIMARY KEY,
    ticket_id   TEXT NOT NULL,
    message_id  INTEGER NOT NULL,
    customer_id TEXT,
    rating      TEXT NOT NULL,
    comment     TEXT,
    question    TEXT,
    answer      TEXT,
    created_at  TEXT NOT NULL,
    UNIQUE(message_id)
  );
`);

export interface FeedbackRecord {
  id: string;
  ticket_id: string;
  message_id: number;
  customer_id: string | null;
  rating: "up" | "down";
  comment: string | null;
  question: string | null;
  answer: string | null;
  created_at: string;
}

/** Insert or replace one message's rating (idempotent per message_id). */
export function upsertFeedback(rec: {
  ticket_id: string;
  message_id: number;
  customer_id?: string | null;
  rating: "up" | "down";
  comment?: string | null;
  question?: string | null;
  answer?: string | null;
}): void {
  db.prepare(
    `INSERT INTO feedback (id, ticket_id, message_id, customer_id, rating, comment, question, answer, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(message_id) DO UPDATE SET
       rating = excluded.rating,
       comment = excluded.comment,
       created_at = excluded.created_at`
  ).run(
    `FB-${randomUUID().slice(0, 8)}`,
    rec.ticket_id,
    rec.message_id,
    rec.customer_id ?? null,
    rec.rating,
    rec.comment ?? null,
    rec.question ?? null,
    rec.answer ?? null,
    new Date().toISOString()
  );
}

/** Current ratings for one ticket's messages (for the chat to render state). */
export function getFeedbackForTicket(ticketId: string): { message_id: number; rating: "up" | "down" }[] {
  return db
    .prepare("SELECT message_id, rating FROM feedback WHERE ticket_id = ?")
    .all(ticketId) as any[];
}

export interface FeedbackRow extends FeedbackRecord {
  display_id: string;
}

/**
 * Admin feed: every rating, newest first, with ticket display id. The customer
 * NAME is resolved by the server layer (it owns account lookups), mirroring how
 * the observability feed enriches rows.
 */
export function listAllFeedback(limit = 500): FeedbackRow[] {
  const rows = db
    .prepare(
      `SELECT f.*, t.seq AS seq
         FROM feedback f
         LEFT JOIN tickets t ON t.ticket_id = f.ticket_id
        ORDER BY f.created_at DESC
        LIMIT ?`
    )
    .all(limit) as any[];
  return rows.map((r) => ({
    id: r.id,
    ticket_id: r.ticket_id,
    display_id: friendlyId(r.seq, r.ticket_id),
    message_id: r.message_id,
    customer_id: r.customer_id,
    rating: r.rating,
    comment: r.comment,
    question: r.question,
    answer: r.answer,
    created_at: r.created_at,
  }));
}

/** The text of a specific message (used to snapshot the answer on feedback). */
export function getMessageById(messageId: number): { ticket_id: string; role: string; text: string } | null {
  const row = db
    .prepare("SELECT ticket_id, role, text FROM messages WHERE id = ?")
    .get(messageId) as any;
  return row ? { ticket_id: row.ticket_id, role: row.role, text: row.text } : null;
}

/** The customer message immediately preceding a system reply (the question). */
export function getQuestionForMessage(ticketId: string, messageId: number): string | null {
  const row = db
    .prepare(
      `SELECT text FROM messages
        WHERE ticket_id = ? AND id < ? AND role = 'customer'
        ORDER BY id DESC LIMIT 1`
    )
    .get(ticketId, messageId) as any;
  return row?.text ?? null;
}

// ---- Real-time agent collaboration -----------------------------------------
// Three small tables that power the live "Team" dashboard:
//   • agent_presence — last-seen heartbeat per human agent (online/offline)
//   • team_activity  — append-only feed of escalation lifecycle events
//   • case_notes     — internal agent-to-agent notes on a case (not customer-visible)

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_presence (
    agent_id   TEXT PRIMARY KEY,
    account_id TEXT,
    name       TEXT,
    last_seen  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS team_activity (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,
    actor_id      TEXT,
    actor_name    TEXT,
    ticket_id     TEXT,
    escalation_id TEXT,
    summary       TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS case_notes (
    id            TEXT PRIMARY KEY,
    escalation_id TEXT NOT NULL,
    ticket_id     TEXT,
    author_id     TEXT,
    author_name   TEXT NOT NULL,
    body          TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );
`);

export interface PresenceRow {
  agent_id: string;
  account_id: string | null;
  name: string | null;
  last_seen: number;
}

/** Record/refresh an agent's heartbeat. */
export function recordAgentPresence(agentId: string, accountId: string | null, name: string | null): void {
  db.prepare(
    `INSERT INTO agent_presence (agent_id, account_id, name, last_seen)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(agent_id) DO UPDATE SET
       account_id = excluded.account_id,
       name = excluded.name,
       last_seen = excluded.last_seen`
  ).run(agentId, accountId, name, Date.now());
}

export function listAgentPresence(): PresenceRow[] {
  return db.prepare("SELECT agent_id, account_id, name, last_seen FROM agent_presence").all() as any[];
}

export interface TeamActivityRow {
  id: string;
  kind: string;
  actor_id: string | null;
  actor_name: string | null;
  ticket_id: string | null;
  escalation_id: string | null;
  summary: string;
  created_at: string;
}

export function recordTeamActivity(rec: {
  kind: string;
  actor_id?: string | null;
  actor_name?: string | null;
  ticket_id?: string | null;
  escalation_id?: string | null;
  summary: string;
}): TeamActivityRow {
  const row: TeamActivityRow = {
    id: `TA-${randomUUID().slice(0, 8)}`,
    kind: rec.kind,
    actor_id: rec.actor_id ?? null,
    actor_name: rec.actor_name ?? null,
    ticket_id: rec.ticket_id ?? null,
    escalation_id: rec.escalation_id ?? null,
    summary: rec.summary,
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO team_activity (id, kind, actor_id, actor_name, ticket_id, escalation_id, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id, row.kind, row.actor_id, row.actor_name, row.ticket_id, row.escalation_id, row.summary, row.created_at
  );
  return row;
}

export function listTeamActivity(limit = 50): TeamActivityRow[] {
  return db
    .prepare("SELECT * FROM team_activity ORDER BY created_at DESC LIMIT ?")
    .all(limit) as any[];
}

export interface CaseNoteRow {
  id: string;
  escalation_id: string;
  ticket_id: string | null;
  author_id: string | null;
  author_name: string;
  body: string;
  created_at: string;
}

export function addCaseNote(rec: {
  escalation_id: string;
  ticket_id?: string | null;
  author_id?: string | null;
  author_name: string;
  body: string;
}): CaseNoteRow {
  const row: CaseNoteRow = {
    id: `CN-${randomUUID().slice(0, 8)}`,
    escalation_id: rec.escalation_id,
    ticket_id: rec.ticket_id ?? null,
    author_id: rec.author_id ?? null,
    author_name: rec.author_name,
    body: rec.body,
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO case_notes (id, escalation_id, ticket_id, author_id, author_name, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.escalation_id, row.ticket_id, row.author_id, row.author_name, row.body, row.created_at);
  return row;
}

export function listCaseNotes(escalationId: string): CaseNoteRow[] {
  return db
    .prepare("SELECT * FROM case_notes WHERE escalation_id = ? ORDER BY created_at ASC")
    .all(escalationId) as any[];
}

export function listRecentCaseNotes(limit = 20): CaseNoteRow[] {
  return db
    .prepare("SELECT * FROM case_notes ORDER BY created_at DESC LIMIT ?")
    .all(limit) as any[];
}

// ---- Human agents (escalation handlers) ------------------------------------
// Roster lives in the DB so admins can add agents at runtime and have them be
// assignable. Seeded once from the static roster in humans.ts.

db.exec(`
  CREATE TABLE IF NOT EXISTS human_agents (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    title       TEXT NOT NULL,
    department  TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );
`);

// Two-tier org: add the agent/manager level column if missing.
{
  const cols = db.prepare("PRAGMA table_info(human_agents)").all() as any[];
  if (!cols.some((c) => c.name === "level")) {
    db.exec("ALTER TABLE human_agents ADD COLUMN level TEXT");
  }
}

export interface HumanAgentRow {
  id: string;
  name: string;
  title: string;
  department: string;
  level: string;
}

export function seedHumanAgentsIfEmpty(roster: HumanAgentRow[]): void {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM human_agents").get() as any)?.n ?? 0;
  if (count > 0) return;
  const insert = db.prepare(
    "INSERT INTO human_agents (id, name, title, department, level, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const now = new Date().toISOString();
  for (const a of roster) insert.run(a.id, a.name, a.title, a.department, a.level ?? "agent", now);
}

export function listHumanAgentRows(): HumanAgentRow[] {
  return db
    .prepare("SELECT id, name, title, department, COALESCE(level, 'agent') AS level FROM human_agents ORDER BY department, level DESC, name")
    .all() as any[];
}

export function getHumanAgentRow(id: string): HumanAgentRow | null {
  const row = db
    .prepare("SELECT id, name, title, department, COALESCE(level, 'agent') AS level FROM human_agents WHERE id = ?")
    .get(id) as any;
  return row ?? null;
}

export function insertHumanAgentRow(row: HumanAgentRow): void {
  db.prepare(
    "INSERT INTO human_agents (id, name, title, department, level, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(row.id, row.name, row.title, row.department, row.level ?? "agent", new Date().toISOString());
}

/**
 * Backfill the agent/manager level on rows seeded before the column existed.
 * Applies the seed level/title by id, then defaults any remaining null to "agent".
 */
export function backfillHumanAgentLevels(
  roster: { id: string; title: string; level: string }[]
): void {
  const upd = db.prepare(
    "UPDATE human_agents SET level = ?, title = ? WHERE id = ? AND (level IS NULL OR level = '')"
  );
  for (const a of roster) upd.run(a.level, a.title, a.id);
  db.prepare("UPDATE human_agents SET level = 'agent' WHERE level IS NULL OR level = ''").run();
}
