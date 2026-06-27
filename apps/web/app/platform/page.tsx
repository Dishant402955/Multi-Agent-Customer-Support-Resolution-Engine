"use client";
import { useState } from "react";
import { BookOpen, Bot, FileJson, History, MessageCircleQuestion, Scale, Users, Wrench } from "lucide-react";
import { AdminHeader } from "@/components/admin-nav";
import { useRequireRole } from "@/lib/auth";
import { KbTab } from "./tabs/kb";
import { UseCasesTab } from "./tabs/usecases";
import { HumanAgentsTab } from "./tabs/human-agents";
import { ToolsTab } from "./tabs/tools";
import { SpecialistsTab } from "./tabs/specialists";
import { FaqTab } from "./tabs/faq";
import { PoliciesTab } from "./tabs/policies";
import { AuditTab } from "./tabs/audit";

type Tab = "kb" | "usecases" | "tools" | "specialists" | "policies" | "faq" | "agents" | "audit";

const TABS: { id: Tab; label: string; icon: typeof BookOpen }[] = [
  { id: "specialists", label: "Specialists", icon: Bot },
  { id: "usecases",   label: "Use cases",   icon: FileJson },
  { id: "policies",   label: "Policies",    icon: Scale },
  { id: "faq",        label: "FAQ",         icon: MessageCircleQuestion },
  { id: "kb",         label: "Knowledge base", icon: BookOpen },
  { id: "tools",      label: "HTTP tools",  icon: Wrench },
  { id: "agents",     label: "Human agents", icon: Users },
  { id: "audit",      label: "Audit log",   icon: History },
];

export default function PlatformPage() {
  const account = useRequireRole("admin");
  const [tab, setTab] = useState<Tab>("specialists");

  if (!account) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AdminHeader title="Platform" subtitle="Live config store — changes hot-reload the agent" role="admin" />

      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="mb-6 flex flex-wrap gap-1 border-b border-border">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={
                  "flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors " +
                  (tab === t.id
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground")
                }
              >
                <Icon className="size-4" /> {t.label}
              </button>
            );
          })}
        </div>

        {tab === "specialists" && <SpecialistsTab />}
        {tab === "usecases"   && <UseCasesTab />}
        {tab === "policies"   && <PoliciesTab />}
        {tab === "faq"        && <FaqTab />}
        {tab === "kb"         && <KbTab />}
        {tab === "tools"      && <ToolsTab />}
        {tab === "agents"     && <HumanAgentsTab />}
        {tab === "audit"      && <AuditTab />}
      </div>
    </div>
  );
}
