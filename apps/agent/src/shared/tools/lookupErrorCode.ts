/**
 * shared/tools/lookupErrorCode.ts
 *
 * Example shared tool: map a product error code to its known cause, fix, and
 * severity. In a real system this would query an incident/runbook database;
 * here it returns canned data so the technical agent runs end to end.
 *
 * Tools are "dumb": look up and return data. No LLM calls, no business logic.
 */
import type { Tool } from "../core/types.js";

interface ErrorInfo {
  cause: string;
  fix: string;
  severity: "low" | "medium" | "high";
}

// Tiny fake runbook keyed by error code (normalized to upper-case).
const KNOWN_ERRORS: Record<string, ErrorInfo> = {
  ERR_EXPORT_TIMEOUT: {
    cause:
      "Large exports exceed the 30s synchronous limit and time out before the file is built.",
    fix: "Use the async export option (Settings > Data > Export > 'Email me the file'), which builds the export in the background.",
    severity: "medium",
  },
  ERR_AUTH_401: {
    cause: "The API key is missing, expired, or lacks the required scope.",
    fix: "Regenerate the API key under Settings > Developer and ensure the 'read' scope is enabled.",
    severity: "high",
  },
  ERR_RATE_LIMIT: {
    cause: "The account exceeded its requests-per-minute quota.",
    fix: "Back off and retry with exponential delay; request a higher quota if this is sustained.",
    severity: "low",
  },
};

export const lookupErrorCode: Tool = {
  name: "lookupErrorCode",
  description:
    "Look up a product error code. args: { errorCode }. Returns { found, cause, fix, severity }.",
  async run(args: Record<string, unknown>): Promise<unknown> {
    const code = String(args.errorCode ?? "").trim().toUpperCase();
    const info = KNOWN_ERRORS[code];
    if (!info) {
      return { found: false, errorCode: code || null };
    }
    return { found: true, errorCode: code, ...info };
  },
};
