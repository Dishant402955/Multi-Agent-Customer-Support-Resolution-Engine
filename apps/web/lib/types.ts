// Mirror of the agent PipelineState (subset the UI renders).
export interface AuditEvent {
  step: string;
  actor: string;
  timestamp: string;
  summary: string;
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
}
export interface Investigation { overall_status: string; conflicts: string[]; }
export interface Severity { level: string; priority: string; reasoning: string; }
export interface Escalation {
  escalate: boolean;
  reason?: string;
  recommended_team?: string;
  urgency?: string;
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
export interface PipelineState {
  ticket_id: string;
  run_id: string;
  message: string;
  message_count: number;
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
