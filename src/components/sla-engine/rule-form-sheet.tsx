"use client";

import { useState, useEffect, useRef, type KeyboardEvent } from "react";
import { RiCheckLine, RiArrowLeftLine, RiArrowRightLine, RiCloseLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  CONDITION_FIELDS,
  CONDITION_OPERATORS,
  conditionToHuman,
  formatThreshold,
} from "./helpers";
import type { SlaRule } from "./index";

type Props = {
  projectId: string;
  rule: SlaRule | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

const STEPS = ["Name", "Condition", "Threshold", "Notifications"] as const;

const selectClass =
  "h-7 rounded-md border border-input bg-input/20 px-2 text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30";

const labelClass = "mb-1.5 block text-xs font-medium text-zinc-700 dark:text-zinc-300";

export function RuleFormSheet({ projectId, rule, open, onOpenChange, onSaved }: Props) {
  const [step, setStep] = useState(1);

  // Step 1
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Step 2
  const [conditionField, setConditionField] = useState("priority");
  const [conditionOperator, setConditionOperator] = useState("equals");
  const [singleValue, setSingleValue] = useState("");
  const [multiValues, setMultiValues] = useState<string[]>([]);
  const [chipInput, setChipInput] = useState("");
  const chipInputRef = useRef<HTMLInputElement>(null);

  // Step 3
  const [thresholdAmount, setThresholdAmount] = useState("");
  const [thresholdUnit, setThresholdUnit] = useState<"hours" | "days">("hours");

  // Step 4
  const [notifyAssignee, setNotifyAssignee] = useState(true);
  const [notifyReporter, setNotifyReporter] = useState(false);
  const [additionalEmails, setAdditionalEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState("");

  // Remote field options
  const [fieldOptions, setFieldOptions] = useState<Record<string, string[]>>({});

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch distinct field values from project's issues
  useEffect(() => {
    if (!open) return;
    fetch(`/api/projects/${projectId}/issue-fields`)
      .then((r) => r.json())
      .then(setFieldOptions)
      .catch(() => {});
  }, [open, projectId]);

  // Populate form when sheet opens
  useEffect(() => {
    if (!open) return;
    setError(null);
    setStep(1);
    setEmailInput("");
    setChipInput("");

    if (rule) {
      setName(rule.name);
      setDescription(rule.description ?? "");
      setConditionField(rule.conditionField);
      setConditionOperator(rule.conditionOperator);
      if (rule.conditionOperator === "in") {
        setMultiValues(rule.conditionValue.split(",").map((v) => v.trim()).filter(Boolean));
        setSingleValue("");
      } else {
        setSingleValue(rule.conditionValue);
        setMultiValues([]);
      }
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
      setConditionField("priority");
      setConditionOperator("equals");
      setSingleValue("");
      setMultiValues([]);
      setThresholdAmount("");
      setThresholdUnit("hours");
      setNotifyAssignee(true);
      setNotifyReporter(false);
      setAdditionalEmails([]);
    }
  }, [rule, open]);

  // Reset value selections when field or operator changes
  function handleFieldChange(field: string) {
    setConditionField(field);
    setSingleValue("");
    setMultiValues([]);
    setChipInput("");
  }

  function handleOperatorChange(op: string) {
    setConditionOperator(op);
    setSingleValue("");
    setMultiValues([]);
    setChipInput("");
  }

  // Chip helpers for multi-value condition
  function addChip(val: string) {
    const trimmed = val.trim();
    if (!trimmed || multiValues.includes(trimmed)) return;
    setMultiValues((prev) => [...prev, trimmed]);
    setChipInput("");
  }

  function handleChipKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addChip(chipInput);
    } else if (e.key === "Backspace" && !chipInput && multiValues.length > 0) {
      setMultiValues((prev) => prev.slice(0, -1));
    }
  }

  // Email chip helpers
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

  function canAdvance(): boolean {
    if (step === 1) return name.trim().length > 0;
    if (step === 2) {
      return conditionOperator === "in" ? multiValues.length > 0 : singleValue.trim().length > 0;
    }
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

  function getConditionValue(): string {
    return conditionOperator === "in" ? multiValues.join(",") : singleValue.trim();
  }

  function thresholdPreview(): string {
    const n = parseFloat(thresholdAmount);
    if (isNaN(n) || n <= 0) return "";
    return formatThreshold(getThresholdHours());
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        conditionField,
        conditionOperator,
        conditionValue: getConditionValue(),
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

  const valueOptions = fieldOptions[conditionField] ?? [];
  const isMulti = conditionOperator === "in";

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
                  ? "Update this rule's condition, threshold, or notifications."
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

          {step === 2 && (
            <div className="space-y-5">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Build the condition that will trigger this rule.
              </p>

              {/* Sentence builder */}
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Flag issues where…
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Field */}
                  <select
                    value={conditionField}
                    onChange={(e) => handleFieldChange(e.target.value)}
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
                    value={conditionOperator}
                    onChange={(e) => handleOperatorChange(e.target.value)}
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
                        value={singleValue}
                        onChange={(e) => setSingleValue(e.target.value)}
                        className={cn(selectClass, !singleValue && "text-muted-foreground")}
                      >
                        <option value="">Select a value…</option>
                        {valueOptions.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        value={singleValue}
                        onChange={(e) => setSingleValue(e.target.value)}
                        placeholder="Enter value…"
                        className="w-36"
                      />
                    )
                  ) : null}
                </div>

                {/* Chip input for "in" operator */}
                {isMulti && (
                  <div className="mt-3">
                    <div
                      className="flex min-h-7 cursor-text flex-wrap items-center gap-1 rounded-md border border-input bg-input/20 px-2 py-1 text-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 dark:bg-input/30"
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
                            onClick={() => setMultiValues((prev) => prev.filter((x) => x !== v))}
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
                        placeholder={
                          multiValues.length === 0 ? "Type a value and press Enter…" : "Add more…"
                        }
                        className="min-w-28 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                      />
                    </div>
                    <p className="mt-1.5 text-[10px] text-zinc-400">
                      {valueOptions.length > 0
                        ? `Suggestions: ${valueOptions.join(", ")}`
                        : "Press Enter or comma to add each value."}
                    </p>
                  </div>
                )}
              </div>

              {/* Live preview */}
              {(singleValue || multiValues.length > 0) && (
                <div className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">Preview: </span>
                  Flag issues where{" "}
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {conditionToHuman(
                      conditionField,
                      conditionOperator,
                      conditionOperator === "in" ? multiValues.join(",") : singleValue
                    )}
                  </span>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                How long can an issue match the condition before it's flagged?
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
                </div>
              )}
            </div>
          )}

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
                    {conditionToHuman(conditionField, conditionOperator, getConditionValue())}
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

              {/* Additional emails */}
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
