/**
 * shared/tools/paymentStatus.ts
 *
 * Example shared tool: return the status of a customer's most recent payment.
 * Mocked here; a real system would query the payments/billing provider.
 */
import type { Tool } from "../core/types.js";

interface PaymentRecord {
  method: string;
  lastPayment: {
    amount: number;
    status: "succeeded" | "failed" | "pending";
    declineReason?: string;
  };
}

const MOCK_PAYMENTS: Record<string, PaymentRecord> = {
  cust_001: {
    method: "Visa ****4242",
    lastPayment: { amount: 49, status: "succeeded" },
  },
  cust_002: {
    method: "Mastercard ****1881",
    lastPayment: { amount: 12, status: "failed", declineReason: "insufficient_funds" },
  },
};

export const paymentStatus: Tool = {
  name: "paymentStatus",
  description:
    "Look up a customer's most recent payment status. args: { customerId }. Returns { found, method, lastPayment }.",
  async run(args: Record<string, unknown>): Promise<unknown> {
    const customerId = String(args.customerId ?? "");
    const rec = MOCK_PAYMENTS[customerId];
    if (!rec) return { found: false, customerId: customerId || null };
    return { found: true, customerId, ...rec };
  },
};
