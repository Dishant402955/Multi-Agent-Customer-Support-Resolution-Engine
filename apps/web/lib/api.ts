import type {
  Account,
  ConfigAuditRecord,
  EscalationRecord,
  HttpToolSpec,
  HumanAgent,
  HumanAgentAdmin,
  KbDoc,
  Message,
  NotificationRecord,
  PipelineProgressEvent,
  RunSessionDetail,
  RunSessionRow,
  StoredUseCase,
  TicketDashboardDetail,
  TicketDashboardRow,
  TicketDetail,
  TicketSummary,
  ToolInfo,
} from "./types";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4100";

// ---- Token storage ---------------------------------------------------------
// Opaque session token kept in localStorage and attached as a Bearer header.
const TOKEN_KEY = "se_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  if (typeof window !== "undefined") localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  if (typeof window !== "undefined") localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

// ---- Auth ------------------------------------------------------------------

export async function apiLogin(
  email: string,
  password: string
): Promise<{ ok: boolean; error?: string; token?: string; account?: Account }> {
  try {
    const res = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Login failed" };
    return { ok: true, token: data.token, account: data.account };
  } catch {
    return { ok: false, error: "Network error — is the API running?" };
  }
}

export async function apiSignup(
  name: string,
  email: string,
  password: string
): Promise<{ ok: boolean; error?: string; token?: string; account?: Account }> {
  try {
    const res = await fetch(`${API}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || "Sign up failed" };
    return { ok: true, token: data.token, account: data.account };
  } catch {
    return { ok: false, error: "Network error — is the API running?" };
  }
}

export async function apiLogout(): Promise<void> {
  try {
    await fetch(`${API}/api/auth/logout`, { method: "POST", headers: authHeaders() });
  } catch {
    // best-effort
  }
}

export async function getMe(): Promise<Account | null> {
  try {
    const res = await fetch(`${API}/api/auth/me`, { headers: authHeaders() });
    if (!res.ok) return null;
    const data = (await res.json()) as { account: Account };
    return data.account ?? null;
  } catch {
    return null;
  }
}

// ---- Tickets (customer-facing) ---------------------------------------------

/** Create a ticket or add a follow-up with live pipeline progress (SSE). */
export async function submitTicketStream(
  message: string,
  onProgress: (evt: PipelineProgressEvent) => void,
  ticketId?: string,
  linkTo?: string
): Promise<TicketDetail> {
  const res = await fetch(`${API}/api/tickets/stream`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      message,
      ticket_id: ticketId || undefined,
      link_to: linkTo || undefined,
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
      // `complete` always carries the result. Note: greeting / out-of-scope
      // replies are ephemeral and intentionally have an empty ticket_id, so we
      // must NOT gate on ticket_id here or those replies would be dropped.
      if (evt.type === "complete") {
        result = {
          ticket_id: evt.ticket_id ?? "",
          display_id: evt.display_id,
          status: evt.status,
          summary: evt.summary,
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
  linkTo?: string
): Promise<TicketDetail> {
  const res = await fetch(`${API}/api/tickets`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      message,
      ticket_id: ticketId || undefined,
      link_to: linkTo || undefined,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Request failed");
  return data as TicketDetail;
}

/** Latest run + full message thread for one ticket (used to reopen a chat). */
export async function getTicket(ticketId: string): Promise<TicketDetail | null> {
  try {
    const res = await fetch(`${API}/api/tickets/${encodeURIComponent(ticketId)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as TicketDetail;
  } catch {
    return null;
  }
}

/**
 * Customer posts a message into an open escalation (live human chat). Returns
 * the refreshed thread, or `{ needsPipeline: true }` when there's no open
 * escalation so the caller can fall back to the AI pipeline.
 */
export async function postCustomerMessage(
  ticketId: string,
  text: string
): Promise<{ messages?: Message[]; needsPipeline?: boolean; error?: string }> {
  try {
    const res = await fetch(`${API}/api/tickets/${encodeURIComponent(ticketId)}/messages`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 || data?.error === "no_open_escalation") {
      return { needsPipeline: true };
    }
    if (!res.ok) return { error: data?.error || "Could not send message" };
    return { messages: (data?.messages ?? []) as Message[] };
  } catch {
    return { error: "Network error" };
  }
}

/** Tickets for the sidebar, scoped to the signed-in customer. */
export async function listTickets(): Promise<TicketSummary[]> {
  try {
    const res = await fetch(`${API}/api/tickets`, { headers: authHeaders() });
    if (!res.ok) return [];
    const data = (await res.json()) as { tickets: TicketSummary[] };
    return data.tickets ?? [];
  } catch {
    return [];
  }
}

/** Permanently delete a ticket and its history. */
export async function deleteTicket(ticketId: string): Promise<void> {
  try {
    await fetch(`${API}/api/tickets/${encodeURIComponent(ticketId)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
  } catch {
    // best-effort; the list refresh will reflect server truth
  }
}

// ---- Escalation dashboard --------------------------------------------------

export async function listEscalations(): Promise<{
  escalations: EscalationRecord[];
  agents: HumanAgent[];
}> {
  try {
    const res = await fetch(`${API}/api/escalations`, { headers: authHeaders() });
    if (!res.ok) return { escalations: [], agents: [] };
    return (await res.json()) as { escalations: EscalationRecord[]; agents: HumanAgent[] };
  } catch {
    return { escalations: [], agents: [] };
  }
}

/** The assigned human agent replies to the customer on an open case. */
export async function postAgentReply(
  escalationId: string,
  text: string
): Promise<{ messages?: Message[]; error?: string }> {
  try {
    const res = await fetch(`${API}/api/escalations/${encodeURIComponent(escalationId)}/reply`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.error || "Could not send reply" };
    return { messages: (data?.messages ?? []) as Message[] };
  } catch {
    return { error: "Network error" };
  }
}

export async function resolveEscalation(id: string): Promise<void> {
  try {
    await fetch(`${API}/api/escalations/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      headers: authHeaders(),
    });
  } catch {
    // best-effort; the list refresh will reflect server truth
  }
}

// Hand a case up to the department manager, with an optional short note.
export async function handoffEscalation(id: string, note: string): Promise<{ error?: string }> {
  try {
    const res = await fetch(`${API}/api/escalations/${encodeURIComponent(id)}/handoff`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    if (!res.ok) return { error: ((await res.json().catch(() => ({}))) as any)?.error || "Handoff failed" };
    return {};
  } catch {
    return { error: "Network error" };
  }
}

// ---- Notifications ---------------------------------------------------------

export async function getNotifications(): Promise<{
  notifications: NotificationRecord[];
  unread: number;
}> {
  try {
    const res = await fetch(`${API}/api/notifications`, { headers: authHeaders() });
    if (!res.ok) return { notifications: [], unread: 0 };
    return (await res.json()) as { notifications: NotificationRecord[]; unread: number };
  } catch {
    return { notifications: [], unread: 0 };
  }
}

export async function markNotificationRead(id: string): Promise<void> {
  try {
    await fetch(`${API}/api/notifications/${encodeURIComponent(id)}/read`, {
      method: "POST",
      headers: authHeaders(),
    });
  } catch {
    // best-effort
  }
}

export async function markAllNotificationsRead(): Promise<void> {
  try {
    await fetch(`${API}/api/notifications/read-all`, { method: "POST", headers: authHeaders() });
  } catch {
    // best-effort
  }
}

// ---- Tickets dashboard -----------------------------------------------------

export async function listDashboardTickets(): Promise<TicketDashboardRow[]> {
  try {
    const res = await fetch(`${API}/api/dashboard/tickets`, { headers: authHeaders() });
    if (!res.ok) return [];
    const data = (await res.json()) as { tickets: TicketDashboardRow[] };
    return data.tickets ?? [];
  } catch {
    return [];
  }
}

export async function getDashboardTicket(ticketId: string): Promise<TicketDashboardDetail | null> {
  try {
    const res = await fetch(`${API}/api/dashboard/tickets/${encodeURIComponent(ticketId)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as TicketDashboardDetail;
  } catch {
    return null;
  }
}

// ---- Observability: agent run sessions -------------------------------------

export async function listRunSessions(): Promise<RunSessionRow[]> {
  try {
    const res = await fetch(`${API}/api/observability/runs`, { headers: authHeaders() });
    if (!res.ok) return [];
    const data = (await res.json()) as { runs: RunSessionRow[] };
    return data.runs ?? [];
  } catch {
    return [];
  }
}

export async function getRunSession(runId: string): Promise<RunSessionDetail | null> {
  try {
    const res = await fetch(`${API}/api/observability/runs/${encodeURIComponent(runId)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as RunSessionDetail;
  } catch {
    return null;
  }
}

// ---- Platform: live config store (admin) -----------------------------------

async function pf(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}/api/platform${path}`, {
    method,
    headers: authHeaders(body === undefined ? {} : { "Content-Type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Request failed");
  return data;
}

export const platform = {
  listKb: () => pf("GET", "/kb") as Promise<{ docs: KbDoc[] }>,
  putKb: (file: string, content: string) => pf("PUT", `/kb/${encodeURIComponent(file)}`, { content }),
  deleteKb: (file: string) => pf("DELETE", `/kb/${encodeURIComponent(file)}`),

  listUseCases: () =>
    pf("GET", "/usecases") as Promise<{ agents: string[]; usecases: StoredUseCase[] }>,
  putUseCase: (agent: string, def: unknown) => pf("PUT", `/usecases/${encodeURIComponent(agent)}`, def),
  deleteUseCase: (agent: string, id: string) =>
    pf("DELETE", `/usecases/${encodeURIComponent(agent)}/${encodeURIComponent(id)}`),

  listTools: () =>
    pf("GET", "/tools") as Promise<{ builtins: ToolInfo[]; declarative: HttpToolSpec[] }>,
  putTool: (name: string, spec: unknown) => pf("PUT", `/tools/${encodeURIComponent(name)}`, spec),
  deleteTool: (name: string) => pf("DELETE", `/tools/${encodeURIComponent(name)}`),

  listAudit: () => pf("GET", "/audit") as Promise<{ audit: ConfigAuditRecord[] }>,
};

// ---- Admin: human-agent management -----------------------------------------

async function adm(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}/api/admin${path}`, {
    method,
    headers: authHeaders(body === undefined ? {} : { "Content-Type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Request failed");
  return data;
}

export const adminAgents = {
  list: () => adm("GET", "/agents") as Promise<{ agents: HumanAgentAdmin[]; departments: string[] }>,
  create: (body: {
    name: string;
    title: string;
    department: string;
    email: string;
    password?: string;
    level?: "agent" | "manager";
  }) => adm("POST", "/agents", body),
};
