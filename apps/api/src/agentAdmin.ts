// Thin client for the agent service's live config-store (/admin/*). The browser
// never talks to the agent directly; the API proxies here with the shared
// secret so all config changes flow through one authenticated, audited path.
import { ENV } from "./env";

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${ENV.AGENT_URL}/admin${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": ENV.AGENT_ADMIN_TOKEN,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `agent admin ${method} ${path} failed (${res.status})`);
  return data;
}

export const agentAdmin = {
  // KB
  listKb: () => call("GET", "/kb"),
  putKb: (file: string, content: string) =>
    call("PUT", `/kb/${encodeURIComponent(file)}`, { content }),
  deleteKb: (file: string) => call("DELETE", `/kb/${encodeURIComponent(file)}`),
  // Use cases
  listUseCases: () => call("GET", "/usecases"),
  putUseCase: (agent: string, def: unknown) =>
    call("PUT", `/usecases/${encodeURIComponent(agent)}`, def),
  deleteUseCase: (agent: string, id: string) =>
    call("DELETE", `/usecases/${encodeURIComponent(agent)}/${encodeURIComponent(id)}`),
  // Tools
  listTools: () => call("GET", "/tools"),
  putTool: (name: string, spec: unknown) =>
    call("PUT", `/tools/${encodeURIComponent(name)}`, spec),
  deleteTool: (name: string) => call("DELETE", `/tools/${encodeURIComponent(name)}`),
};
