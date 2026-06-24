// SQLite store for tickets, messages, and pipeline runs.
// Uses Node's built-in node:sqlite (Node 22.5+/24) — no native build step.
import { DatabaseSync } from "node:sqlite";
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
`);

export interface StoredMessage {
  role: "customer" | "system";
  text: string;
  timestamp: string;
}

export function ensureTicket(ticketId: string): void {
  const exists = db.prepare("SELECT 1 FROM tickets WHERE ticket_id = ?").get(ticketId);
  if (!exists) {
    db.prepare("INSERT INTO tickets (ticket_id, created_at) VALUES (?, ?)").run(
      ticketId,
      new Date().toISOString()
    );
  }
}

export function getCustomerHistory(ticketId: string): StoredMessage[] {
  const rows = db
    .prepare("SELECT role, text, created_at FROM messages WHERE ticket_id = ? AND role = 'customer' ORDER BY id ASC")
    .all(ticketId) as any[];
  return rows.map((r) => ({ role: r.role, text: r.text, timestamp: r.created_at }));
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
