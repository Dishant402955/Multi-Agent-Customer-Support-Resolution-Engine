// Calls the Agent System (LangGraph service) to run the pipeline.
import { ENV } from "./env";

export interface RunRequest {
  ticket_id: string;
  run_id: string;
  message: string;
  message_count: number;
  customer_id?: string;
  ticket_status?: {
    has_escalation: boolean;
    escalation_status?: string | null;
    assignee_name?: string | null;
    department?: string | null;
    urgency?: string | null;
  };
  history: { role: string; text: string; timestamp: string }[];
}

export type PipelineProgressEvent = {
  type: "step_start" | "step_done" | "agent_done" | "done" | "error";
  step?: string;
  audit?: unknown[];
  agent?: string;
  message?: string;
  snapshot?: Record<string, unknown>;
  state?: unknown;
};

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

/** Stream pipeline progress (SSE) from the agent service. */
export async function* runAgentPipelineStream(
  req: RunRequest
): AsyncGenerator<PipelineProgressEvent> {
  const res = await fetch(`${ENV.AGENT_URL}/run/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`agent stream returned ${res.status}: ${detail}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        yield JSON.parse(line.slice(6)) as PipelineProgressEvent;
      } catch {
        // skip malformed chunk
      }
    }
  }
}
