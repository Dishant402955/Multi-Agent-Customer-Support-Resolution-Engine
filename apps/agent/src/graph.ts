// LangGraph StateGraph wiring of the agent pipeline.
// guard → classify → sentiment → decompose → investigate → severity →
//   escalation → synthesize → END
import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import type { AuditEvent, PipelineInput, PipelineState } from "./contracts/types";
import {
  guardNode,
  classifyNode,
  sentimentNode,
  decomposeNode,
  investigateNode,
  severityNode,
  escalationNode,
  synthesizeNode,
} from "./nodes";

const StateAnnotation = Annotation.Root({
  ticket_id: Annotation<string>,
  run_id: Annotation<string>,
  message: Annotation<string>,
  message_count: Annotation<number>,
  history: Annotation<PipelineState["history"]>,
  guard: Annotation<PipelineState["guard"]>,
  classification: Annotation<PipelineState["classification"]>,
  sentiment: Annotation<PipelineState["sentiment"]>,
  sub_problems: Annotation<PipelineState["sub_problems"]>,
  agent_reports: Annotation<PipelineState["agent_reports"]>,
  investigation: Annotation<PipelineState["investigation"]>,
  severity: Annotation<PipelineState["severity"]>,
  escalation: Annotation<PipelineState["escalation"]>,
  resolution: Annotation<PipelineState["resolution"]>,
  audit_trail: Annotation<AuditEvent[]>({
    reducer: (a, b) => (a || []).concat(b || []),
    default: () => [],
  }),
});

const builder = new StateGraph(StateAnnotation)
  .addNode("guard", guardNode)
  .addNode("classify", classifyNode)
  .addNode("sentiment", sentimentNode)
  .addNode("decompose", decomposeNode)
  .addNode("investigate", investigateNode)
  .addNode("severity", severityNode)
  .addNode("escalation", escalationNode)
  .addNode("synthesize", synthesizeNode)
  .addEdge(START, "guard")
  .addEdge("guard", "classify")
  .addEdge("classify", "sentiment")
  .addEdge("sentiment", "decompose")
  .addEdge("decompose", "investigate")
  .addEdge("investigate", "severity")
  .addEdge("severity", "escalation")
  .addEdge("escalation", "synthesize")
  .addEdge("synthesize", END);

const compiled = builder.compile();

export async function runPipelineGraph(input: PipelineInput): Promise<PipelineState> {
  const result = await compiled.invoke({ ...input });
  return result as unknown as PipelineState;
}
