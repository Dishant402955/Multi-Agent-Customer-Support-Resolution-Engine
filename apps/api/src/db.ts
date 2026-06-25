// SQLite store for tickets, messages, and pipeline runs.
// Uses Node's built-in node:sqlite (Node 22.5+/24) — no native build step.
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { ENV } from "./env";

const db = new DatabaseSync(resolve(process.cwd(), ENV.DB_PATH));
db.exec("PRAGMA journal_mode = WAL;");

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
`);

// Migration: associate tickets with the customer they were opened as, so each
// customer sees only their own history. Added after the initial schema, so we
// guard with a column check before ALTER.
{
  const cols = db.prepare("PRAGMA table_info(tickets)").all() as any[];
  if (!cols.some((c) => c.name === "customer_id")) {
    db.exec("ALTER TABLE tickets ADD COLUMN customer_id TEXT");
  }
}

export interface StoredMessage {
  role: "customer" | "system";
  text: string;
  timestamp: string;
}

export function ensureTicket(ticketId: string, customerId?: string | null): void {
  const exists = db.prepare("SELECT 1 FROM tickets WHERE ticket_id = ?").get(ticketId);
  if (!exists) {
    db.prepare("INSERT INTO tickets (ticket_id, created_at, customer_id) VALUES (?, ?, ?)").run(
      ticketId,
      new Date().toISOString(),
      customerId ?? null
    );
  }
}

/** The customer a ticket was opened as (null for anonymous/guest tickets). */
export function getTicketCustomer(ticketId: string): string | null {
  const row = db
    .prepare("SELECT customer_id FROM tickets WHERE ticket_id = ?")
    .get(ticketId) as any;
  return row?.customer_id ?? null;
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
    .prepare("SELECT role, text, created_at FROM messages WHERE ticket_id = ? ORDER BY id ASC")
    .all(ticketId) as any[];
  return rows.map((r) => ({ role: r.role, text: r.text, timestamp: r.created_at }));
}

export interface TicketSummary {
  ticket_id: string;
  title: string;
  message_count: number;
  updated_at: string;
}

/**
 * Tickets scoped to a customer: pass a customerId to get that customer's
 * history, or omit/null to get anonymous (guest) tickets. Each row has a title
 * (first customer message), counts, and last activity.
 */
export function listTickets(customerId?: string | null): TicketSummary[] {
  const where = customerId ? "WHERE t.customer_id = ?" : "WHERE t.customer_id IS NULL";
  const sql = `SELECT t.ticket_id AS ticket_id,
              (SELECT m.text FROM messages m
                 WHERE m.ticket_id = t.ticket_id AND m.role = 'customer'
                 ORDER BY m.id ASC LIMIT 1) AS title,
              (SELECT COUNT(*) FROM messages m
                 WHERE m.ticket_id = t.ticket_id AND m.role = 'customer') AS message_count,
              COALESCE((SELECT MAX(m.created_at) FROM messages m
                 WHERE m.ticket_id = t.ticket_id), t.created_at) AS updated_at
         FROM tickets t
         ${where}
         ORDER BY updated_at DESC`;
  const stmt = db.prepare(sql);
  const rows = (customerId ? stmt.all(customerId) : stmt.all()) as any[];
  return rows.map((r) => ({
    ticket_id: r.ticket_id,
    title: r.title || r.ticket_id,
    message_count: Number(r.message_count ?? 0),
    updated_at: r.updated_at,
  }));
}

/** Delete a ticket and everything attached to it. */
export function deleteTicket(ticketId: string): void {
  db.prepare("DELETE FROM escalations WHERE ticket_id = ?").run(ticketId);
  db.prepare("DELETE FROM runs WHERE ticket_id = ?").run(ticketId);
  db.prepare("DELETE FROM messages WHERE ticket_id = ?").run(ticketId);
  db.prepare("DELETE FROM tickets WHERE ticket_id = ?").run(ticketId);
}

export function countCustomerMessages(ticketId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE ticket_id = ? AND role = 'customer'")
    .get(ticketId) as any;
  return Number(row?.n ?? 0);
}

export function addMessage(ticketId: string, role: "customer" | "system", text: string): void {
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

// ---- Dashboard (all tickets / full traces) ---------------------------------

export type TicketLifecycleStatus = "active" | "escalated" | "resolved";

export interface TicketDashboardRow {
  ticket_id: string;
  title: string;
  customer_id: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  run_count: number;
  status: TicketLifecycleStatus;
  primary_intent: string | null;
  severity: string | null;
  priority: string | null;
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
  runCount: number
): TicketLifecycleStatus {
  if (escalationStatus === "open") return "escalated";
  if (escalationStatus === "resolved") return "resolved";
  return runCount > 0 ? "active" : "active";
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
    title: r.title || r.ticket_id,
    customer_id: r.customer_id ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    message_count: Number(r.message_count ?? 0),
    run_count: Number(r.run_count ?? 0),
    status: lifecycleStatus(escalation_status, Number(r.run_count ?? 0)),
    primary_intent: state?.classification?.primary_intent ?? null,
    severity: state?.severity?.level ?? null,
    priority: state?.severity?.priority ?? null,
    escalation_id: r.escalation_id ?? null,
    escalation_status,
  };
}

/** Every ticket in the system — for the ops dashboard (not scoped to a customer). */
export function listTicketsDashboard(): TicketDashboardRow[] {
  const rows = db
    .prepare(
      `SELECT t.ticket_id,
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
  status: "open" | "resolved";
  created_at: string;
}

export function createEscalation(rec: Omit<EscalationRecord, "id" | "created_at" | "status">): EscalationRecord {
  const id = `ESC-${randomUUID().slice(0, 8)}`;
  const created_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO escalations
       (id, ticket_id, customer_id, customer_name, subject, department, team,
        urgency, reason, assignee_id, assignee_name, assignee_title, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`
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
  return { id, status: "open", created_at, ...rec };
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
