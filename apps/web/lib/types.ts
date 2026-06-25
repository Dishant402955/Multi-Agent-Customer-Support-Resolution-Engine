// Mirror of the agent PipelineState (subset the UI renders).
export interface Message {
  role: "customer" | "system";
  text: string;
  timestamp?: string;
}
export type StepKind = "llm" | "heuristic";
export interface AuditEvent {
  step: string;
  actor: string;
  timestamp: string;
  summary: string;
  kind?: StepKind;
  detail?: string;
}
export interface IntentScore { type: string; confidence: number; }
export interface Classification {
  primary_intent: string;
  is_multi_issue: boolean;
  fallback: boolean;
  intents: IntentScore[];
}
export interface Sentiment { label: string; score: number; }
export interface SubProblem { id: string; domain: string; description: string; }
export interface AgentReport {
  agent: string;
  sub_problem_id: string;
  findings: string[];
  actions: string[];
  reasoning: string;
  evidence: string[];
  status: string;
  confidence: number;
  duration_ms?: number;
  clarification_needed?: boolean;
  clarification_question?: string;
}
export interface Investigation { overall_status: string; conflicts: string[]; }
export interface Severity { level: string; priority: string; reasoning: string; }
export interface AssignedAgent {
  id: string;
  name: string;
  title: string;
  department: string;
}
export interface Escalation {
  escalate: boolean;
  reason?: string;
  recommended_team?: string;
  urgency?: string;
  internal_actions?: string[];
  customer_addendum?: string;
  assigned_agent?: AssignedAgent;
  escalation_id?: string;
}
export interface Resolution {
  summary: string;
  findings: string[];
  actions: string[];
  reasoning: string;
  evidence: string[];
}
// Sidebar list item (server-backed).
export interface TicketSummary {
  ticket_id: string;
  title: string;
  message_count: number;
  updated_at: string;
}

// A customer you can act as, with live presence info.
export interface UserPresence {
  id: string;
  name: string;
  plan: string;
  occupied: boolean;
  mine: boolean;
}

// Human support agent + a persisted escalation case (for the dashboard).
export interface HumanAgent {
  id: string;
  name: string;
  title: string;
  department: string;
}
export interface EscalationRecord {
  id: string;
  ticket_id: string;
  customer_id: string | null;
  customer_name: string;
  subject: string;
  department: string;
  team: string | null;
  urgency: string | null;
  reason: string | null;
  assignee_id: string;
  assignee_name: string;
  assignee_title: string;
  status: "open" | "resolved";
  created_at: string;
}

export type TicketLifecycleStatus = "active" | "escalated" | "resolved";

/** Row in the tickets ops dashboard. */
export interface TicketDashboardRow {
  ticket_id: string;
  title: string;
  customer_id: string | null;
  customer_name: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  run_count: number;
  status: TicketLifecycleStatus;
  primary_intent: string | null;
  severity: string | null;
  priority: string | null;
  escalation_id: string | null;
  escalation_status: "open" | "resolved" | null;
}

/** One persisted pipeline run — includes the full audit trace. */
export interface TicketRunRecord {
  run_id: string;
  created_at: string;
  message: string;
  message_count: number;
  primary_intent: string | null;
  severity: string | null;
  priority: string | null;
  escalated: boolean;
  audit_trail: AuditEvent[];
  agent_reports: AgentReport[];
  state: PipelineState;
}

export interface TicketDashboardDetail {
  ticket: TicketDashboardRow;
  messages: Message[];
  runs: TicketRunRecord[];
  escalation: EscalationRecord | null;
}

// Response for a single ticket: the latest run (details) + full chat thread.
export interface TicketDetail {
  ticket_id: string;
  run: PipelineState | null;
  messages: Message[];
  escalation_id?: string | null;
  escalation_status?: "open" | "resolved" | null;
}

export type PipelineStepId =
  | "guard"
  | "classify"
  | "sentiment"
  | "decompose"
  | "investigate"
  | "severity"
  | "escalation"
  | "synthesize";

export interface PipelineProgressEvent {
  type: "step_start" | "step_done" | "agent_done" | "done" | "error" | "complete";
  step?: PipelineStepId;
  audit?: AuditEvent[];
  agent?: string;
  message?: string;
  snapshot?: Partial<PipelineState>;
  state?: PipelineState;
  ticket_id?: string;
  run?: PipelineState;
  messages?: Message[];
  escalation_id?: string | null;
}

/** Live pipeline progress while a run is in flight (driven by SSE, not timers). */
export interface RunProgress {
  activeStep: PipelineStepId | null;
  completedSteps: PipelineStepId[];
  liveAudit: AuditEvent[];
  agentsDone: string[];
  snapshot: Partial<PipelineState>;
}

export interface PipelineState {
  ticket_id: string;
  run_id: string;
  message: string;
  message_count: number;
  history?: Message[];
  guard?: { force_escalation: boolean; reason: string | null; matched_phrase: string | null };
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
