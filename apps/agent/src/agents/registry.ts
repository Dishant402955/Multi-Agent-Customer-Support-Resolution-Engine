// Agent registry. Adding a new specialist = implement SpecialistAgent + add
// one line here. The orchestrator only knows domains, never concrete agents.
import type { AgentDomain } from "../contracts/types";
import type { SpecialistAgent } from "./base";
import { billingAgent } from "./billing";
import { policyAgent } from "./policy";
import { technicalAgent } from "./technical";

export const AGENT_REGISTRY: Record<AgentDomain, SpecialistAgent> = {
  technical: technicalAgent,
  billing: billingAgent,
  policy: policyAgent,
};

export function getAgent(domain: AgentDomain): SpecialistAgent {
  return AGENT_REGISTRY[domain] ?? policyAgent; // policy is the safe default
}
