// The human support org: ~18 agents across departments. Escalations are routed
// to a department and assigned to the least-loaded agent in it, so the
// escalation dashboard shows a realistic, balanced workload.

export type Department =
  | "Billing"
  | "Technical"
  | "Policy & Compliance"
  | "Trust & Safety"
  | "Escalations";

export interface HumanAgent {
  id: string;
  name: string;
  title: string;
  department: Department;
}

export const HUMAN_AGENTS: HumanAgent[] = [
  // Billing
  { id: "ha_01", name: "Maya Fernandez", title: "Billing Specialist", department: "Billing" },
  { id: "ha_02", name: "Tom Becker", title: "Billing Specialist", department: "Billing" },
  { id: "ha_03", name: "Priya Nair", title: "Senior Billing Analyst", department: "Billing" },
  { id: "ha_04", name: "Liam Walsh", title: "Billing Lead", department: "Billing" },

  // Technical
  { id: "ha_05", name: "Sofia Rossi", title: "Support Engineer", department: "Technical" },
  { id: "ha_06", name: "Daniel Kim", title: "Support Engineer", department: "Technical" },
  { id: "ha_07", name: "Aisha Bello", title: "Senior Support Engineer", department: "Technical" },
  { id: "ha_08", name: "Marcus Webb", title: "Engineering On-call", department: "Technical" },
  { id: "ha_09", name: "Elena Petrova", title: "Engineering Lead", department: "Technical" },

  // Policy & Compliance
  { id: "ha_10", name: "Grace Adeyemi", title: "Policy Specialist", department: "Policy & Compliance" },
  { id: "ha_11", name: "Noah Schmidt", title: "Compliance Analyst", department: "Policy & Compliance" },
  { id: "ha_12", name: "Hana Suzuki", title: "Policy Lead", department: "Policy & Compliance" },

  // Trust & Safety
  { id: "ha_13", name: "Omar Haddad", title: "Trust & Safety Agent", department: "Trust & Safety" },
  { id: "ha_14", name: "Bianca Costa", title: "Trust & Safety Agent", department: "Trust & Safety" },
  { id: "ha_15", name: "Victor Ngata", title: "Trust & Safety Lead", department: "Trust & Safety" },

  // Escalations (Tier-2)
  { id: "ha_16", name: "Lena Hoffman", title: "Escalation Manager", department: "Escalations" },
  { id: "ha_17", name: "Raj Malhotra", title: "Tier-2 Specialist", department: "Escalations" },
  { id: "ha_18", name: "Chloe Dubois", title: "Tier-2 Specialist", department: "Escalations" },
];

export function agentsByDepartment(dept: Department): HumanAgent[] {
  return HUMAN_AGENTS.filter((a) => a.department === dept);
}

/**
 * Pick the least-loaded agent in a department, given a map of current open
 * counts per agent id. Ties resolve by roster order, so assignment is
 * deterministic and spreads load evenly.
 */
export function pickAssignee(
  dept: Department,
  openCounts: Record<string, number>
): HumanAgent {
  const pool = agentsByDepartment(dept);
  const candidates = pool.length ? pool : HUMAN_AGENTS;
  return candidates.reduce((best, a) =>
    (openCounts[a.id] ?? 0) < (openCounts[best.id] ?? 0) ? a : best
  );
}
