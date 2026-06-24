// Shared pipeline contracts. One object flows through the pipeline and each
// step adds its own fields.

export type IntentType = "technical" | "billing" | "policy" | "mixed" | "unknown";
export type AgentDomain = "technical" | "billing" | "policy";
export type SentimentLabel = "neutral" | "frustrated" | "angry";
export type AgentStatus = "resolved" | "needs_info" | "unresolved" | "failed";
export type SeverityLevel = "low" | "medium" | "high";
export type PriorityLevel = "P3" | "P2" | "P1";

export interface Message {
  role: "customer" | "system";
  text: string;
  timestamp: string;
}

export interface Guard {
  force_escalation: boolean;
  reason: string | null;
  matched_phrase: string | null;
}

export interface IntentScore {
  type: IntentType;
  confidence: number;
}

export interface Classification {
  primary_intent: IntentType;
  is_multi_issue: boolean;
  fallback: boolean;
  intents: IntentScore[];
}

export interface Sentiment {
  label: SentimentLabel;
  score: number;
}

export interface SubProblem {
  id: string;
  domain: AgentDomain;
  description: string;
}

export interface AgentReport {
  agent: AgentDomain;
  sub_problem_id: string;
  findings: string[];
  actions: string[];
  reasoning: string;
  evidence: string[];
  status: AgentStatus;
  confidence: number;

  // Set when the agent matched its domain but was not confident enough to act
  // and needs more detail from the customer (framework status
  // "needs_clarification"). Distinct from a generic `needs_info`: this carries a
  // specific question to put back to the customer. Optional + additive so the
  // status contract and all downstream steps are unchanged.
  clarification_needed?: boolean;
  clarification_question?: string;
}

export interface Investigation {
  overall_status: "resolved" | "partial" | "unresolved";
  conflicts: string[];
}

export interface Severity {
  level: SeverityLevel;
  priority: PriorityLevel;
  reasoning: string;
}

export interface Escalation {
  escalate: boolean;
  reason?: string;
  recommended_team?: string;
  urgency?: PriorityLevel;
  internal_actions?: string[];
  customer_addendum?: string;
}

export interface Resolution {
  summary: string;
  findings: string[];
  actions: string[];
  reasoning: string;
  evidence: string[];
}

export interface AuditEvent {
  step: string;
  actor: string;
  timestamp: string;
  summary: string;
}

// The full object that grows as it moves through the pipeline.
export interface PipelineState {
  ticket_id: string;
  run_id: string;
  message: string;
  message_count: number;
  history: Message[];

  guard?: Guard;
  classification?: Classification;
  sentiment?: Sentiment;
  sub_problems?: SubProblem[];
  agent_reports?: AgentReport[];
  investigation?: Investigation;
  severity?: Severity;
  escalation?: Escalation;
  resolution?: Resolution;

  audit_trail: AuditEvent[];
}

export interface PipelineInput {
  ticket_id: string;
  run_id: string;
  message: string;
  message_count: number;
  history: Message[];
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function audit(step: string, actor: string, summary: string): AuditEvent {
  return { step, actor, timestamp: nowIso(), summary };
}
