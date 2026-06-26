// Notification fan-out: writes an in-app notification and (optionally) emails
// the recipient via Resend. Email is best-effort and never blocks the request —
// if RESEND_API_KEY is unset or the call fails, we just log and move on.
import { ENV } from "./env";
import { createNotification, getTicketDisplayId } from "./db";
import { getAccountByCustomerId } from "./auth";

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!ENV.RESEND_API_KEY) {
    console.log(`[notify] email skipped (no RESEND_API_KEY) -> ${to}: ${subject}`);
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ENV.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: ENV.RESEND_FROM, to, subject, html }),
    });
    if (!res.ok) {
      console.warn(`[notify] resend failed ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    console.warn("[notify] resend error", err);
  }
}

/**
 * Tell the customer who owns a ticket that their escalated case was resolved.
 * Creates an in-app notification and fires an email (if configured).
 */
export async function notifyTicketResolved(
  customerId: string,
  ticketId: string,
  subject: string
): Promise<void> {
  const account = getAccountByCustomerId(customerId);
  if (!account) return;

  const displayId = getTicketDisplayId(ticketId);
  const title = `${displayId} resolved`;
  const body = `Your case "${subject || displayId}" has been resolved by our support team.`;

  createNotification({
    account_id: account.id,
    kind: "ticket_resolved",
    title,
    body,
    ticket_id: ticketId,
  });

  void sendEmail(
    account.email,
    `[Support] ${title}`,
    `<div style="font-family:system-ui,sans-serif;line-height:1.5">
       <h2 style="margin:0 0 8px">${title}</h2>
       <p>${body}</p>
       <p style="color:#666;font-size:13px">Reference: ${displayId}</p>
     </div>`
  );
}
