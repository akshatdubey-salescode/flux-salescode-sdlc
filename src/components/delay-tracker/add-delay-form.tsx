"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { localDateStr } from "@/lib/date-utils";
import {
  DELAY_CATEGORIES,
  OTHER_PROJECT_CATEGORIES,
  PERSON_REQUIRED_CATEGORIES,
  type DelayCategoryValue,
} from "@/lib/delay-tracker/categories";
import { PersonPicker } from "./person-picker";
import { LinkedIssuePicker, type LinkedIssue } from "./linked-issue-picker";
import type { DelayLogEntry } from "@/app/api/delay-tracker/issue/[issueId]/route";

export function AddDelayForm({
  issueId,
  projectId,
  defaultResponsible,
  onCreated,
}: {
  issueId: string;
  projectId: string;
  defaultResponsible: { email: string | null; name: string | null };
  onCreated: (entry: DelayLogEntry) => void;
}) {
  const [category, setCategory] = useState<DelayCategoryValue | "">("");
  const [delayDate, setDelayDate] = useState(localDateStr(new Date()));
  // Starts unset — only auto-filled with the issue's default owner once a
  // category that actually needs a responsible person is picked (below), so
  // categories that don't need one default to None instead of silently
  // inheriting the issue owner. Once the user touches this field themselves
  // (including explicitly choosing "None"), later category changes leave
  // their choice alone.
  const [responsible, setResponsible] = useState<{ email: string; name: string } | null>(null);
  const [responsibleTouched, setResponsibleTouched] = useState(false);
  const [linked, setLinked] = useState<LinkedIssue | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsLink = category ? OTHER_PROJECT_CATEGORIES.has(category) : false;
  const needsResponsible = category ? PERSON_REQUIRED_CATEGORIES.has(category) : false;
  const canSubmit =
    !!category && !!delayDate && (!needsLink || !!linked) && (!needsResponsible || !!responsible) && !submitting;

  function handleCategoryChange(v: DelayCategoryValue) {
    setCategory(v);
    if (responsibleTouched) return;
    setResponsible(
      PERSON_REQUIRED_CATEGORIES.has(v) && defaultResponsible.email
        ? { email: defaultResponsible.email, name: defaultResponsible.name ?? defaultResponsible.email }
        : null
    );
  }

  function handleResponsibleChange(p: { email: string; name: string } | null) {
    setResponsible(p);
    setResponsibleTouched(true);
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/delay-tracker/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueId,
          category,
          delayDate,
          responsibleEmail: responsible?.email ?? null,
          responsibleName: responsible?.name ?? null,
          note: note.trim() || null,
          linkedProjectId: needsLink ? linked?.projectId : null,
          linkedIssueId: needsLink ? linked?.issueId : null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { log } = await res.json();
      onCreated(log as DelayLogEntry);
      setCategory("");
      setNote("");
      setLinked(null);
      setDelayDate(localDateStr(new Date()));
      setResponsible(null);
      setResponsibleTouched(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to log delay");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Reason</Label>
          <Select value={category} onValueChange={(v) => handleCategoryChange(v as DelayCategoryValue)}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="Select reason…" />
            </SelectTrigger>
            <SelectContent>
              {DELAY_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Date</Label>
          <Input
            type="date"
            value={delayDate}
            max={localDateStr(new Date())}
            onChange={(e) => setDelayDate(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Responsible person</Label>
        <PersonPicker value={responsible} onChange={handleResponsibleChange} allowClear />
        {needsResponsible && !responsible && (
          <p className="text-[11px] text-destructive">A responsible person is required for this reason.</p>
        )}
      </div>

      {needsLink && (
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Linked project + issue</Label>
          <LinkedIssuePicker
            value={linked}
            onChange={setLinked}
            excludedProjectId={projectId}
          />
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">Message (optional context for later understanding)</Label>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Any extra detail worth remembering…"
          className="min-h-16 text-xs"
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <Button size="sm" onClick={handleSubmit} disabled={!canSubmit} className="w-full">
        {submitting ? "Logging…" : "Log delay"}
      </Button>
    </div>
  );
}
