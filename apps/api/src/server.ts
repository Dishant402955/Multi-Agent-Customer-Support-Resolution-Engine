// Application API. Owns tickets, history, persistence, and triggers the agent.
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { ENV } from "./env";
import {
  addMessage,
  countCustomerMessages,
  ensureTicket,
  getCustomerHistory,
  getLatestRun,
  saveRun,
} from "./db";
import { runAgentPipeline } from "./agentClient";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "api" }));

// Create a ticket OR add a follow-up message, then run the pipeline.
app.post("/api/tickets", async (req, res) => {
  try {
    const { ticket_id, message } = req.body || {};
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Please enter a message" });
    }

    const ticketId =
      ticket_id && String(ticket_id).trim() ? String(ticket_id) : `T-${randomUUID().slice(0, 8)}`;
    ensureTicket(ticketId);

    const history = getCustomerHistory(ticketId); // prior turns (before this one)
    addMessage(ticketId, "customer", message);
    const messageCount = countCustomerMessages(ticketId);
    const runId = `R-${randomUUID().slice(0, 8)}`;

    let state: any;
    try {
      state = await runAgentPipeline({
        ticket_id: ticketId,
        run_id: runId,
        message,
        message_count: messageCount,
        history,
      });
    } catch (err) {
      return res.status(502).json({
        error: "The resolution engine is unavailable. Please try again.",
        detail: (err as Error).message,
      });
    }

    if (state?.resolution?.summary) addMessage(ticketId, "system", state.resolution.summary);
    saveRun(runId, ticketId, state);

    res.json(state);
  } catch (err) {
    console.error("[api] /api/tickets failed:", err);
    res.status(500).json({ error: "Something went wrong", detail: (err as Error).message });
  }
});

app.get("/api/tickets/:id", (req, res) => {
  const latest = getLatestRun(req.params.id);
  if (!latest) return res.status(404).json({ error: "Ticket not found" });
  res.json(latest);
});

app.listen(ENV.API_PORT, () => {
  console.log(`[api] listening on http://localhost:${ENV.API_PORT}`);
  console.log(`[api] agent at ${ENV.AGENT_URL}`);
});
