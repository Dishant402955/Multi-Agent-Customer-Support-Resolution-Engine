// Application API. Owns tickets, history, persistence, and triggers the agent.
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { ENV } from "./env";
import {
  addMessage,
  countCustomerMessages,
  countOpenByAssignee,
  countUnread,
  createEscalation,
  createNotification,
  deleteTicket,
  ensureTicket,
  getCustomerHistory,
  getEscalationById,
  getLatestEscalationForTicket,
  listConfigAudit,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  recordConfigAudit,
  getLatestRun,
  getLatestRunContext,
  addCaseNote,
  getFeedbackForTicket,
  getMessageById,
  getMessages,
  getOpenEscalationForTicket,
  getQuestionForMessage,
  getRunById,
  getTicketCustomer,
  getTicketDashboardRow,
  getTicketDisplayId,
  listAgentPresence,
  listAllFeedback,
  listAllRuns,
  listCaseNotes,
  listRecentCaseNotes,
  listTeamActivity,
  recordAgentPresence,
  recordTeamActivity,
  upsertFeedback,
  listEscalations,
  listRunsForTicket,
  listTickets,
  listTicketsDashboard,
  reassignEscalation,
  resolveEscalation,
  saveRun,
  ticketExists,
  type EscalationRecord,
} from "./db";
import { runAgentPipeline, runAgentPipelineStream, type RunRequest } from "./agentClient";
import { addCollabClient, emitCollab } from "./collab";
import { userName } from "./users";
import {
  createHumanAgent,
  getHumanAgent,
  listHumanAgents,
  pickAssignee,
  pickManager,
  seedHumanAgents,
  DEPARTMENTS,
  type Department,
} from "./humans";
import {
  accountForToken,
  assertEmailAvailable,
  createAgentAccount,
  deleteSession,
  getAccountByAgentId,
  getAccountByCustomerId,
  login,
  seedAccounts,
  signup,
  type Account,
  type Role,
} from "./auth";
import { notifyTicketResolved, notifyAgentReply, notifyCustomerReply } from "./notify";
import { agentAdmin } from "./agentAdmin";

seedAccounts();
seedHumanAgents();

/** Friendly display name for a customer id — prefers the account, else roster. */
function displayCustomerName(customerId: string | null): string {
  if (!customerId) return "Guest";
  return getAccountByCustomerId(customerId)?.name ?? userName(customerId);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ---- Auth middleware -------------------------------------------------------
// Every request carries an optional Bearer token; we resolve it to an account
// once and stash it on the request. Role guards then gate individual routes.
interface AuthedRequest extends express.Request {
  account?: Account | null;
}

function tokenFromReq(req: express.Request): string | null {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim() || null;
  // Fallback for EventSource (SSE), which cannot set Authorization headers.
  const q = (req.query?.token as string) || "";
  return q.trim() || null;
}

app.use((req: AuthedRequest, _res, next) => {
  req.account = accountForToken(tokenFromReq(req));
  next();
});

function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: express.Response, next: express.NextFunction) => {
    const account = req.account;
    if (!account) return res.status(401).json({ error: "Not signed in" });
    if (roles.length && !roles.includes(account.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "api" }));

// ---- Auth routes -----------------------------------------------------------
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const result = login(String(email || ""), String(password || ""));
  if (!result.ok) return res.status(401).json({ error: "Invalid email or password" });
  res.json({ token: result.token, account: result.account });
});

app.post("/api/auth/signup", (req, res) => {
  const { email, password, name } = req.body || {};
  const result = signup(String(email || ""), String(password || ""), String(name || ""));
  if (!result.ok) return res.status(400).json({ error: result.message || "Could not create account" });
  res.json({ token: result.token, account: result.account });
});

app.post("/api/auth/logout", (req: AuthedRequest, res) => {
  const token = tokenFromReq(req);
  if (token) deleteSession(token);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req: AuthedRequest, res) => {
  if (!req.account) return res.status(401).json({ error: "Not signed in" });
  res.json({ account: req.account });
});

function canAccessTicket(ticketId: string, customerId: string | null): boolean {
  if (!ticketExists(ticketId)) return false;
  return getTicketCustomer(ticketId) === customerId;
}

// Route an escalation to the right human department based on the run.
function departmentFor(state: any): Department {
  if (state?.guard?.force_escalation) return "Trust & Safety";
  const domain = state?.sub_problems?.[0]?.domain || state?.classification?.primary_intent;
  if (domain === "billing") return "Billing";
  if (domain === "technical") return "Technical";
  if (domain === "policy") return "Policy & Compliance";
  if (domain === "orders") return "Orders";
  if (domain === "products") return "Merchandising";
  if (state?.severity?.priority === "P1") return "Escalations";
  return "Escalations";
}

type Assignee = { id: string; name: string; title: string; department: string };

// The customer-facing chat reply: confirms the ticket, gives the outcome,
// lists concrete next steps, and surfaces escalation status (new, open, or resolved).
function composeReply(
  state: any,
  displayId: string,
  assignee: Assignee | undefined,
  priorEsc: EscalationRecord | null,
  isFollowUp: boolean,
  firstCustomerMessage: string
): string {
  const r = state?.resolution;
  const header = isFollowUp ? `Update on ticket ${displayId}.` : `Ticket ${displayId} has been created.`;
  const lines: string[] = [header];

  if (r?.summary) lines.push("", r.summary);

  const actions: string[] = Array.isArray(r?.actions) ? r.actions.filter(Boolean) : [];
  if (actions.length) {
    lines.push("", "Next steps:");
    for (const a of actions) lines.push(`• ${a}`);
  }

  const escalatedNow = !!state?.escalation?.escalate;
  const openEsc = priorEsc?.status === "open" ? priorEsc : null;
  const resolvedEsc = priorEsc?.status === "resolved" ? priorEsc : null;

  if (escalatedNow && assignee) {
    const urgency = state.escalation.urgency ? ` (${state.escalation.urgency})` : "";
    lines.push(
      "",
      `This case has been escalated to ${assignee.name} — ${assignee.title}, ${assignee.department}${urgency}. They'll follow up with you shortly.`
    );
    if (firstCustomerMessage && firstCustomerMessage !== state.message) {
      lines.push(`(Regarding: "${firstCustomerMessage.slice(0, 120)}${firstCustomerMessage.length > 120 ? "…" : ""}")`);
    }
  } else if (openEsc) {
    const urgency = openEsc.urgency ? ` (${openEsc.urgency})` : "";
    lines.push(
      "",
      `Your case is still with ${openEsc.assignee_name} — ${openEsc.assignee_title}, ${openEsc.department}${urgency}. No further action needed from you right now; they'll follow up.`
    );
  } else if (resolvedEsc && isFollowUp) {
    lines.push(
      "",
      `Your escalation was marked resolved by ${resolvedEsc.assignee_name} (${resolvedEsc.assignee_title}). If you need more help, reply here and we'll reopen the case.`
    );
  }

  return lines.join("\n");
}

function assigneeFromRecord(rec: EscalationRecord): Assignee {
  return {
    id: rec.assignee_id,
    name: rec.assignee_name,
    title: rec.assignee_title,
    department: rec.department,
  };
}

/** Persist escalation + compose the system reply after a pipeline run completes. */
function finalizeTicketRun(opts: {
  state: any;
  ticketId: string;
  customerId: string | null;
  parentTicketId?: string | null;
  isNewTicket?: boolean;
  history: { role: string; text: string }[];
  message: string;
  isFollowUp: boolean;
  priorEsc: EscalationRecord | null;
  runId: string;
}) {
  const { state, ticketId, customerId, parentTicketId, isNewTicket, history, message, isFollowUp, priorEsc, runId } = opts;

  const category: string = state?.classification?.category ?? "support";
  const nonSupport =
    category === "greeting" || category === "out_of_scope" || category === "faq";

  // A brand-new conversation that opens with a greeting, FAQ, or out-of-scope
  // message does NOT create a ticket. Reply once, persist nothing.
  if (isNewTicket && nonSupport) {
    const now = new Date().toISOString();
    const reply = state?.resolution?.summary ?? "Thanks for reaching out!";
    return {
      ticket_id: "",
      display_id: "",
      status: "active" as const,
      summary: state?.resolution?.summary ?? null,
      run: state,
      messages: [
        { role: "customer", text: message, timestamp: now },
        { role: "system", text: reply, timestamp: now },
      ],
      escalation_id: null,
      escalation_status: null,
      ephemeral: true,
    };
  }

  // Real support request on a new ticket → create + persist it now (deferred
  // from executeTicketRun so greetings never reach this point).
  if (isNewTicket) {
    ensureTicket(ticketId, customerId, parentTicketId ?? null);
    addMessage(ticketId, "customer", message);
  }

  const displayId = getTicketDisplayId(ticketId);
  const firstCustomerMessage =
    history.find((m) => m.role === "customer")?.text ?? message;

  let assignee: Assignee | undefined;
  let escalationRecord: EscalationRecord | null = priorEsc;

  if (state?.escalation?.escalate) {
    const existingOpen = getOpenEscalationForTicket(ticketId);
    if (existingOpen) {
      assignee = assigneeFromRecord(existingOpen);
      escalationRecord = existingOpen;
    } else {
      const dept = departmentFor(state);
      const human = pickAssignee(dept, countOpenByAssignee());
      assignee = { id: human.id, name: human.name, title: human.title, department: dept };
      escalationRecord = createEscalation({
        ticket_id: ticketId,
        customer_id: customerId,
        customer_name: displayCustomerName(customerId),
        subject: firstCustomerMessage.slice(0, 140),
        department: dept,
        team: state.escalation.recommended_team ?? null,
        urgency: state.escalation.urgency ?? null,
        reason: state.escalation.reason ?? null,
        assignee_id: human.id,
        assignee_name: human.name,
        assignee_title: human.title,
      });
      const act = recordTeamActivity({
        kind: "escalation_created",
        actor_name: "Engine",
        ticket_id: ticketId,
        escalation_id: escalationRecord.id,
        summary: `New ${state.escalation.urgency ?? ""} case → ${human.name} (${dept})`.replace(/\s+/g, " ").trim(),
      });
      emitCollab({ type: "escalation_created", activity: act });
    }
    state.escalation.assigned_agent = assignee;
    if (escalationRecord) state.escalation.escalation_id = escalationRecord.id;
  } else if (priorEsc?.status === "open") {
    assignee = assigneeFromRecord(priorEsc);
    state.escalation = { ...(state.escalation ?? {}), escalate: true, assigned_agent: assignee };
  }

  // Non-support turns on an existing ticket (e.g. a "thanks") get the plain
  // assistant reply without the "ticket created / update" framing or escalation lines.
  const reply = nonSupport
    ? state?.resolution?.summary ?? "Thanks for reaching out!"
    : composeReply(state, displayId, assignee, escalationRecord, isFollowUp, firstCustomerMessage);
  addMessage(ticketId, "system", reply);
  saveRun(runId, ticketId, state);

  const status = escalationRecord
    ? escalationRecord.status === "open"
      ? "escalated"
      : "resolved"
    : state?.investigation?.overall_status === "resolved"
      ? "resolved"
      : "active";

  return {
    ticket_id: ticketId,
    display_id: displayId,
    status,
    summary: state?.resolution?.summary ?? null,
    run: state,
    messages: getMessages(ticketId),
    escalation_id: escalationRecord?.id ?? null,
    escalation_status: escalationRecord?.status ?? null,
  };
}

async function executeTicketRun(body: Record<string, unknown>, authCustomerId: string) {
  const { ticket_id, message, link_to } = body || {};
  if (!message || typeof message !== "string" || !message.trim()) {
    return { error: "Please enter a message", status: 400 as const };
  }

  // "Start a new linked ticket" branches off a resolved ticket: a brand-new
  // ticket that records its parent. Otherwise continue/create as normal.
  let parentTicketId: string | null = null;
  let ticketId: string;
  if (link_to && String(link_to).trim()) {
    const parent = String(link_to).trim();
    if (!ticketExists(parent) || getTicketCustomer(parent) !== authCustomerId) {
      return { error: "Linked ticket not found", status: 404 as const };
    }
    parentTicketId = parent;
    ticketId = `T-${randomUUID().slice(0, 8)}`;
  } else {
    ticketId =
      ticket_id && String(ticket_id).trim() ? String(ticket_id) : `T-${randomUUID().slice(0, 8)}`;
  }

  const requestedCustomer = authCustomerId;
  const exists = ticketExists(ticketId);
  const existingCustomer = getTicketCustomer(ticketId);
  if (exists && existingCustomer !== requestedCustomer) {
    return { error: "Ticket does not belong to the selected customer", status: 403 as const };
  }
  const customerId = exists ? existingCustomer : requestedCustomer;

  // Brand-new conversation: defer creating the ticket + persisting the message
  // until AFTER the pipeline runs, so a greeting / out-of-scope opener never
  // creates a ticket. Existing tickets persist the follow-up immediately.
  const isNewTicket = !exists;
  if (!isNewTicket) ensureTicket(ticketId, customerId, parentTicketId);

  // Agent contract: history is prior customer messages only. Full thread remains
  // available for display via getMessages(), while structured prior_context
  // carries the previous run's support response/reports/investigation.
  const history = exists ? getCustomerHistory(ticketId) : [];
  const isFollowUp = history.length > 0;
  const priorContext = isFollowUp ? getLatestRunContext(ticketId) : null;

  const priorEsc = exists ? getLatestEscalationForTicket(ticketId) : null;
  const ticketStatus = priorEsc
    ? {
        has_escalation: true,
        escalation_status: priorEsc.status,
        assignee_name: priorEsc.assignee_name,
        department: priorEsc.department,
        urgency: priorEsc.urgency,
      }
    : { has_escalation: false };

  if (!isNewTicket) addMessage(ticketId, "customer", message);
  const messageCount = isNewTicket ? 1 : countCustomerMessages(ticketId);
  const runId = `R-${randomUUID().slice(0, 8)}`;

  const runReq: RunRequest = {
    ticket_id: ticketId,
    run_id: runId,
    message,
    message_count: messageCount,
    ...(customerId ? { customer_id: customerId } : {}),
    ticket_status: ticketStatus,
    ...(priorContext ? { prior_context: priorContext } : {}),
    history,
  };

  return {
    ticketId,
    customerId,
    parentTicketId,
    isNewTicket,
    history,
    isFollowUp,
    priorEsc,
    runId,
    runReq,
  };
}

// Create a ticket OR add a follow-up message, then run the pipeline.
app.post("/api/tickets", requireRole("user"), async (req: AuthedRequest, res) => {
  try {
    const prep = await executeTicketRun(req.body || {}, req.account!.customer_id ?? "");
    if ("error" in prep) return res.status(prep.status).json({ error: prep.error });

    let state: any;
    try {
      state = await runAgentPipeline(prep.runReq);
    } catch (err) {
      return res.status(502).json({
        error: "The resolution engine is unavailable. Please try again.",
        detail: (err as Error).message,
      });
    }

    const result = finalizeTicketRun({
      state,
      ticketId: prep.ticketId,
      customerId: prep.customerId,
      parentTicketId: prep.parentTicketId,
      isNewTicket: prep.isNewTicket,
      history: prep.history,
      message: prep.runReq.message,
      isFollowUp: prep.isFollowUp,
      priorEsc: prep.priorEsc,
      runId: prep.runId,
    });
    res.json(result);
  } catch (err) {
    console.error("[api] /api/tickets failed:", err);
    res.status(500).json({ error: "Something went wrong", detail: (err as Error).message });
  }
});

/** Same as POST /api/tickets but streams real pipeline step events (SSE). */
app.post("/api/tickets/stream", requireRole("user"), async (req: AuthedRequest, res) => {
  try {
    const prep = await executeTicketRun(req.body || {}, req.account!.customer_id ?? "");
    if ("error" in prep) return res.status(prep.status).json({ error: prep.error });

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (data: unknown) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let state: any;
    try {
      for await (const evt of runAgentPipelineStream(prep.runReq)) {
        if (evt.type === "done" && evt.state) {
          state = evt.state;
          continue;
        }
        send(evt);
      }
    } catch (err) {
      // If SSE/progress mode fails after we've accepted the message, fall back to
      // the regular non-streaming pipeline with the same run request. This avoids
      // duplicating the customer message while still completing the ticket.
      send({
        type: "step_start",
        message: `Live progress failed; retrying without streaming: ${(err as Error).message}`,
      });
      try {
        state = await runAgentPipeline(prep.runReq);
      } catch (fallbackErr) {
        send({ type: "error", message: (fallbackErr as Error).message });
        res.end();
        return;
      }
    }

    if (!state) {
      send({ type: "error", message: "Pipeline finished without a result" });
      res.end();
      return;
    }

    const result = finalizeTicketRun({
      state,
      ticketId: prep.ticketId,
      customerId: prep.customerId,
      parentTicketId: prep.parentTicketId,
      isNewTicket: prep.isNewTicket,
      history: prep.history,
      message: prep.runReq.message,
      isFollowUp: prep.isFollowUp,
      priorEsc: prep.priorEsc,
      runId: prep.runId,
    });
    send({ type: "complete", ...result });
    res.end();
  } catch (err) {
    console.error("[api] /api/tickets/stream failed:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Something went wrong", detail: (err as Error).message });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", message: (err as Error).message })}\n\n`);
      res.end();
    }
  }
});

// List tickets for the sidebar, scoped to the signed-in customer.
app.get("/api/tickets", requireRole("user"), (req: AuthedRequest, res) => {
  res.json({ tickets: listTickets(req.account!.customer_id ?? "") });
});

// ---- Escalation dashboard --------------------------------------------------
// Admins see every case; agents see only the cases assigned to them.
app.get("/api/escalations", requireRole("admin", "agent"), (req: AuthedRequest, res) => {
  const account = req.account!;
  const all = listEscalations();
  const escalations =
    account.role === "agent" ? all.filter((e) => e.assignee_id === account.agent_id) : all;
  res.json({ escalations, agents: listHumanAgents(), me: account });
});

app.post("/api/escalations/:id/resolve", requireRole("admin", "agent"), (req: AuthedRequest, res) => {
  const account = req.account!;
  const esc = getEscalationById(req.params.id);
  if (!esc) return res.status(404).json({ error: "Escalation not found" });
  if (account.role === "agent" && esc.assignee_id !== account.agent_id) {
    return res.status(403).json({ error: "Not your case" });
  }
  resolveEscalation(req.params.id);
  // Tell the customer their case is resolved (in-app + email). Best-effort.
  if (esc.customer_id) {
    void notifyTicketResolved(esc.customer_id, esc.ticket_id, esc.subject);
  }
  const act = recordTeamActivity({
    kind: "escalation_resolved",
    actor_id: account.agent_id,
    actor_name: account.name,
    ticket_id: esc.ticket_id,
    escalation_id: esc.id,
    summary: `${account.name} resolved ${esc.subject || esc.ticket_id}`,
  });
  emitCollab({ type: "escalation_resolved", activity: act });
  res.json({ ok: true });
});

// Hand a case up to the department manager when the agent can't resolve it.
// The agent may attach a short note describing what they tried / what's needed.
app.post("/api/escalations/:id/handoff", requireRole("admin", "agent"), (req: AuthedRequest, res) => {
  const account = req.account!;
  const esc = getEscalationById(req.params.id);
  if (!esc) return res.status(404).json({ error: "Escalation not found" });
  if (esc.status !== "open") return res.status(400).json({ error: "Case is already closed" });
  if (account.role === "agent" && esc.assignee_id !== account.agent_id) {
    return res.status(403).json({ error: "Not your case" });
  }
  if ((esc.assignee_level ?? "agent") === "manager") {
    return res.status(400).json({ error: "Case is already with a manager" });
  }
  const manager = pickManager(esc.department as Department);
  if (!manager) {
    return res.status(409).json({ error: `No manager configured for ${esc.department}` });
  }
  const note = String(req.body?.note || "").trim() || null;
  reassignEscalation(req.params.id, manager, "manager", note);

  // Let the manager know a case has landed with them (in-app bell). Best-effort.
  const managerAccount = getAccountByAgentId(manager.id);
  if (managerAccount) {
    createNotification({
      account_id: managerAccount.id,
      kind: "escalation_handoff",
      title: `Case handed up: ${esc.subject || esc.ticket_id}`,
      body: note ? `From ${account.name}: ${note}` : `Handed up by ${account.name}.`,
      ticket_id: esc.ticket_id,
    });
  }
  const act = recordTeamActivity({
    kind: "escalation_handoff",
    actor_id: account.agent_id,
    actor_name: account.name,
    ticket_id: esc.ticket_id,
    escalation_id: esc.id,
    summary: `${account.name} handed ${esc.subject || esc.ticket_id} up to ${manager.name}`,
  });
  emitCollab({ type: "escalation_handoff", activity: act });
  res.json({ ok: true, assignee: manager });
});

// The assigned human agent (or an admin) replies directly to the customer on an
// open case. Stored as an `agent` message and the customer is notified.
app.post("/api/escalations/:id/reply", requireRole("admin", "agent"), (req: AuthedRequest, res) => {
  const account = req.account!;
  const esc = getEscalationById(req.params.id);
  if (!esc) return res.status(404).json({ error: "Escalation not found" });
  if (esc.status !== "open") return res.status(400).json({ error: "Case is already closed" });
  if (account.role === "agent" && esc.assignee_id !== account.agent_id) {
    return res.status(403).json({ error: "Not your case" });
  }
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Message is empty" });

  addMessage(esc.ticket_id, "agent", text);
  void notifyAgentReply(esc.customer_id, esc.ticket_id, account.name, text);

  const act = recordTeamActivity({
    kind: "agent_reply",
    actor_id: account.agent_id,
    actor_name: account.name,
    ticket_id: esc.ticket_id,
    escalation_id: esc.id,
    summary: `${account.name} replied to ${esc.customer_name} on ${esc.subject || esc.ticket_id}`,
  });
  emitCollab({ type: "agent_reply", activity: act });
  res.json({ ok: true, messages: getMessages(esc.ticket_id) });
});

// Internal team note on a case (agent-to-agent collaboration, not customer-visible).
app.post("/api/escalations/:id/note", requireRole("admin", "agent"), (req: AuthedRequest, res) => {
  const account = req.account!;
  const esc = getEscalationById(req.params.id);
  if (!esc) return res.status(404).json({ error: "Escalation not found" });
  const body = String(req.body?.body || "").trim();
  if (!body) return res.status(400).json({ error: "Note is empty" });
  const note = addCaseNote({
    escalation_id: esc.id,
    ticket_id: esc.ticket_id,
    author_id: account.agent_id ?? account.id,
    author_name: account.name,
    body: body.slice(0, 2000),
  });
  const act = recordTeamActivity({
    kind: "case_note",
    actor_id: account.agent_id,
    actor_name: account.name,
    ticket_id: esc.ticket_id,
    escalation_id: esc.id,
    summary: `${account.name} noted on ${esc.subject || esc.ticket_id}: ${body.slice(0, 80)}`,
  });
  emitCollab({ type: "case_note", note, activity: act });
  res.json({ ok: true, note });
});

// List internal notes for a case.
app.get("/api/escalations/:id/notes", requireRole("admin", "agent"), (req: AuthedRequest, res) => {
  res.json({ notes: listCaseNotes(req.params.id) });
});

// ---- Real-time collaboration (Team dashboard) ------------------------------
const PRESENCE_ONLINE_MS = 35_000;

// Build the collaboration snapshot: roster with presence + load, open cases,
// recent activity, and recent team notes.
function collabOverview() {
  const presence = listAgentPresence();
  const seen = new Map(presence.map((p) => [p.agent_id, p.last_seen]));
  const openCounts = countOpenByAssignee();
  const now = Date.now();
  const agents = listHumanAgents().map((a) => {
    const last = seen.get(a.id) ?? 0;
    return {
      id: a.id,
      name: a.name,
      title: a.title,
      department: a.department,
      level: a.level ?? "agent",
      open_cases: openCounts[a.id] ?? 0,
      online: now - last < PRESENCE_ONLINE_MS,
      last_seen: last ? new Date(last).toISOString() : null,
    };
  });
  const open = listEscalations().filter((e) => e.status === "open");
  return {
    agents,
    online_count: agents.filter((a) => a.online).length,
    open_cases: open.length,
    activity: listTeamActivity(60),
    notes: listRecentCaseNotes(20),
    open_escalations: open,
  };
}

// Agent heartbeat — keeps presence fresh. Sent periodically by the dashboard.
app.post("/api/collab/heartbeat", requireRole("admin", "agent"), (req: AuthedRequest, res) => {
  const account = req.account!;
  if (account.agent_id) {
    recordAgentPresence(account.agent_id, account.id, account.name);
    emitCollab({ type: "presence", agent_id: account.agent_id, online: true });
  }
  res.json({ ok: true });
});

app.get("/api/collab/overview", requireRole("admin", "agent"), (_req, res) => {
  res.json(collabOverview());
});

// SSE stream of live collaboration events (escalation lifecycle + presence).
app.get("/api/collab/stream", requireRole("admin", "agent"), (req: AuthedRequest, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`data: ${JSON.stringify({ type: "hello", ts: new Date().toISOString() })}\n\n`);
  const unsubscribe = addCollabClient(res);
  req.on("close", () => {
    unsubscribe();
    res.end();
  });
});

// ---- Notifications (recipient-scoped) --------------------------------------
app.get("/api/notifications", requireRole("user", "admin", "agent"), (req: AuthedRequest, res) => {
  const account = req.account!;
  res.json({
    notifications: listNotifications(account.id),
    unread: countUnread(account.id),
  });
});

app.post("/api/notifications/:id/read", requireRole("user", "admin", "agent"), (req: AuthedRequest, res) => {
  markNotificationRead(req.params.id, req.account!.id);
  res.json({ ok: true, unread: countUnread(req.account!.id) });
});

app.post("/api/notifications/read-all", requireRole("user", "admin", "agent"), (req: AuthedRequest, res) => {
  markAllNotificationsRead(req.account!.id);
  res.json({ ok: true, unread: 0 });
});

// ---- Platform: live config store (admin only) ------------------------------
// Every mutation proxies to the agent's config store AND records who-did-what.
function audit(req: AuthedRequest, action: string, target: string, detail?: string) {
  const a = req.account!;
  recordConfigAudit({ actor_id: a.id, actor_name: a.name, action, target, detail: detail ?? null });
}

async function platform(res: any, fn: () => Promise<any>) {
  try {
    res.json(await fn());
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
}

// KB docs
app.get("/api/platform/kb", requireRole("admin"), (_req, res) => platform(res, () => agentAdmin.listKb()));
app.put("/api/platform/kb/:file", requireRole("admin"), (req: AuthedRequest, res) =>
  platform(res, async () => {
    const out = await agentAdmin.putKb(req.params.file, String((req.body ?? {}).content ?? ""));
    audit(req, "kb.upsert", req.params.file);
    return out;
  })
);
app.delete("/api/platform/kb/:file", requireRole("admin"), (req: AuthedRequest, res) =>
  platform(res, async () => {
    const out = await agentAdmin.deleteKb(req.params.file);
    audit(req, "kb.delete", req.params.file);
    return out;
  })
);

// Suggested KB article generation. Accepts either a `ticket_id` (we assemble the
// source from its latest resolved run) or a raw `source` object. Returns a DRAFT
// the admin reviews + saves via PUT /api/platform/kb/:file — nothing is written here.
app.post("/api/platform/kb/suggest", requireRole("admin"), (req: AuthedRequest, res) =>
  platform(res, async () => {
    const body = (req.body ?? {}) as { ticket_id?: string; source?: Record<string, unknown> };
    let source: Record<string, unknown> = body.source ?? {};

    if (body.ticket_id) {
      const state: any = getLatestRun(body.ticket_id);
      if (!state) throw new Error("No run found for that ticket");
      const reports: any[] = Array.isArray(state.agent_reports) ? state.agent_reports : [];
      const firstCustomer =
        getMessages(body.ticket_id).find((m) => m.role === "customer")?.text ?? state.message ?? "";
      source = {
        question: firstCustomer,
        resolution: state.resolution?.summary ?? "",
        findings: [
          ...reports.flatMap((r) => (Array.isArray(r.findings) ? r.findings : [])),
          ...(Array.isArray(state.resolution?.findings) ? state.resolution.findings : []),
        ].slice(0, 12),
        actions: [
          ...reports.flatMap((r) => (Array.isArray(r.actions) ? r.actions : [])),
          ...(Array.isArray(state.resolution?.actions) ? state.resolution.actions : []),
        ].slice(0, 12),
        domain: state.classification?.primary_intent ?? undefined,
      };
    }

    const out = await agentAdmin.generateKb(source);
    audit(req, "kb.suggest", body.ticket_id ?? "manual");
    return out;
  })
);

// Use cases
app.get("/api/platform/usecases", requireRole("admin"), (_req, res) =>
  platform(res, () => agentAdmin.listUseCases())
);
app.put("/api/platform/usecases/:agent", requireRole("admin"), (req: AuthedRequest, res) =>
  platform(res, async () => {
    const out = await agentAdmin.putUseCase(req.params.agent, req.body);
    audit(req, "usecase.upsert", `${req.params.agent}/${(req.body ?? {}).use_case_id ?? "?"}`);
    return out;
  })
);
app.delete("/api/platform/usecases/:agent/:id", requireRole("admin"), (req: AuthedRequest, res) =>
  platform(res, async () => {
    const out = await agentAdmin.deleteUseCase(req.params.agent, req.params.id);
    audit(req, "usecase.delete", `${req.params.agent}/${req.params.id}`);
    return out;
  })
);

// Declarative HTTP tools
app.get("/api/platform/tools", requireRole("admin"), (_req, res) =>
  platform(res, () => agentAdmin.listTools())
);
app.put("/api/platform/tools/:name", requireRole("admin"), (req: AuthedRequest, res) =>
  platform(res, async () => {
    const out = await agentAdmin.putTool(req.params.name, req.body);
    audit(req, "tool.upsert", req.params.name, JSON.stringify(req.body?.url_template ?? ""));
    return out;
  })
);
app.delete("/api/platform/tools/:name", requireRole("admin"), (req: AuthedRequest, res) =>
  platform(res, async () => {
    const out = await agentAdmin.deleteTool(req.params.name);
    audit(req, "tool.delete", req.params.name);
    return out;
  })
);

// Policies — hard checks (guard), escalation rules, intent-router thresholds
app.get("/api/platform/policies", requireRole("admin"), (_req, res) =>
  platform(res, () => agentAdmin.getPolicies())
);
app.put("/api/platform/policies", requireRole("admin"), (req: AuthedRequest, res) =>
  platform(res, async () => {
    const out = await agentAdmin.putPolicies(req.body);
    audit(req, "policies.update", "policies");
    return out;
  })
);

// Specialist agents — add/edit/remove the AI agents the pipeline routes to
app.get("/api/platform/specialists", requireRole("admin"), (_req, res) =>
  platform(res, () => agentAdmin.listSpecialists())
);
app.put("/api/platform/specialists/:name", requireRole("admin"), (req: AuthedRequest, res) =>
  platform(res, async () => {
    const out = await agentAdmin.putSpecialist(req.params.name, req.body);
    audit(req, "agent.upsert", req.params.name);
    return out;
  })
);
app.delete("/api/platform/specialists/:name", requireRole("admin"), (req: AuthedRequest, res) =>
  platform(res, async () => {
    const out = await agentAdmin.deleteSpecialist(req.params.name);
    audit(req, "agent.delete", req.params.name);
    return out;
  })
);

// FAQ / canned responses — checked first in the pipeline (like greetings)
app.get("/api/platform/faq", requireRole("admin"), (_req, res) =>
  platform(res, () => agentAdmin.listFaqs())
);
app.post("/api/platform/faq", requireRole("admin"), (req: AuthedRequest, res) =>
  platform(res, async () => {
    const out = await agentAdmin.createFaq(req.body);
    audit(req, "faq.create", out?.faq?.label ?? "faq");
    return out;
  })
);
app.put("/api/platform/faq/:id", requireRole("admin"), (req: AuthedRequest, res) =>
  platform(res, async () => {
    const out = await agentAdmin.putFaq(req.params.id, req.body);
    audit(req, "faq.upsert", out?.faq?.label ?? req.params.id);
    return out;
  })
);
app.delete("/api/platform/faq/:id", requireRole("admin"), (req: AuthedRequest, res) =>
  platform(res, async () => {
    const out = await agentAdmin.deleteFaq(req.params.id);
    audit(req, "faq.delete", req.params.id);
    return out;
  })
);

// Audit feed
app.get("/api/platform/audit", requireRole("admin"), (_req, res) => {
  res.json({ audit: listConfigAudit(200) });
});

// ---- Feedback (thumbs up/down on AI replies) -------------------------------

// Customer rates an AI reply on one of their tickets.
app.post("/api/feedback", requireRole("user"), (req: AuthedRequest, res) => {
  const customer = req.account!.customer_id ?? "";
  const { ticket_id, message_id, rating, comment } = (req.body ?? {}) as {
    ticket_id?: string;
    message_id?: number;
    rating?: string;
    comment?: string;
  };
  if (!ticket_id || typeof message_id !== "number" || (rating !== "up" && rating !== "down")) {
    return res.status(400).json({ error: "ticket_id, message_id and rating ('up'|'down') are required" });
  }
  if (!canAccessTicket(ticket_id, customer)) {
    return res.status(404).json({ error: "Ticket not found" });
  }
  // The message must exist and belong to this ticket, and be an assistant reply.
  const msg = getMessageById(message_id);
  if (!msg || msg.ticket_id !== ticket_id || msg.role === "customer") {
    return res.status(400).json({ error: "Invalid message for feedback" });
  }
  upsertFeedback({
    ticket_id,
    message_id,
    customer_id: customer || null,
    rating,
    comment: comment?.slice(0, 1000) ?? null,
    question: getQuestionForMessage(ticket_id, message_id),
    answer: msg.text,
  });
  res.json({ ok: true });
});

// Customer reads back their ratings for one ticket (to render the chat state).
app.get("/api/feedback/:ticketId", requireRole("user"), (req: AuthedRequest, res) => {
  const customer = req.account!.customer_id ?? "";
  if (!canAccessTicket(req.params.ticketId, customer)) {
    return res.status(404).json({ error: "Ticket not found" });
  }
  res.json({ feedback: getFeedbackForTicket(req.params.ticketId) });
});

// Admin reviews all feedback.
app.get("/api/admin/feedback", requireRole("admin"), (_req, res) => {
  const feedback = listAllFeedback(500).map((f) => ({
    ...f,
    customer_name: displayCustomerName(f.customer_id),
  }));
  res.json({ feedback });
});

// ---- Admin: human-agent management -----------------------------------------
app.get("/api/admin/departments", requireRole("admin"), (_req, res) => {
  res.json({ departments: DEPARTMENTS });
});

// List every human agent with their login email + escalation counts.
app.get("/api/admin/agents", requireRole("admin"), (_req, res) => {
  const escalations = listEscalations();
  const agents = listHumanAgents().map((a) => {
    const cases = escalations.filter((e) => e.assignee_id === a.id);
    const open = cases.filter((e) => e.status === "open").length;
    return {
      ...a,
      email: getAccountByAgentId(a.id)?.email ?? null,
      counts: { open, resolved: cases.length - open, total: cases.length },
    };
  });
  res.json({ agents, departments: DEPARTMENTS });
});

// Create a human agent + their login account in one step.
app.post("/api/admin/agents", requireRole("admin"), (req: AuthedRequest, res) => {
  const { name, title, department, email, password, level } = req.body || {};
  try {
    // Validate the email up front so we never create an agent without a login.
    assertEmailAvailable(String(email || ""));
    const agent = createHumanAgent({
      name: String(name || ""),
      title: String(title || ""),
      department: String(department || "") as Department,
      level: level === "manager" ? "manager" : "agent",
    });
    const account = createAgentAccount({
      name: agent.name,
      email: String(email || ""),
      password: password ? String(password) : undefined,
      agentId: agent.id,
    });
    audit(req, "human_agent.create", `${agent.name} (${agent.department} · ${agent.level})`, account.email);
    res.json({ agent, account });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// ---- Tickets dashboard (all conversations + traces) --------------------------
app.get("/api/dashboard/tickets", requireRole("admin"), (_req, res) => {
  const tickets = listTicketsDashboard().map((t) => ({
    ...t,
    customer_name: displayCustomerName(t.customer_id),
  }));
  res.json({ tickets });
});

// ---- Observability: agent run sessions -------------------------------------
// Every pipeline run is a "session". Admins get a flat, searchable feed for
// debugging the agent system end-to-end.
app.get("/api/observability/runs", requireRole("admin"), (_req, res) => {
  const runs = listAllRuns().map((r) => ({
    ...r,
    customer_name: displayCustomerName(getTicketCustomer(r.ticket_id)),
  }));
  res.json({ runs });
});

app.get("/api/observability/runs/:runId", requireRole("admin"), (req: AuthedRequest, res) => {
  const run = getRunById(req.params.runId);
  if (!run) return res.status(404).json({ error: "Run not found" });
  res.json({ ...run, customer_name: displayCustomerName(getTicketCustomer(run.ticket_id)) });
});

app.get("/api/dashboard/tickets/:id", requireRole("admin", "agent"), (req: AuthedRequest, res) => {
  const account = req.account!;
  // Agents may only open a ticket that's escalated to them.
  if (account.role === "agent") {
    const esc = getLatestEscalationForTicket(req.params.id);
    if (!esc || esc.assignee_id !== account.agent_id) {
      return res.status(403).json({ error: "Not your case" });
    }
  }
  const row = getTicketDashboardRow(req.params.id);
  if (!row) return res.status(404).json({ error: "Ticket not found" });

  const runs = listRunsForTicket(req.params.id).map((r) => ({
    run_id: r.run_id,
    created_at: r.created_at,
    message: r.state?.message ?? "",
    message_count: r.state?.message_count ?? 0,
    primary_intent: r.state?.classification?.primary_intent ?? null,
    severity: r.state?.severity?.level ?? null,
    priority: r.state?.severity?.priority ?? null,
    escalated: !!r.state?.escalation?.escalate,
    audit_trail: r.state?.audit_trail ?? [],
    agent_reports: r.state?.agent_reports ?? [],
    state: r.state,
  }));

  const esc = getLatestEscalationForTicket(req.params.id);

  res.json({
    ticket: { ...row, customer_name: displayCustomerName(row.customer_id) },
    messages: getMessages(req.params.id),
    runs,
    escalation: esc,
  });
});

app.get("/api/tickets/:id", requireRole("user"), (req: AuthedRequest, res) => {
  const customer = req.account!.customer_id ?? "";
  if (!canAccessTicket(req.params.id, customer)) {
    return res.status(404).json({ error: "Ticket not found" });
  }
  const run = getLatestRun(req.params.id);
  const messages = getMessages(req.params.id);
  if (!run && messages.length === 0) return res.status(404).json({ error: "Ticket not found" });
  const esc = getLatestEscalationForTicket(req.params.id);
  const row = getTicketDashboardRow(req.params.id);
  // Per-turn pipeline states (one per customer message) so the chat UI can
  // rebuild the "thoughts" shown between each user/agent turn after a reload.
  const runs = listRunsForTicket(req.params.id)
    .map((r) => r.state)
    .filter(Boolean);
  res.json({
    ticket_id: req.params.id,
    display_id: getTicketDisplayId(req.params.id),
    status: row?.status ?? "active",
    parent_ticket_id: row?.parent_ticket_id ?? null,
    summary: run?.resolution?.summary ?? null,
    run,
    runs,
    messages,
    escalation_id: esc?.id ?? null,
    escalation_status: esc?.status ?? null,
    escalation_assignee: esc && esc.status === "open" ? esc.assignee_name : null,
  });
});

// Customer posts a plain message on a ticket that has an OPEN escalation — i.e.
// they're now talking to the assigned human agent, so we skip the AI pipeline
// and just deliver the message + notify the agent. If there's no open
// escalation we return 409 so the client can fall back to the pipeline.
app.post("/api/tickets/:id/messages", requireRole("user"), (req: AuthedRequest, res) => {
  const account = req.account!;
  const customer = account.customer_id ?? "";
  if (!canAccessTicket(req.params.id, customer)) {
    return res.status(404).json({ error: "Ticket not found" });
  }
  const esc = getOpenEscalationForTicket(req.params.id);
  if (!esc) return res.status(409).json({ error: "no_open_escalation" });

  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Message is empty" });

  addMessage(req.params.id, "customer", text);
  notifyCustomerReply(esc.assignee_id, req.params.id, account.name, text);

  res.json({ ok: true, messages: getMessages(req.params.id) });
});

app.delete("/api/tickets/:id", requireRole("user"), (req: AuthedRequest, res) => {
  const customer = req.account!.customer_id ?? "";
  if (!canAccessTicket(req.params.id, customer)) {
    return res.status(404).json({ error: "Ticket not found" });
  }
  deleteTicket(req.params.id);
  res.json({ ok: true });
});

app.listen(ENV.API_PORT, () => {
  console.log(`[api] listening on http://localhost:${ENV.API_PORT}`);
  console.log(`[api] agent at ${ENV.AGENT_URL}`);
});
