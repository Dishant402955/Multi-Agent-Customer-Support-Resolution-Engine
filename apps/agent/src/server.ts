// Agent System HTTP service. The Application API calls POST /run with the
// pipeline-entry JSON and gets the full pipeline state back.
import express from "express";
import cors from "cors";
import { ENV } from "./env";
import { buildInput, runPipeline } from "./run";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "agent" }));

app.post("/run", async (req, res) => {
  try {
    const { ticket_id, run_id, message, message_count, history } = req.body || {};
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "message is required" });
    }
    const input = buildInput({ ticket_id, run_id, message, message_count, history });
    const result = await runPipeline(input);
    res.json(result);
  } catch (err) {
    console.error("[agent] /run failed:", err);
    res.status(500).json({ error: "pipeline failed", detail: (err as Error).message });
  }
});

app.listen(ENV.AGENT_PORT, () => {
  console.log(`[agent] listening on http://localhost:${ENV.AGENT_PORT}`);
});
