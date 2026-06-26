// Authenticated account (user = customer, admin = admin+developer, agent = human support agent).
export type Role = "user" | "admin" | "agent";
export interface Account {
  id: string;
  email: string;
  role: Role;
  name: string;
  customer_id: string | null;
  agent_id: string | null;
}

// Mirror of the agent PipelineState (subset the UI renders).
export interface Message {
  role: "customer" | "system" | "agent";
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
  category?: "support" | "greeting" | "out_of_scope";
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
  trace?: AgentTraceEvent[];
}
export interface AgentTraceEvent {
  traceId: string;
  ts: string;
  node: string;
  message: string;
  data?: Record<string, unknown>;
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
export interface PriorRunContext {
  run_id?: string;
  message?: string;
  resolution?: Resolution;
  agent_reports?: AgentReport[];
  investigation?: Investigation;
  severity?: Severity;
  escalation?: Escalation;
}
// Sidebar list item (server-backed).
export interface TicketSummary {
  ticket_id: string;
  display_id: string;
  title: string;
  message_count: number;
  updated_at: string;
  status: TicketLifecycleStatus;
  parent_ticket_id: string | null;
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
export type AgentLevel = "agent" | "manager";
export interface HumanAgent {
  id: string;
  name: string;
  title: string;
  department: string;
  level: AgentLevel;
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
  assignee_level?: string | null;
  handoff_note?: string | null;
  status: "open" | "resolved";
  created_at: string;
}

// In-app notification addressed to the signed-in account.
export interface NotificationRecord {
  id: string;
  account_id: string;
  kind: string;
  title: string;
  body: string | null;
  ticket_id: string | null;
  read: number;
  created_at: string;
}

// ---- Live config store (platform admin) ------------------------------------
export interface KbDoc {
  file: string;
  content: string;
  bytes: number;
}
export interface StoredUseCase {
  agent: string;
  file: string;
  def: Record<string, unknown> & {
    use_case_id: string;
    description?: string;
    example_utterances?: string[];
    enabled?: boolean;
    capabilities?: { tools?: string[]; knowledge_base?: { knowledge_file: string }[] };
  };
}
export interface HttpToolSpec {
  name: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  url_template: string;
  allowed_hosts?: string[];
  headers?: Record<string, string>;
  timeout_ms?: number;
}
export interface ToolInfo {
  name: string;
  description: string;
}
export interface HumanAgentAdmin {
  id: string;
  name: string;
  title: string;
  department: string;
  level: AgentLevel;
  email: string | null;
  counts: { open: number; resolved: number; total: number };
}
export interface ConfigAuditRecord {
  id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  target: string;
  detail: string | null;
  created_at: string;
}

export type TicketLifecycleStatus = "active" | "escalated" | "resolved";

/** Row in the tickets ops dashboard. */
export interface TicketDashboardRow {
  ticket_id: string;
  display_id: string;
  title: string;
  customer_id: string | null;
  parent_ticket_id: string | null;
  customer_name: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  run_count: number;
  status: TicketLifecycleStatus;
  primary_intent: string | null;
  severity: string | null;
  priority: string | null;
  summary: string | null;
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

/** One agent run in the observability feed (a "session"). */
export interface RunSessionRow {
  run_id: string;
  ticket_id: string;
  display_id: string;
  created_at: string;
  customer_name: string;
  message: string;
  category: string | null;
  primary_intent: string | null;
  is_multi_issue: boolean;
  sentiment: string | null;
  severity: string | null;
  priority: string | null;
  escalated: boolean;
  guard_flagged: boolean;
  overall_status: string | null;
  agent_count: number;
  step_count: number;
  llm_steps: number;
}

/** Full detail for one run — the complete pipeline state for the trace view. */
export interface RunSessionDetail {
  run_id: string;
  ticket_id: string;
  display_id: string;
  created_at: string;
  customer_name: string;
  state: PipelineState;
}

// Response for a single ticket: the latest run (details) + full chat thread.
export interface TicketDetail {
  ticket_id: string;
  display_id?: string;
  status?: TicketLifecycleStatus;
  parent_ticket_id?: string | null;
  summary?: string | null;
  run: PipelineState | null;
  /** Per-turn pipeline states (one per customer message), oldest → newest. */
  runs?: PipelineState[];
  messages: Message[];
  escalation_id?: string | null;
  escalation_status?: "open" | "resolved" | null;
  /** Name of the human agent handling an open escalation (live chat mode). */
  escalation_assignee?: string | null;
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
  display_id?: string;
  status?: TicketLifecycleStatus;
  summary?: string | null;
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
  prior_context?: PriorRunContext;
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
