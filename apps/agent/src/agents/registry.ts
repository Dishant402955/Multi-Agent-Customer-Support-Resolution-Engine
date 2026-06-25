// Agent registry. Maps a pipeline domain to its LLM-backed specialist agent
// (wrapped by adapter.ts). The orchestrator only knows domains, never the
// concrete framework agents.
import type { AgentDomain } from "../contracts/types";
import type { SpecialistAgent } from "./base";
import { adaptAgent } from "./adapter";
import { billingAgent } from "./billing/index";
import { policyAgent } from "./policy/index";
import { technicalAgent } from "./technical/index";

export const AGENT_REGISTRY: Record<AgentDomain, SpecialistAgent> = {
  technical: adaptAgent("technical", technicalAgent),
  billing: adaptAgent("billing", billingAgent),
  policy: adaptAgent("policy", policyAgent),
};

export function getAgent(domain: AgentDomain): SpecialistAgent {
  return AGENT_REGISTRY[domain] ?? AGENT_REGISTRY.policy; // policy is the safe default
}
