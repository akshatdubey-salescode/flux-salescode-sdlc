"use client";

import { useState } from "react";
import { RiPencilLine, RiDeleteBinLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { conditionTreeToHuman, formatThreshold } from "./helpers";
import type { SlaRule } from "./index";

type Props = {
  rule: SlaRule;
  onEdit: (rule: SlaRule) => void;
  onToggle: (rule: SlaRule) => Promise<void>;
  onDelete: (ruleId: string) => Promise<void>;
};

export function RuleCard({ rule, onEdit, onToggle, onDelete }: Props) {
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleToggle() {
    setToggling(true);
    try {
      await onToggle(rule);
    } finally {
      setToggling(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await onDelete(rule.id);
    } finally {
      setDeleting(false);
    }
  }

  const notifyParts = [
    rule.notifyAssignee ? "assignee" : null,
    rule.notifyReporter ? "reporter" : null,
    rule.additionalEmails?.length ? `+${rule.additionalEmails.length} email${rule.additionalEmails.length > 1 ? "s" : ""}` : null,
  ].filter(Boolean);

  return (
    <div
      className={cn(
        "flex items-start gap-4 rounded-lg border bg-white p-4 transition-all dark:bg-zinc-950",
        rule.isActive
          ? "border-zinc-200 dark:border-zinc-800"
          : "border-zinc-200/60 opacity-60 dark:border-zinc-800/60"
      )}
      onMouseLeave={() => setConfirmDelete(false)}
    >
      {/* Active toggle */}
      <button
        type="button"
        onClick={handleToggle}
        disabled={toggling}
        title={rule.isActive ? "Pause rule" : "Resume rule"}
        className={cn(
          "relative mt-0.5 h-4 w-7 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50",
          rule.isActive ? "bg-emerald-500" : "bg-zinc-200 dark:bg-zinc-700"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-3 rounded-full bg-white shadow transition-transform",
            rule.isActive && "translate-x-3"
          )}
        />
      </button>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            {rule.name}
          </span>
          {!rule.isActive && (
            <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 dark:bg-zinc-800">
              Paused
            </span>
          )}
        </div>

        {rule.description && (
          <p className="mt-0.5 text-xs text-zinc-400">{rule.description}</p>
        )}

        <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          Flag issues where{" "}
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            {conditionTreeToHuman(rule.conditions)}
          </span>
          {" "}· threshold{" "}
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            {formatThreshold(rule.thresholdHours)}
          </span>
        </p>

        {notifyParts.length > 0 && (
          <p className="mt-1 text-[10px] text-zinc-400">
            Notifies: {notifyParts.join(", ")}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onEdit(rule)}
          title="Edit rule"
        >
          <RiPencilLine />
        </Button>

        <Button
          variant={confirmDelete ? "destructive" : "ghost"}
          size={confirmDelete ? "sm" : "icon-sm"}
          onClick={handleDelete}
          disabled={deleting}
          title={confirmDelete ? "Click again to confirm" : "Delete rule"}
        >
          <RiDeleteBinLine />
          {confirmDelete && <span>Confirm</span>}
        </Button>
      </div>
    </div>
  );
}
