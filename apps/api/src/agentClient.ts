// Calls the Agent System (LangGraph service) to run the pipeline.
import { ENV } from "./env";

export interface RunRequest {
  ticket_id: string;
  run_id: string;
  message: string;
  message_count: number;
  history: { role: string; text: string; timestamp: string }[];
}

export async function runAgentPipeline(req: RunRequest): Promise<any> {
  const res = await fetch(`${ENV.AGENT_URL}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`agent returned ${res.status}: ${detail}`);
  }
  return res.json();
}
