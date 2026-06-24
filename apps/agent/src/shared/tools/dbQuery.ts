/**
 * shared/tools/dbQuery.ts
 *
 * Example shared tool: a mock data lookup. In a real system this would query
 * SQLite/Postgres; here it returns canned data so the pipeline runs end to end.
 * Billing, policy, and technical use cases could all use it (scoped per use case).
 *
 * Stage 3 replaces the mock body with a real SQL query; the signature stays.
 */
import type { Tool } from "../core/types.js";

// Tiny fake table of charges keyed by customerId.
const MOCK_CHARGES: Record<string, Array<{ id: string; amount: number; desc: string }>> = {
  cust_001: [
    { id: "txn_1", amount: 49, desc: "Pro plan monthly" },
    { id: "txn_2", amount: 49, desc: "Pro plan monthly (duplicate)" },
  ],
  cust_002: [{ id: "txn_9", amount: 12, desc: "Add-on: extra seats" }],
};

export const dbQuery: Tool = {
  name: "dbQuery",
  description:
    "Look up billing records for a customer. args: { customerId }. Returns { charges }.",
  async run(args: Record<string, unknown>): Promise<unknown> {
    const customerId = String(args.customerId ?? "");
    return { charges: MOCK_CHARGES[customerId] ?? [] };
  },
};
