// Demo "customers" you can act as, plus a tiny in-memory presence lock so two
// browser instances can't act as the same customer at the same time.
//
// Presence is intentionally in-process and TTL-based: a claim is renewed by a
// client heartbeat and auto-expires if the client goes away (closed tab, crash),
// which frees the customer for someone else. Good enough for a single-process
// demo; swap the Map for Redis if this ever runs multi-instance.

export interface User {
  id: string;
  name: string;
  plan: string;
}

/** Ids must match the mock data keys in the agent's shared tools (cust_001 …). */
export const USERS: User[] = [
  { id: "cust_001", name: "Avery Chen", plan: "Pro" },
  { id: "cust_002", name: "Jordan Patel", plan: "Starter" },
  { id: "cust_003", name: "Riley Morgan", plan: "Business" },
  { id: "cust_004", name: "Sam Okafor", plan: "Enterprise" },
  { id: "cust_005", name: "Taylor Nguyen", plan: "Pro" },
  { id: "cust_006", name: "Casey Brooks", plan: "Starter" },
  { id: "cust_007", name: "Devon Reyes", plan: "Business" },
  { id: "cust_008", name: "Morgan Ellis", plan: "Free" },
  { id: "cust_009", name: "Harper Singh", plan: "Enterprise" },
  { id: "cust_010", name: "Quinn Alvarez", plan: "Pro" },
];

/** Friendly name for a customer id (falls back to the id, or "Guest"). */
export function userName(id?: string | null): string {
  if (!id) return "Guest";
  return USERS.find((u) => u.id === id)?.name ?? id;
}

export interface UserPresence extends User {
  occupied: boolean;
  /** True when the requesting session is the one holding this customer. */
  mine: boolean;
}

const TTL_MS = 45_000;

interface Claim {
  sessionId: string;
  expiresAt: number;
}

// customerId -> active claim
const claims = new Map<string, Claim>();

function prune(): void {
  const now = Date.now();
  for (const [id, c] of claims) {
    if (c.expiresAt <= now) claims.delete(id);
  }
}

export function listUsers(sessionId?: string): UserPresence[] {
  prune();
  return USERS.map((u) => {
    const c = claims.get(u.id);
    return {
      ...u,
      occupied: !!c,
      mine: !!c && c.sessionId === sessionId,
    };
  });
}

export interface ClaimResult {
  ok: boolean;
  reason?: "unknown_user" | "occupied";
}

/**
 * Claim a customer for a session. Idempotent — calling again with the same
 * session renews the lease (this is also the heartbeat). One identity per
 * session: claiming a new customer releases any other the session held.
 */
export function claimUser(userId: string, sessionId: string): ClaimResult {
  prune();
  if (!USERS.some((u) => u.id === userId)) return { ok: false, reason: "unknown_user" };
  const existing = claims.get(userId);
  if (existing && existing.sessionId !== sessionId) return { ok: false, reason: "occupied" };

  for (const [id, c] of claims) {
    if (c.sessionId === sessionId && id !== userId) claims.delete(id);
  }
  claims.set(userId, { sessionId, expiresAt: Date.now() + TTL_MS });
  return { ok: true };
}

export function releaseUser(userId: string, sessionId: string): void {
  const c = claims.get(userId);
  if (c && c.sessionId === sessionId) claims.delete(userId);
}

/** Release whatever this session holds (used on disconnect). */
export function releaseSession(sessionId: string): void {
  for (const [id, c] of claims) {
    if (c.sessionId === sessionId) claims.delete(id);
  }
}
