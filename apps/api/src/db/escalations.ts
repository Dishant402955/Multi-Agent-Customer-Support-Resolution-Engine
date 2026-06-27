import { randomUUID } from "node:crypto";
import { db } from "./schema";

export interface EscalationRecord {
  id: string; ticket_id: string; customer_id: string | null; customer_name: string;
  subject: string; department: string; team: string | null; urgency: string | null;
  reason: string | null; assignee_id: string; assignee_name: string; assignee_title: string;
  assignee_level?: string | null; handoff_note?: string | null;
  status: "open" | "resolved"; created_at: string;
}

export function createEscalation(rec: Omit<EscalationRecord, "id" | "created_at" | "status" | "assignee_level" | "handoff_note">): EscalationRecord {
  const id = `ESC-${randomUUID().slice(0, 8)}`;
  const created_at = new Date().toISOString();
  db.prepare(`INSERT INTO escalations (id, ticket_id, customer_id, customer_name, subject, department, team, urgency, reason, assignee_id, assignee_name, assignee_title, assignee_level, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'agent', 'open', ?)`).run(id, rec.ticket_id, rec.customer_id ?? null, rec.customer_name, rec.subject, rec.department, rec.team ?? null, rec.urgency ?? null, rec.reason ?? null, rec.assignee_id, rec.assignee_name, rec.assignee_title, created_at);
  return { id, status: "open", created_at, assignee_level: "agent", handoff_note: null, ...rec };
}

export function reassignEscalation(id: string, assignee: { id: string; name: string; title: string }, level: string, note: string | null): void {
  db.prepare("UPDATE escalations SET assignee_id = ?, assignee_name = ?, assignee_title = ?, assignee_level = ?, handoff_note = ? WHERE id = ?").run(assignee.id, assignee.name, assignee.title, level, note ?? null, id);
}

export function getOpenEscalationForTicket(ticketId: string): EscalationRecord | null {
  return (db.prepare("SELECT * FROM escalations WHERE ticket_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1").get(ticketId) as any) ?? null;
}
export function getLatestEscalationForTicket(ticketId: string): EscalationRecord | null {
  return (db.prepare("SELECT * FROM escalations WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1").get(ticketId) as any) ?? null;
}
export function listEscalations(): EscalationRecord[] {
  return db.prepare("SELECT * FROM escalations ORDER BY created_at DESC").all() as any[];
}
export function getEscalationById(id: string): EscalationRecord | null {
  return (db.prepare("SELECT * FROM escalations WHERE id = ?").get(id) as any) ?? null;
}
export function countOpenByAssignee(): Record<string, number> {
  const rows = db.prepare("SELECT assignee_id, COUNT(*) AS n FROM escalations WHERE status = 'open' GROUP BY assignee_id").all() as any[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.assignee_id] = Number(r.n);
  return out;
}
export function resolveEscalation(id: string): void { db.prepare("UPDATE escalations SET status = 'resolved' WHERE id = ?").run(id); }
