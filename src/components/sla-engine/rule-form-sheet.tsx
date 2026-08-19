"use client";

import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from "react";
import {
  RiCheckLine,
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCloseLine,
  RiAddLine,
  RiDeleteBinLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { MultiSelect } from "@/components/ui/multi-select";
import { cn } from "@/lib/utils";
import {
  CONDITION_FIELDS,
  CONDITION_OPERATORS,
  conditionTreeToHuman,
  formatThreshold,
  defaultCondition,
  defaultGroup,
  defaultConditionTree,
} from "./helpers";
import type { SlaRule } from "./index";
import type {
  SlaCondition,
  SlaConditionGroup,
  SlaConditionTree,
} from "@/lib/db/schema";

type Stakeholder = { id: string; name: string; email: string };

type Props = {
  projectId: string;
  rule: SlaRule | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

const STEPS = ["Name", "Conditions", "Threshold", "Notifications"] as const;

const selectClass =
  "h-7 rounded-md border border-input bg-input/20 px-2 text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30";

const labelClass = "mb-1.5 block text-xs font-medium text-zinc-700 dark:text-zinc-300";

export function RuleFormSheet({ projectId, rule, open, onOpenChange, onSaved }: Props) {
  const [step, setStep] = useState(1);

  // Step 1
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Step 2 — compound condition tree
  const [conditionTree, setConditionTree] = useState<SlaConditionTree>(defaultConditionTree);

  // Step 3
  const [thresholdAmount, setThresholdAmount] = useState("");
  const [thresholdUnit, setThresholdUnit] = useState<"hours" | "days">("hours");

  // Step 4
  const [notifyAssignee, setNotifyAssignee] = useState(true);
  const [notifyReporter, setNotifyReporter] = useState(false);
  const [additionalEmails, setAdditionalEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [selectedStakeholderEmails, setSelectedStakeholderEmails] = useState<string[]>([]);

  // Remote data
  const [fieldOptions, setFieldOptions] = useState<Record<string, string[]>>({});
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch field options and stakeholders when sheet opens
  useEffect(() => {
    if (!open) return;
    fetch(`/api/projects/${projectId}/issue-fields`)
      .then((r) => r.json())
      .then(setFieldOptions)
      .catch(() => {});
    fetch(`/api/projects/${projectId}/stakeholders`)
      .then((r) => r.json())
      .then((data: Stakeholder[]) => setStakeholders(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [open, projectId]);

  // Populate form when sheet opens
  useEffect(() => {
    if (!open) return;
    setError(null);
    setStep(1);
    setEmailInput("");
    setSelectedStakeholderEmails([]);

    if (rule) {
      setName(rule.name);
      setDescription(rule.description ?? "");
      setConditionTree(rule.conditions ?? defaultConditionTree());
      const h = parseFloat(rule.thresholdHours);
      if (h >= 24 && h % 24 === 0) {
        setThresholdUnit("days");
        setThresholdAmount(String(h / 24));
      } else {
        setThresholdUnit("hours");
        setThresholdAmount(String(h));
      }
      setNotifyAssignee(rule.notifyAssignee);
      setNotifyReporter(rule.notifyReporter);
      setAdditionalEmails(rule.additionalEmails ?? []);
    } else {
      setName("");
      setDescription("");
      setConditionTree(defaultConditionTree());
      setThresholdAmount("");
      setThresholdUnit("hours");
      setNotifyAssignee(true);
      setNotifyReporter(false);
      setAdditionalEmails([]);
    }
  }, [rule, open]);

  // ---------------------------------------------------------------------------
  // Condition tree mutations
  // ---------------------------------------------------------------------------

  const updateCondition = useCallback(
    (groupIdx: number, condIdx: number, patch: Partial<SlaCondition>) => {
      setConditionTree((prev) => {
        const groups = prev.groups.map((g, gi) => {
          if (gi !== groupIdx) return g;
          return {
            ...g,
            conditions: g.conditions.map((c, ci) =>
              ci === condIdx ? { ...c, ...patch } : c
            ),
          };
        });
        return { ...prev, groups };
      });
    },
    []
  );

  const removeCondition = useCallback((groupIdx: number, condIdx: number) => {
    setConditionTree((prev) => {
      const groups = prev.groups
        .map((g, gi) => {
          if (gi !== groupIdx) return g;
          const conditions = g.conditions.filter((_, ci) => ci !== condIdx);
          return { ...g, conditions };
        })
        .filter((g) => g.conditions.length > 0);
      return { ...prev, groups: groups.length > 0 ? groups : [defaultGroup()] };
    });
  }, []);

  const addCondition = useCallback((groupIdx: number) => {
    setConditionTree((prev) => {
      const groups = prev.groups.map((g, gi) => {
        if (gi !== groupIdx) return g;
        return { ...g, conditions: [...g.conditions, defaultCondition()] };
      });
      return { ...prev, groups };
    });
  }, []);

  const removeGroup = useCallback((groupIdx: number) => {
    setConditionTree((prev) => {
      const groups = prev.groups.filter((_, gi) => gi !== groupIdx);
      return { ...prev, groups: groups.length > 0 ? groups : [defaultGroup()] };
    });
  }, []);

  const addGroup = useCallback(() => {
    setConditionTree((prev) => ({
      ...prev,
      groups: [...prev.groups, defaultGroup()],
    }));
  }, []);

  // ---------------------------------------------------------------------------
  // Email chip helpers
  // ---------------------------------------------------------------------------

  function addEmail(val: string) {
    const trimmed = val.trim();
    if (!trimmed || additionalEmails.includes(trimmed)) return;
    setAdditionalEmails((prev) => [...prev, trimmed]);
    setEmailInput("");
  }

  function handleEmailKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addEmail(emailInput);
    } else if (e.key === "Backspace" && !emailInput && additionalEmails.length > 0) {
      setAdditionalEmails((prev) => prev.slice(0, -1));
    }
  }

  // When stakeholder selections change, sync them into additionalEmails
  function handleStakeholderChange(selected: string[]) {
    setSelectedStakeholderEmails(selected);
    setAdditionalEmails((prev) => {
      const manual = prev.filter(
        (e) => !stakeholders.some((s) => s.email === e)
      );
      return [...new Set([...manual, ...selected])];
    });
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  function isTreeValid(tree: SlaConditionTree): boolean {
    return tree.groups.every((g) =>
      g.conditions.every((c) => c.value.trim().length > 0)
    );
  }

  function canAdvance(): boolean {
    if (step === 1) return name.trim().length > 0;
    if (step === 2) return isTreeValid(conditionTree);
    if (step === 3) {
      const n = parseFloat(thresholdAmount);
      return !isNaN(n) && n > 0;
    }
    return true;
  }

  function getThresholdHours(): number {
    const n = parseFloat(thresholdAmount);
    return thresholdUnit === "days" ? n * 24 : n;
  }

  function thresholdPreview(): string {
    const n = parseFloat(thresholdAmount);
    if (isNaN(n) || n <= 0) return "";
    return formatThreshold(getThresholdHours());
  }

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        conditions: conditionTree,
        thresholdHours: getThresholdHours(),
        notifyAssignee,
        notifyReporter,
        additionalEmails,
      };

      const url = rule
        ? `/api/projects/${projectId}/sla-rules/${rule.id}`
        : `/api/projects/${projectId}/sla-rules`;

      const res = await fetch(url, {
        method: rule ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Failed to save rule");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const stakeholderOptions = stakeholders.map((s) => ({
    value: s.email,
    label: `${s.name} (${s.email})`,
  }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col sm:max-w-lg" showCloseButton={false}>
        {/* Header */}
        <SheetHeader className="border-b border-zinc-200 px-6 pb-4 dark:border-zinc-800">
          <div className="flex items-start justify-between">
            <div>
              <SheetTitle>{rule ? "Edit SLA rule" : "New SLA rule"}</SheetTitle>
              <SheetDescription className="mt-0.5">
                {rule
                  ? "Update this rule's conditions, threshold, or notifications."
                  : "Define when an issue should trigger an SLA alert."}
              </SheetDescription>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onOpenChange(false)}
              className="mt-0.5"
            >
              <RiCloseLine />
            </Button>
          </div>

          {/* Step indicator */}
          <div className="mt-4 flex items-center">
            {STEPS.map((label, i) => {
              const n = i + 1;
              const isActive = n === step;
              const isDone = n < step;
              return (
                <div key={label} className="flex items-center">
                  {i > 0 && (
                    <div
                      className={cn(
                        "h-px w-8 transition-colors",
                        isDone
                          ? "bg-zinc-900 dark:bg-zinc-100"
                          : "bg-zinc-200 dark:bg-zinc-700"
                      )}
                    />
                  )}
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className={cn(
                        "flex size-5 items-center justify-center rounded-full text-[10px] font-bold transition-colors",
                        isActive
                          ? "bg-zinc-900 text-white ring-2 ring-zinc-900/20 dark:bg-zinc-100 dark:text-zinc-900 dark:ring-zinc-100/20"
                          : isDone
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "border border-zinc-200 bg-white text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500"
                      )}
                    >
                      {isDone ? <RiCheckLine className="size-2.5" /> : n}
                    </div>
                    <span
                      className={cn(
                        "text-[9px] font-medium",
                        isActive
                          ? "text-zinc-700 dark:text-zinc-300"
                          : "text-zinc-400"
                      )}
                    >
                      {label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </SheetHeader>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── Step 1: Name ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className={labelClass}>
                  Rule name <span className="text-red-500">*</span>
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Critical bug response time"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && canAdvance() && setStep(2)}
                />
              </div>
              <div>
                <label className={labelClass}>
                  Description{" "}
                  <span className="font-normal text-zinc-400">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Brief description of what this rule monitors…"
                  className="w-full resize-none rounded-md border border-input bg-input/20 px-2 py-1.5 text-xs placeholder:text-muted-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
                />
              </div>
            </div>
          )}

          {/* ── Step 2: Compound Conditions ── */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Build the condition that will trigger this rule. Groups are connected by{" "}
                <span className="font-semibold text-orange-600 dark:text-orange-400">OR</span>;
                conditions within a group are connected by{" "}
                <span className="font-semibold text-blue-600 dark:text-blue-400">AND</span>.
              </p>

              <div className="space-y-3">
                {conditionTree.groups.map((group, groupIdx) => (
                  <div key={groupIdx}>
                    {/* OR separator between groups */}
                    {groupIdx > 0 && (
                      <div className="flex items-center gap-2 py-1">
                        <div className="flex-1 border-t border-dashed border-zinc-200 dark:border-zinc-700" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400">
                          OR
                        </span>
                        <div className="flex-1 border-t border-dashed border-zinc-200 dark:border-zinc-700" />
                      </div>
                    )}

                    <ConditionGroupEditor
                      group={group}
                      groupIdx={groupIdx}
                      fieldOptions={fieldOptions}
                      showRemoveGroup={conditionTree.groups.length > 1}
                      onUpdateCondition={updateCondition}
                      onRemoveCondition={removeCondition}
                      onAddCondition={addCondition}
                      onRemoveGroup={removeGroup}
                    />
                  </div>
                ))}
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={addGroup}
              >
                <RiAddLine className="size-3.5" />
                Add condition group{" "}
                <span className="ml-1 text-[10px] font-bold text-orange-600 dark:text-orange-400">
                  (OR)
                </span>
              </Button>

              {/* Preview */}
              {isTreeValid(conditionTree) && (
                <div className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">Preview: </span>
                  Flag issues where{" "}
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {conditionTreeToHuman(conditionTree)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Threshold ── */}
          {step === 3 && (
            <div className="space-y-5">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                How long can an issue match the condition before it&apos;s flagged?
              </p>

              <div>
                <label className={labelClass}>
                  Alert after <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={thresholdAmount}
                    onChange={(e) => setThresholdAmount(e.target.value)}
                    placeholder="e.g. 48"
                    className="w-28"
                    autoFocus
                  />
                  <select
                    value={thresholdUnit}
                    onChange={(e) => setThresholdUnit(e.target.value as "hours" | "days")}
                    className={cn(selectClass, "w-24")}
                  >
                    <option value="hours">hours</option>
                    <option value="days">days</option>
                  </select>
                </div>
              </div>

              {thresholdPreview() && (
                <div className="rounded-md bg-zinc-100 px-3 py-2.5 text-xs dark:bg-zinc-800/60">
                  <span className="text-zinc-500 dark:text-zinc-400">An issue will be flagged after </span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {thresholdPreview()}
                  </span>
                  <span className="text-zinc-500 dark:text-zinc-400"> without resolution.</span>
                  <br />
                  <span className="text-zinc-500 dark:text-zinc-400">Escalation at </span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {formatThreshold(getThresholdHours() * 2)}
                  </span>
                  <span className="text-zinc-500 dark:text-zinc-400"> (2×).</span>
                </div>
              )}
            </div>
          )}

          {/* ── Step 4: Notifications ── */}
          {step === 4 && (
            <div className="space-y-5">
              {/* Review summary */}
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Rule summary
                </p>
                <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  {name}
                </p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Flag issues where{" "}
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {conditionTreeToHuman(conditionTree)}
                  </span>{" "}
                  and remain unresolved for more than{" "}
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {thresholdPreview()}
                  </span>
                  .
                </p>
              </div>

              {/* Notification toggles */}
              <div>
                <label className={labelClass}>Who gets notified?</label>
                <div className="space-y-2">
                  <NotifyToggle
                    label="Notify assignee"
                    description="The person currently assigned to the issue"
                    checked={notifyAssignee}
                    onChange={setNotifyAssignee}
                  />
                  <NotifyToggle
                    label="Notify reporter"
                    description="The person who created the issue"
                    checked={notifyReporter}
                    onChange={setNotifyReporter}
                  />
                </div>
              </div>

              {/* Stakeholder multi-select */}
              {stakeholderOptions.length > 0 && (
                <div>
                  <label className={labelClass}>
                    Add from stakeholders{" "}
                    <span className="font-normal text-zinc-400">(optional)</span>
                  </label>
                  <MultiSelect
                    options={stakeholderOptions}
                    onValueChange={handleStakeholderChange}
                    defaultValue={selectedStakeholderEmails}
                    placeholder="Select project stakeholders…"
                    maxCount={3}
                    className="text-xs"
                  />
                </div>
              )}

              {/* Manual additional emails */}
              <div>
                <label className={labelClass}>
                  Additional recipients{" "}
                  <span className="font-normal text-zinc-400">(optional)</span>
                </label>
                <div
                  className="flex min-h-7 cursor-text flex-wrap items-center gap-1 rounded-md border border-input bg-input/20 px-2 py-1 text-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 dark:bg-input/30"
                  onClick={() => {
                    const input = document.getElementById("sla-email-input") as HTMLInputElement | null;
                    input?.focus();
                  }}
                >
                  {additionalEmails.map((email) => (
                    <span
                      key={email}
                      className="inline-flex items-center gap-0.5 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
                    >
                      {email}
                      <button
                        type="button"
                        onClick={() =>
                          setAdditionalEmails((prev) => prev.filter((e) => e !== email))
                        }
                        className="ml-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    id="sla-email-input"
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    onKeyDown={handleEmailKeyDown}
                    onBlur={() => emailInput.trim() && addEmail(emailInput)}
                    placeholder={
                      additionalEmails.length === 0 ? "Add email and press Enter…" : "Add more…"
                    }
                    className="min-w-40 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                  />
                </div>
              </div>

              {error && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer navigation */}
        <div className="flex items-center justify-between border-t border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStep((s) => s - 1)}
            disabled={step === 1}
          >
            <RiArrowLeftLine />
            Back
          </Button>

          {step < 4 ? (
            <Button
              size="sm"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canAdvance()}
            >
              Next
              <RiArrowRightLine />
            </Button>
          ) : (
            <Button size="sm" onClick={save} disabled={saving || !canAdvance()}>
              {saving ? "Saving…" : rule ? "Update rule" : "Create rule"}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// ConditionGroupEditor — renders one AND-group with its conditions
// ---------------------------------------------------------------------------

function ConditionGroupEditor({
  group,
  groupIdx,
  fieldOptions,
  showRemoveGroup,
  onUpdateCondition,
  onRemoveCondition,
  onAddCondition,
  onRemoveGroup,
}: {
  group: SlaConditionGroup;
  groupIdx: number;
  fieldOptions: Record<string, string[]>;
  showRemoveGroup: boolean;
  onUpdateCondition: (gi: number, ci: number, patch: Partial<SlaCondition>) => void;
  onRemoveCondition: (gi: number, ci: number) => void;
  onAddCondition: (gi: number) => void;
  onRemoveGroup: (gi: number) => void;
}) {
  const selectClass =
    "h-7 rounded-md border border-input bg-input/20 px-2 text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30";

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          Match ALL of:
        </span>
        {showRemoveGroup && (
          <button
            type="button"
            onClick={() => onRemoveGroup(groupIdx)}
            className="text-zinc-400 transition-colors hover:text-red-500"
          >
            <RiDeleteBinLine className="size-3.5" />
          </button>
        )}
      </div>

      <div className="space-y-2">
        {group.conditions.map((cond, condIdx) => (
          <div key={condIdx}>
            {condIdx > 0 && (
              <div className="flex items-center gap-2 py-0.5">
                <div className="flex-1 border-t border-zinc-200 dark:border-zinc-700" />
                <span className="text-[9px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                  AND
                </span>
                <div className="flex-1 border-t border-zinc-200 dark:border-zinc-700" />
              </div>
            )}
            <ConditionRow
              cond={cond}
              groupIdx={groupIdx}
              condIdx={condIdx}
              fieldOptions={fieldOptions}
              showRemove={group.conditions.length > 1}
              onUpdate={onUpdateCondition}
              onRemove={onRemoveCondition}
              selectClass={selectClass}
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onAddCondition(groupIdx)}
        className="mt-2 flex items-center gap-1 text-[10px] font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
      >
        <RiAddLine className="size-3" />
        Add condition{" "}
        <span className="font-bold">(AND)</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConditionRow — single condition: field + operator + value
// ---------------------------------------------------------------------------

function ConditionRow({
  cond,
  groupIdx,
  condIdx,
  fieldOptions,
  showRemove,
  onUpdate,
  onRemove,
  selectClass,
}: {
  cond: SlaCondition;
  groupIdx: number;
  condIdx: number;
  fieldOptions: Record<string, string[]>;
  showRemove: boolean;
  onUpdate: (gi: number, ci: number, patch: Partial<SlaCondition>) => void;
  onRemove: (gi: number, ci: number) => void;
  selectClass: string;
}) {
  const chipInputRef = useRef<HTMLInputElement>(null);
  const isMulti = cond.operator === "in";
  const valueOptions = fieldOptions[cond.field] ?? [];
  const multiValues = isMulti
    ? cond.value.split(",").map((v) => v.trim()).filter(Boolean)
    : [];
  const [chipInput, setChipInput] = useState("");

  function addChip(val: string) {
    const trimmed = val.trim();
    if (!trimmed || multiValues.includes(trimmed)) return;
    onUpdate(groupIdx, condIdx, { value: [...multiValues, trimmed].join(",") });
    setChipInput("");
  }

  function removeChip(chip: string) {
    const next = multiValues.filter((v) => v !== chip);
    onUpdate(groupIdx, condIdx, { value: next.join(",") });
  }

  function handleChipKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addChip(chipInput);
    } else if (e.key === "Backspace" && !chipInput && multiValues.length > 0) {
      const next = multiValues.slice(0, -1);
      onUpdate(groupIdx, condIdx, { value: next.join(",") });
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-1.5">
      {/* Field */}
      <select
        value={cond.field}
        onChange={(e) => {
          onUpdate(groupIdx, condIdx, {
            field: e.target.value as SlaCondition["field"],
            value: "",
          });
        }}
        className={selectClass}
      >
        {CONDITION_FIELDS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>

      {/* Operator */}
      <select
        value={cond.operator}
        onChange={(e) => {
          onUpdate(groupIdx, condIdx, {
            operator: e.target.value as SlaCondition["operator"],
            value: "",
          });
        }}
        className={selectClass}
      >
        {CONDITION_OPERATORS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {/* Value */}
      {!isMulti ? (
        valueOptions.length > 0 ? (
          <select
            value={cond.value}
            onChange={(e) => onUpdate(groupIdx, condIdx, { value: e.target.value })}
            className={cn(selectClass, !cond.value && "text-muted-foreground")}
          >
            <option value="">Select…</option>
            {valueOptions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        ) : (
          <Input
            value={cond.value}
            onChange={(e) => onUpdate(groupIdx, condIdx, { value: e.target.value })}
            placeholder="Value…"
            className="h-7 w-28 text-xs"
          />
        )
      ) : (
        <div
          className="flex min-h-7 cursor-text flex-wrap items-center gap-1 rounded-md border border-input bg-input/20 px-2 py-1 text-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 dark:bg-input/30"
          style={{ minWidth: "8rem" }}
          onClick={() => chipInputRef.current?.focus()}
        >
          {multiValues.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-0.5 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
            >
              {v}
              <button
                type="button"
                onClick={() => removeChip(v)}
                className="ml-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                ×
              </button>
            </span>
          ))}
          <input
            ref={chipInputRef}
            value={chipInput}
            onChange={(e) => setChipInput(e.target.value)}
            onKeyDown={handleChipKeyDown}
            onBlur={() => chipInput.trim() && addChip(chipInput)}
            placeholder={multiValues.length === 0 ? "Type + Enter…" : "More…"}
            className="min-w-16 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </div>
      )}

      {/* Remove button */}
      {showRemove && (
        <button
          type="button"
          onClick={() => onRemove(groupIdx, condIdx)}
          className="mt-0.5 text-zinc-400 transition-colors hover:text-red-500"
        >
          <RiCloseLine className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NotifyToggle
// ---------------------------------------------------------------------------

function NotifyToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors",
        checked
          ? "border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/60"
          : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
      )}
    >
      <div
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
          checked
            ? "border-zinc-900 bg-zinc-900 dark:border-zinc-100 dark:bg-zinc-100"
            : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900"
        )}
      >
        {checked && (
          <RiCheckLine className="size-2.5 text-white dark:text-zinc-900" />
        )}
      </div>
      <div>
        <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200">{label}</p>
        <p className="text-[10px] text-zinc-400">{description}</p>
      </div>
    </button>
  );
}
