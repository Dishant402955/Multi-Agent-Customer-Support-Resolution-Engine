import type {
  EscalationRecord,
  HumanAgent,
  PipelineProgressEvent,
  TicketDashboardDetail,
  TicketDashboardRow,
  TicketDetail,
  TicketSummary,
  UserPresence,
} from "./types";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4100";

/** Create a ticket or add a follow-up with live pipeline progress (SSE). */
export async function submitTicketStream(
  message: string,
  onProgress: (evt: PipelineProgressEvent) => void,
  ticketId?: string,
  customerId?: string
): Promise<TicketDetail> {
  const res = await fetch(`${API}/api/tickets/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      ticket_id: ticketId || undefined,
      customer_id: customerId || undefined,
    }),
  });

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || "Request failed");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: TicketDetail | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const evt = JSON.parse(line.slice(6)) as PipelineProgressEvent;
      onProgress(evt);
      if (evt.type === "complete" && evt.ticket_id) {
        result = {
          ticket_id: evt.ticket_id,
          run: evt.run ?? null,
          messages: evt.messages ?? [],
          escalation_id: evt.escalation_id,
        };
      }
      if (evt.type === "error") throw new Error(evt.message || "Pipeline failed");
    }
  }

  if (!result) throw new Error("Pipeline finished without a result");
  return result;
}

/** Create a ticket or add a follow-up, then run the pipeline (non-streaming fallback). */
export async function submitTicket(
  message: string,
  ticketId?: string,
  customerId?: string
): Promise<TicketDetail> {
  const res = await fetch(`${API}/api/tickets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      ticket_id: ticketId || undefined,
      customer_id: customerId || undefined,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Request failed");
  return data as TicketDetail;
}

/** Latest run + full message thread for one ticket (used to reopen a chat). */
export async function getTicket(ticketId: string, customerId?: string): Promise<TicketDetail | null> {
  try {
    const qs = customerId ? `?customer=${encodeURIComponent(customerId)}` : "";
    const res = await fetch(`${API}/api/tickets/${encodeURIComponent(ticketId)}${qs}`);
    if (!res.ok) return null;
    return (await res.json()) as TicketDetail;
  } catch {
    return null;
  }
}

/** Tickets for the sidebar, scoped to the selected customer (or guest). */
export async function listTickets(customerId?: string): Promise<TicketSummary[]> {
  try {
    const qs = customerId ? `?customer=${encodeURIComponent(customerId)}` : "";
    const res = await fetch(`${API}/api/tickets${qs}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { tickets: TicketSummary[] };
    return data.tickets ?? [];
  } catch {
    return [];
  }
}

/** Permanently delete a ticket and its history. */
export async function deleteTicket(ticketId: string, customerId?: string): Promise<void> {
  try {
    const qs = customerId ? `?customer=${encodeURIComponent(customerId)}` : "";
    await fetch(`${API}/api/tickets/${encodeURIComponent(ticketId)}${qs}`, { method: "DELETE" });
  } catch {
    // best-effort; the list refresh will reflect server truth
  }
}

// ---- Identity / presence ---------------------------------------------------

/** Customers you can act as, with live occupancy for this session. */
export async function listUsers(sessionId: string): Promise<UserPresence[]> {
  try {
    const res = await fetch(`${API}/api/users?session=${encodeURIComponent(sessionId)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { users: UserPresence[] };
    return data.users ?? [];
  } catch {
    return [];
  }
}

/** Claim (or renew) a customer for this session. Returns the fresh roster. */
export async function claimUser(
  userId: string,
  sessionId: string
): Promise<{ ok: boolean; reason?: string; users: UserPresence[] }> {
  try {
    const res = await fetch(`${API}/api/users/${encodeURIComponent(userId)}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: sessionId }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, reason: data?.error, users: data?.users ?? [] };
  } catch {
    return { ok: false, reason: "network", users: [] };
  }
}

/** Release a customer this session holds (best-effort). */
export async function releaseUser(userId: string, sessionId: string): Promise<void> {
  try {
    await fetch(`${API}/api/users/${encodeURIComponent(userId)}/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: sessionId }),
      keepalive: true,
    });
  } catch {
    // best-effort; the TTL lock frees it anyway
  }
}

// ---- Escalation dashboard --------------------------------------------------

export async function listEscalations(): Promise<{
  escalations: EscalationRecord[];
  agents: HumanAgent[];
}> {
  try {
    const res = await fetch(`${API}/api/escalations`);
    if (!res.ok) return { escalations: [], agents: [] };
    return (await res.json()) as { escalations: EscalationRecord[]; agents: HumanAgent[] };
  } catch {
    return { escalations: [], agents: [] };
  }
}

export async function resolveEscalation(id: string): Promise<void> {
  try {
    await fetch(`${API}/api/escalations/${encodeURIComponent(id)}/resolve`, { method: "POST" });
  } catch {
    // best-effort; the list refresh will reflect server truth
  }
}

// ---- Tickets dashboard -----------------------------------------------------

export async function listDashboardTickets(): Promise<TicketDashboardRow[]> {
  try {
    const res = await fetch(`${API}/api/dashboard/tickets`);
    if (!res.ok) return [];
    const data = (await res.json()) as { tickets: TicketDashboardRow[] };
    return data.tickets ?? [];
  } catch {
    return [];
  }
}

export async function getDashboardTicket(ticketId: string): Promise<TicketDashboardDetail | null> {
  try {
    const res = await fetch(`${API}/api/dashboard/tickets/${encodeURIComponent(ticketId)}`);
    if (!res.ok) return null;
    return (await res.json()) as TicketDashboardDetail;
  } catch {
    return null;
  }
}
