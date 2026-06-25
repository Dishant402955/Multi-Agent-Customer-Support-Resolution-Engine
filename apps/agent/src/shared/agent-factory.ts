/**
 * shared/agent-factory.ts
 *
 * createAgent() mints ONE isolated agent: its own Registry, loaded with its own
 * use cases, with a handle() closed over that registry. The shared, stateless
 * machinery (gateway, tool pool, KB, graph, logger) is NOT copied — every agent
 * uses the same instances. That combination (isolated state + shared stateless
 * machinery) is exactly what makes agents safe to run in parallel:
 *
 *   const billing = createAgent({ name: "billing", useCasesDir: ".../billing/usecases" });
 *   const policy  = createAgent({ name: "policy",  useCasesDir: ".../policy/usecases" });
 *   const [a, b]  = await Promise.all([billing.handle(t1), policy.handle(t2)]);
 *
 * To make a new agent: one createAgent call + a usecases/ folder. Nothing else.
 */
import type { AgentReport, Ticket } from "./core/types.js";
import { Registry } from "./core/registry.js";
import { registerAllTools } from "./tools/index.js";
import { loadUseCasesFrom } from "./handlers/loader.js";
import { runAgent } from "./core/agent.js";
import { log } from "./core/logger.js";

export interface AgentConfig {
  /** Agent name, e.g. "billing", "policy", "technical". */
  name: string;
  /** Absolute path to this agent's usecases/ directory. */
  useCasesDir: string;
}

export interface Agent {
  name: string;
  useCaseIds: string[];
  handle: (ticket: Ticket) => Promise<AgentReport>;
}

export function createAgent(cfg: AgentConfig): Agent {
  // Shared tools register into the central pool (idempotent across agents).
  registerAllTools();

  // THIS agent's own isolated registry.
  const registry = new Registry();
  const useCaseIds = loadUseCasesFrom(registry, cfg.useCasesDir);

  log("boot", "agent-factory", `agent "${cfg.name}" ready`, {
    useCaseIds,
    registrySize: registry.size,
  });

  return {
    name: cfg.name,
    useCaseIds,
    // handle() is closed over THIS agent's registry + name.
    handle: (ticket: Ticket) => runAgent(registry, cfg.name, ticket),
  };
}
