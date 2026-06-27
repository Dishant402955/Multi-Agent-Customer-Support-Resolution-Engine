import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { ENV } from "../env";

export const db = new DatabaseSync(resolve(process.cwd(), ENV.DB_PATH));
db.exec("PRAGMA journal_mode = WAL;");
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

// Migrations — each guarded by a column check so boot is idempotent.
{
  const cols = db.prepare("PRAGMA table_info(tickets)").all() as any[];
  const has = (name: string) => cols.some((c) => c.name === name);
  if (!has("customer_id")) db.exec("ALTER TABLE tickets ADD COLUMN customer_id TEXT");
  if (!has("seq")) {
    db.exec("ALTER TABLE tickets ADD COLUMN seq INTEGER");
    const owners = db.prepare("SELECT DISTINCT customer_id FROM tickets").all() as any[];
    for (const o of owners) {
      const rows = db.prepare("SELECT ticket_id FROM tickets WHERE customer_id IS ? ORDER BY created_at ASC, ticket_id ASC").all(o.customer_id) as any[];
      rows.forEach((r, i) => db.prepare("UPDATE tickets SET seq = ? WHERE ticket_id = ?").run(i + 1, r.ticket_id));
    }
  }
  if (!has("parent_ticket_id")) db.exec("ALTER TABLE tickets ADD COLUMN parent_ticket_id TEXT");
}
{
  const cols = db.prepare("PRAGMA table_info(escalations)").all() as any[];
  const has = (name: string) => cols.some((c) => c.name === name);
  if (!has("assignee_level")) db.exec("ALTER TABLE escalations ADD COLUMN assignee_level TEXT");
  if (!has("handoff_note")) db.exec("ALTER TABLE escalations ADD COLUMN handoff_note TEXT");
}

export function friendlyId(seq: number | null | undefined, ticketId: string): string {
  return seq ? `T-${String(seq).padStart(3, "0")}` : ticketId;
}

export type MessageRole = "customer" | "system" | "agent";

export interface StoredMessage {
  id?: number;
  role: MessageRole;
  text: string;
  timestamp: string;
}
