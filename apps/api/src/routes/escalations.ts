import express from "express";
import {
  getEscalationById, resolveEscalation, reassignEscalation, getMessages, addMessage,
  addCaseNote, listCaseNotes, recordTeamActivity,
  createNotification, listEscalations,
} from "../db";
import { getAccountByAgentId } from "../auth";
import { pickManager, listHumanAgents, type Department } from "../humans";
import { notifyTicketResolved, notifyAgentReply } from "../notify";
import { emitCollab } from "../collab";
import { requireRole, type AuthedRequest } from "./middleware";

const router = express.Router();

router.get("/", requireRole("admin", "agent"), (req: AuthedRequest, res) => {
  const account = req.account!;
  const all = listEscalations();
  const escalations = account.role === "agent" ? all.filter((e) => e.assignee_id === account.agent_id) : all;
  res.json({ escalations, agents: listHumanAgents(), me: account });
});

router.post("/:id/resolve", requireRole("admin", "agent"), (req: AuthedRequest, res) => {
  const account = req.account!;
  const esc = getEscalationById(req.params.id);
  if (!esc) return res.status(404).json({ error: "Escalation not found" });
  if (account.role === "agent" && esc.assignee_id !== account.agent_id) return res.status(403).json({ error: "Not your case" });
  resolveEscalation(req.params.id);
  if (esc.customer_id) void notifyTicketResolved(esc.customer_id, esc.ticket_id, esc.subject);
  const act = recordTeamActivity({ kind: "escalation_resolved", actor_id: account.agent_id, actor_name: account.name, ticket_id: esc.ticket_id, escalation_id: esc.id, summary: `${account.name} resolved ${esc.subject || esc.ticket_id}` });
  emitCollab({ type: "escalation_resolved", activity: act });
  res.json({ ok: true });
});

router.post("/:id/handoff", requireRole("admin", "agent"), (req: AuthedRequest, res) => {
  const account = req.account!;
  const esc = getEscalationById(req.params.id);
  if (!esc) return res.status(404).json({ error: "Escalation not found" });
  if (esc.status !== "open") return res.status(400).json({ error: "Case is already closed" });
  if (account.role === "agent" && esc.assignee_id !== account.agent_id) return res.status(403).json({ error: "Not your case" });
  if ((esc.assignee_level ?? "agent") === "manager") return res.status(400).json({ error: "Case is already with a manager" });
  const manager = pickManager(esc.department as Department);
  if (!manager) return res.status(409).json({ error: `No manager configured for ${esc.department}` });
  const note = String(req.body?.note || "").trim() || null;
  reassignEscalation(req.params.id, manager, "manager", note);
  const managerAccount = getAccountByAgentId(manager.id);
  if (managerAccount) {
    createNotification({ account_id: managerAccount.id, kind: "escalation_handoff", title: `Case handed up: ${esc.subject || esc.ticket_id}`, body: note ? `From ${account.name}: ${note}` : `Handed up by ${account.name}.`, ticket_id: esc.ticket_id });
  }
  const act = recordTeamActivity({ kind: "escalation_handoff", actor_id: account.agent_id, actor_name: account.name, ticket_id: esc.ticket_id, escalation_id: esc.id, summary: `${account.name} handed ${esc.subject || esc.ticket_id} up to ${manager.name}` });
  emitCollab({ type: "escalation_handoff", activity: act });
  res.json({ ok: true, assignee: manager });
});

router.post("/:id/reply", requireRole("admin", "agent"), (req: AuthedRequest, res) => {
  const account = req.account!;
  const esc = getEscalationById(req.params.id);
  if (!esc) return res.status(404).json({ error: "Escalation not found" });
  if (esc.status !== "open") return res.status(400).json({ error: "Case is already closed" });
  if (account.role === "agent" && esc.assignee_id !== account.agent_id) return res.status(403).json({ error: "Not your case" });
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Message is empty" });
  addMessage(esc.ticket_id, "agent", text);
  void notifyAgentReply(esc.customer_id, esc.ticket_id, account.name, text);
  const act = recordTeamActivity({ kind: "agent_reply", actor_id: account.agent_id, actor_name: account.name, ticket_id: esc.ticket_id, escalation_id: esc.id, summary: `${account.name} replied to ${esc.customer_name} on ${esc.subject || esc.ticket_id}` });
  emitCollab({ type: "agent_reply", activity: act });
  res.json({ ok: true, messages: getMessages(esc.ticket_id) });
});

router.post("/:id/note", requireRole("admin", "agent"), (req: AuthedRequest, res) => {
  const account = req.account!;
  const esc = getEscalationById(req.params.id);
  if (!esc) return res.status(404).json({ error: "Escalation not found" });
  const body = String(req.body?.body || "").trim();
  if (!body) return res.status(400).json({ error: "Note is empty" });
  const note = addCaseNote({ escalation_id: esc.id, ticket_id: esc.ticket_id, author_id: account.agent_id ?? account.id, author_name: account.name, body: body.slice(0, 2000) });
  const act = recordTeamActivity({ kind: "case_note", actor_id: account.agent_id, actor_name: account.name, ticket_id: esc.ticket_id, escalation_id: esc.id, summary: `${account.name} noted on ${esc.subject || esc.ticket_id}: ${body.slice(0, 80)}` });
  emitCollab({ type: "case_note", note, activity: act });
  res.json({ ok: true, note });
});

router.get("/:id/notes", requireRole("admin", "agent"), (req, res) => {
  res.json({ notes: listCaseNotes(req.params.id) });
});

export default router;
