// Application API. Owns tickets, history, persistence, and triggers the agent.
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { ENV } from "./env";
import {
  addMessage,
  countCustomerMessages,
  countOpenByAssignee,
  createEscalation,
  deleteTicket,
  ensureTicket,
  getLatestEscalationForTicket,
  getLatestRun,
  getMessages,
  getOpenEscalationForTicket,
  getTicketCustomer,
  getTicketDashboardRow,
  listEscalations,
  listRunsForTicket,
  listTickets,
  listTicketsDashboard,
  resolveEscalation,
  saveRun,
  type EscalationRecord,
} from "./db";
import { runAgentPipeline, runAgentPipelineStream, type RunRequest } from "./agentClient";
import { claimUser, listUsers, releaseUser, userName } from "./users";
import { HUMAN_AGENTS, pickAssignee, type Department } from "./humans";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "api" }));

// Route an escalation to the right human department based on the run.
function departmentFor(state: any): Department {
  if (state?.guard?.force_escalation) return "Trust & Safety";
  const domain = state?.sub_problems?.[0]?.domain || state?.classification?.primary_intent;
  if (domain === "billing") return "Billing";
  if (domain === "technical") return "Technical";
  if (domain === "policy") return "Policy & Compliance";
  if (state?.severity?.priority === "P1") return "Escalations";
  return "Escalations";
}

type Assignee = { id: string; name: string; title: string; department: string };

// The customer-facing chat reply: confirms the ticket, gives the outcome,
// lists concrete next steps, and surfaces escalation status (new, open, or resolved).
function composeReply(
  state: any,
  ticketId: string,
  assignee: Assignee | undefined,
  priorEsc: EscalationRecord | null,
  isFollowUp: boolean,
  firstCustomerMessage: string
): string {
  const r = state?.resolution;
  const header = isFollowUp ? `Update on ticket ${ticketId}.` : `Ticket ${ticketId} has been created.`;
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
  history: { role: string; text: string }[];
  message: string;
  isFollowUp: boolean;
  priorEsc: EscalationRecord | null;
  runId: string;
}) {
  const { state, ticketId, customerId, history, message, isFollowUp, priorEsc, runId } = opts;
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
        customer_name: userName(customerId),
        subject: firstCustomerMessage.slice(0, 140),
        department: dept,
        team: state.escalation.recommended_team ?? null,
        urgency: state.escalation.urgency ?? null,
        reason: state.escalation.reason ?? null,
        assignee_id: human.id,
        assignee_name: human.name,
        assignee_title: human.title,
      });
    }
    state.escalation.assigned_agent = assignee;
    if (escalationRecord) state.escalation.escalation_id = escalationRecord.id;
  } else if (priorEsc?.status === "open") {
    assignee = assigneeFromRecord(priorEsc);
    state.escalation = { ...(state.escalation ?? {}), escalate: true, assigned_agent: assignee };
  }

  const reply = composeReply(state, ticketId, assignee, escalationRecord, isFollowUp, firstCustomerMessage);
  addMessage(ticketId, "system", reply);
  saveRun(runId, ticketId, state);

  return {
    ticket_id: ticketId,
    run: state,
    messages: getMessages(ticketId),
    escalation_id: escalationRecord?.id ?? null,
    escalation_status: escalationRecord?.status ?? null,
  };
}

async function executeTicketRun(body: Record<string, unknown>) {
  const { ticket_id, message, customer_id } = body || {};
  if (!message || typeof message !== "string" || !message.trim()) {
    return { error: "Please enter a message", status: 400 as const };
  }

  const ticketId =
    ticket_id && String(ticket_id).trim() ? String(ticket_id) : `T-${randomUUID().slice(0, 8)}`;

  const existingCustomer = getTicketCustomer(ticketId);
  const customerId =
    existingCustomer ?? (customer_id && String(customer_id).trim() ? String(customer_id) : null);
  ensureTicket(ticketId, customerId);

  const history = getMessages(ticketId);
  const isFollowUp = history.length > 0;

  const priorEsc = getLatestEscalationForTicket(ticketId);
  const ticketStatus = priorEsc
    ? {
        has_escalation: true,
        escalation_status: priorEsc.status,
        assignee_name: priorEsc.assignee_name,
        department: priorEsc.department,
        urgency: priorEsc.urgency,
      }
    : { has_escalation: false };

  addMessage(ticketId, "customer", message);
  const messageCount = countCustomerMessages(ticketId);
  const runId = `R-${randomUUID().slice(0, 8)}`;

  const runReq: RunRequest = {
    ticket_id: ticketId,
    run_id: runId,
    message,
    message_count: messageCount,
    ...(customerId ? { customer_id: customerId } : {}),
    ticket_status: ticketStatus,
    history,
  };

  return {
    ticketId,
    customerId,
    history,
    isFollowUp,
    priorEsc,
    runId,
    runReq,
  };
}

// Create a ticket OR add a follow-up message, then run the pipeline.
app.post("/api/tickets", async (req, res) => {
  try {
    const prep = await executeTicketRun(req.body || {});
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
app.post("/api/tickets/stream", async (req, res) => {
  try {
    const prep = await executeTicketRun(req.body || {});
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
      send({ type: "error", message: (err as Error).message });
      res.end();
      return;
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

// List tickets for the sidebar, scoped to the selected customer (?customer=).
// No customer → anonymous/guest tickets. Server-backed, survives browser swaps.
app.get("/api/tickets", (req, res) => {
  const customer = req.query.customer ? String(req.query.customer) : null;
  res.json({ tickets: listTickets(customer) });
});

// ---- Identity / presence ---------------------------------------------------
// Customers you can "act as". A simple TTL lock keeps two instances off the
// same customer at once.
app.get("/api/users", (req, res) => {
  const session = req.query.session ? String(req.query.session) : undefined;
  res.json({ users: listUsers(session) });
});

app.post("/api/users/:id/claim", (req, res) => {
  const session = String((req.body && req.body.session) || "");
  if (!session) return res.status(400).json({ error: "session required" });
  const result = claimUser(req.params.id, session);
  if (!result.ok) {
    const status = result.reason === "occupied" ? 409 : 404;
    return res.status(status).json({ error: result.reason, users: listUsers(session) });
  }
  res.json({ ok: true, users: listUsers(session) });
});

app.post("/api/users/:id/release", (req, res) => {
  const session = String((req.body && req.body.session) || "");
  if (session) releaseUser(req.params.id, session);
  res.json({ ok: true });
});

// ---- Escalation dashboard --------------------------------------------------
app.get("/api/escalations", (_req, res) => {
  res.json({ escalations: listEscalations(), agents: HUMAN_AGENTS });
});

app.post("/api/escalations/:id/resolve", (req, res) => {
  resolveEscalation(req.params.id);
  res.json({ ok: true });
});

// ---- Tickets dashboard (all conversations + traces) --------------------------
app.get("/api/dashboard/tickets", (_req, res) => {
  const tickets = listTicketsDashboard().map((t) => ({
    ...t,
    customer_name: userName(t.customer_id),
  }));
  res.json({ tickets });
});

app.get("/api/dashboard/tickets/:id", (req, res) => {
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
    ticket: { ...row, customer_name: userName(row.customer_id) },
    messages: getMessages(req.params.id),
    runs,
    escalation: esc,
  });
});

app.get("/api/tickets/:id", (req, res) => {
  const run = getLatestRun(req.params.id);
  const messages = getMessages(req.params.id);
  if (!run && messages.length === 0) return res.status(404).json({ error: "Ticket not found" });
  const esc = getLatestEscalationForTicket(req.params.id);
  res.json({
    ticket_id: req.params.id,
    run,
    messages,
    escalation_id: esc?.id ?? null,
    escalation_status: esc?.status ?? null,
  });
});

app.delete("/api/tickets/:id", (req, res) => {
  deleteTicket(req.params.id);
  res.json({ ok: true });
});

app.listen(ENV.API_PORT, () => {
  console.log(`[api] listening on http://localhost:${ENV.API_PORT}`);
  console.log(`[api] agent at ${ENV.AGENT_URL}`);
});
