/**
 * shared/tools/subscriptionLookup.ts
 *
 * Example shared tool: return a customer's current subscription. Mocked here;
 * in a real system this would query the subscriptions table. Same "dumb tool"
 * pattern as dbQuery — fetch and return data, no business logic.
 */
import type { Tool } from "../core/types.js";

interface Subscription {
  plan: string;
  seats: number;
  status: "active" | "past_due" | "canceled";
  renewsOn: string;
}

const MOCK_SUBSCRIPTIONS: Record<string, Subscription> = {
  cust_001: { plan: "Pro", seats: 5, status: "active", renewsOn: "2026-07-01" },
  cust_002: { plan: "Starter", seats: 1, status: "past_due", renewsOn: "2026-06-30" },
};

export const subscriptionLookup: Tool = {
  name: "subscriptionLookup",
  description:
    "Look up a customer's current subscription. args: { customerId }. Returns { found, plan, seats, status, renewsOn }.",
  async run(args: Record<string, unknown>): Promise<unknown> {
    const customerId = String(args.customerId ?? "");
    const sub = MOCK_SUBSCRIPTIONS[customerId];
    if (!sub) return { found: false, customerId: customerId || null };
    return { found: true, customerId, ...sub };
  },
};
