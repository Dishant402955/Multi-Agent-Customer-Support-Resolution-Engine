import type { PipelineState } from "./types";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4100";

export async function submitTicket(message: string, ticketId?: string): Promise<PipelineState> {
  const res = await fetch(`${API}/api/tickets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, ticket_id: ticketId || undefined }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Request failed");
  return data as PipelineState;
}
