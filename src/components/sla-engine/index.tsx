"use client";

import { useState, useEffect, useCallback } from "react";
import { RiAddLine, RiShieldCheckLine, RiLoader4Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RuleCard } from "./rule-card";
import { RuleFormSheet } from "./rule-form-sheet";
import { ViolationsPanel } from "./violations-panel";

export type SlaRule = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  conditionField: string;
  conditionOperator: string;
  conditionValue: string;
  thresholdHours: string;
  notifyAssignee: boolean;
  notifyReporter: boolean;
  additionalEmails: string[];
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type SlaViolation = {
  id: string;
  ruleId: string;
  ruleName: string;
  issueId: string;
  issueKey: string;
  issueSummary: string;
  issueStatus: string;
  issuePriority: string | null;
  enteredConditionAt: string;
  violatedAt: string;
  thresholdHoursSnapshot: string;
  actualHours: string;
  notificationStatus: string | null;
  resolvedAt: string | null;
  resolvedReason: string | null;
};

type SubTab = "rules" | "violations";

export function SlaEngineTab({ projectId }: { projectId: string }) {
  const [activeTab, setActiveTab] = useState<SubTab>("rules");
  const [rules, setRules] = useState<SlaRule[]>([]);
  const [violations, setViolations] = useState<SlaViolation[]>([]);
  const [loadingRules, setLoadingRules] = useState(true);
  const [loadingViolations, setLoadingViolations] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<SlaRule | null>(null);

  const fetchRules = useCallback(async () => {
    setLoadingRules(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/sla-rules`);
      if (res.ok) setRules(await res.json());
    } finally {
      setLoadingRules(false);
    }
  }, [projectId]);

  const fetchViolations = useCallback(async () => {
    setLoadingViolations(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/sla-violations`);
      if (res.ok) setViolations(await res.json());
    } finally {
      setLoadingViolations(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchRules();
    fetchViolations();
  }, [fetchRules, fetchViolations]);

  function openCreate() {
    setEditingRule(null);
    setFormOpen(true);
  }

  function openEdit(rule: SlaRule) {
    setEditingRule(rule);
    setFormOpen(true);
  }

  const handleToggle = useCallback(
    async (rule: SlaRule) => {
      await fetch(`/api/projects/${projectId}/sla-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      await fetchRules();
    },
    [projectId, fetchRules]
  );

  const handleDelete = useCallback(
    async (ruleId: string) => {
      await fetch(`/api/projects/${projectId}/sla-rules/${ruleId}`, {
        method: "DELETE",
      });
      await fetchRules();
    },
    [projectId, fetchRules]
  );

  const handleDismiss = useCallback(
    async (violationId: string) => {
      await fetch(`/api/projects/${projectId}/sla-violations/${violationId}`, {
        method: "PATCH",
      });
      await fetchViolations();
    },
    [projectId, fetchViolations]
  );

  const openViolationCount = violations.length;

  return (
    <div>
      {/* Sub-tabs + action button */}
      <div className="mb-6 flex items-center justify-between">
        <div className="inline-flex items-center rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-950">
          <SubTabButton
            active={activeTab === "rules"}
            onClick={() => setActiveTab("rules")}
          >
            Rules
            {rules.length > 0 && (
              <span className="ml-1.5 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {rules.length}
              </span>
            )}
          </SubTabButton>
          <SubTabButton
            active={activeTab === "violations"}
            onClick={() => setActiveTab("violations")}
          >
            Violations
            {openViolationCount > 0 && (
              <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-400">
                {openViolationCount}
              </span>
            )}
          </SubTabButton>
        </div>

        {activeTab === "rules" && (
          <Button size="sm" onClick={openCreate}>
            <RiAddLine />
            New rule
          </Button>
        )}
      </div>

      {/* Rules content */}
      {activeTab === "rules" && (
        <>
          {loadingRules ? (
            <div className="flex items-center justify-center py-12">
              <RiLoader4Line className="size-5 animate-spin text-zinc-400" />
            </div>
          ) : rules.length === 0 ? (
            <EmptyRules onCreateClick={openCreate} />
          ) : (
            <div className="space-y-3">
              {rules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  onEdit={openEdit}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Violations content */}
      {activeTab === "violations" && (
        <ViolationsPanel
          violations={violations}
          loading={loadingViolations}
          onDismiss={handleDismiss}
        />
      )}

      <RuleFormSheet
        projectId={projectId}
        rule={editingRule}
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={() => {
          setFormOpen(false);
          fetchRules();
        }}
      />
    </div>
  );
}

function SubTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium transition-all",
        active
          ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
          : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      )}
    >
      {children}
    </button>
  );
}

function EmptyRules({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-200 p-12 text-center dark:border-zinc-800">
      <RiShieldCheckLine className="mx-auto mb-3 size-8 text-zinc-300 dark:text-zinc-600" />
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        No SLA rules yet
      </p>
      <p className="mt-1 text-xs text-zinc-400">
        Create rules to monitor response times and get alerted when issues
        breach thresholds.
      </p>
      <Button size="sm" className="mt-4" onClick={onCreateClick}>
        <RiAddLine />
        Create first rule
      </Button>
    </div>
  );
}
