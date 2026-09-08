"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deriveNextSprint, isNewSprintSpecReady, type NewSprintSpec } from "@/lib/sprints/next-sprint";
import type { SpilloverTarget } from "./sprint-tracker-tab";

// ---------------------------------------------------------------------------
// The destination picker shared by the two flows that need somewhere to put
// work: moving one item out of a sprint, and carrying a whole sprint's
// spillover at close time.
//
// Both used to dead-end identically — with no other open sprint the move
// button was hidden entirely and the close dialog could only offer "leave them
// here". That's the moment a team most needs the next sprint to exist, so both
// now offer to create it inline, with every field derived from the sprint
// you're standing in (see lib/sprints/next-sprint).
// ---------------------------------------------------------------------------

const NONE = "none";
const NEW = "__new__";

export type SprintTargetSelection =
  | { kind: "none" }
  | { kind: "existing"; sprintId: string }
  | { kind: "new"; spec: NewSprintSpec };

/** The unselected/leave-it state both dialogs start in. */
export const NO_TARGET: SprintTargetSelection = { kind: "none" };

/**
 * Whether the selection can be submitted. "none" counts as ready only where
 * it's a real choice (the close flow's "leave them here"), never in the move
 * flow where it just means nothing is picked yet.
 */
export function isTargetSelectionReady(value: SprintTargetSelection, allowNone: boolean): boolean {
  if (value.kind === "none") return allowNone;
  if (value.kind === "existing") return true;
  return isNewSprintSpecReady(value.spec);
}

/** The started sprint a selection points at, if any — the callers' "needs a reason" test. */
export function selectedTargetHasStarted(
  value: SprintTargetSelection,
  targets: SpilloverTarget[]
): boolean {
  // A sprint created here is always planned, so only an existing one can have
  // a commitment to answer to.
  if (value.kind !== "existing") return false;
  return Boolean(targets.find((t) => t.id === value.sprintId)?.startedAt);
}

export function SprintTargetPicker({
  sprint,
  targets,
  value,
  onChange,
  allowNone,
  noneLabel,
  label,
  existingLabel,
}: {
  /** The sprint being moved out of / closed — the cadence the defaults follow. */
  sprint: { name: string; startDate: string; endDate: string };
  targets: SpilloverTarget[];
  value: SprintTargetSelection;
  onChange: (next: SprintTargetSelection) => void;
  /** True in the close flow, where "leave them here" is a legitimate outcome. */
  allowNone: boolean;
  noneLabel?: string;
  label: string;
  /** Renders each existing target's row; defaults to "Name (start → end)". */
  existingLabel?: (target: SpilloverTarget) => string;
}) {
  const selectValue = value.kind === "existing" ? value.sprintId : value.kind === "new" ? NEW : allowNone ? NONE : "";

  function handleSelect(next: string) {
    if (next === NONE) return onChange({ kind: "none" });
    // Seed the form with the derived defaults so the common case is a
    // confirmation rather than four empty fields.
    if (next === NEW) return onChange({ kind: "new", spec: deriveNextSprint(sprint) });
    onChange({ kind: "existing", sprintId: next });
  }

  function patchSpec(patch: Partial<NewSprintSpec>) {
    if (value.kind !== "new") return;
    onChange({ kind: "new", spec: { ...value.spec, ...patch } });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">{label}</Label>
        <Select value={selectValue} onValueChange={handleSelect}>
          <SelectTrigger>
            <SelectValue placeholder="Pick a sprint…" />
          </SelectTrigger>
          <SelectContent>
            {allowNone && <SelectItem value={NONE}>{noneLabel ?? "Leave them here"}</SelectItem>}
            {targets.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {existingLabel
                  ? existingLabel(t)
                  : `${t.name} (${t.startDate} → ${t.endDate})${t.startedAt ? " — active" : ""}`}
              </SelectItem>
            ))}
            <SelectItem value={NEW}>
              {targets.length === 0 ? "Create the next sprint…" : "＋ Create a new sprint…"}
            </SelectItem>
          </SelectContent>
        </Select>
        {targets.length === 0 && value.kind === "none" && (
          <p className="text-[11px] text-muted-foreground">
            No other open sprint exists yet — create the next one and it lands there.
          </p>
        )}
      </div>

      {value.kind === "new" && (
        <div className="space-y-2 rounded-md border border-border bg-muted/20 p-2.5">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Sprint name</Label>
            <Input
              value={value.spec.name}
              onChange={(e) => patchSpec({ name: e.target.value })}
              placeholder={`e.g. the one after ${sprint.name}`}
              autoFocus={!value.spec.name}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Start date</Label>
              <Input
                type="date"
                value={value.spec.startDate}
                onChange={(e) => patchSpec({ startDate: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">End date</Label>
              <Input type="date" value={value.spec.endDate} onChange={(e) => patchSpec({ endDate: e.target.value })} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Starts the day after “{sprint.name}” ends and runs the same length. It&rsquo;s created as{" "}
            <strong>planned</strong>, so nothing is committed until you start it.
          </p>
          {value.spec.endDate < value.spec.startDate && (
            <p className="text-[11px] text-red-600 dark:text-red-400">End date must not be before the start date.</p>
          )}
        </div>
      )}
    </div>
  );
}
