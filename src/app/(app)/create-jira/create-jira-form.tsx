"use client";

import Link from "next/link";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  RiArrowRightLine,
  RiCheckLine,
  RiExternalLinkLine,
  RiInformationLine,
  RiRefreshLine,
  RiSettings3Line,
  RiArrowDownSLine,
  RiCalendarLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

type Project = {
  id: string;
  name: string;
  key: string;
};

type IssueType = {
  id: string;
  name: string;
  description: string;
};

type Priority = {
  id: string;
  name: string;
};

type Assignee = {
  accountId: string;
  displayName: string;
};

type JiraOptions = {
  issueTypes: IssueType[];
  priorities: Priority[];
  assignees: Assignee[];
  currentAccountId: string;
};

type DateField = {
  id: string;
  name: string;
  required: boolean;
};

type DateFields = {
  start: DateField | null;
  due: DateField | null;
};

type CreatedIssue = {
  jiraIssueKey: string;
  issueUrl: string;
};

type Props = {
  connected: boolean;
  connectionExpired: boolean;
  connectedEmail: string | null;
  projects: Project[];
};

function preferredName(values: Array<{ name: string }>, wanted: string) {
  return (
    values.find(
      ({ name }) => name.toLowerCase() === wanted.toLowerCase()
    )?.name ??
    values[0]?.name ??
    ""
  );
}

function preferredId(
  values: Array<{ id: string; name: string }>,
  wanted: string
) {
  return (
    values.find(({ name }) => name.toLowerCase() === wanted.toLowerCase())?.id ??
    values[0]?.id ??
    ""
  );
}

function assigneeOptions(options: JiraOptions): SearchableOption[] {
  const currentUser = options.assignees.find(
    (assignee) => assignee.accountId === options.currentAccountId
  );
  const otherAssignees = options.assignees.filter(
    (assignee) => assignee.accountId !== options.currentAccountId
  );

  return [
    ...(currentUser
      ? [
          {
            value: currentUser.accountId,
            label: `${currentUser.displayName} (You)`,
            searchText: `${currentUser.displayName} you me`,
          },
        ]
      : []),
    { value: "__unassigned__", label: "Unassigned" },
    ...otherAssignees.map((assignee) => ({
      value: assignee.accountId,
      label: assignee.displayName,
    })),
  ];
}

export function CreateJiraForm({
  connected,
  connectionExpired: initiallyExpired,
  connectedEmail,
  projects,
}: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLInputElement>(null);

  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [options, setOptions] = useState<JiraOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState("");
  const [issueTypeId, setIssueTypeId] = useState("");
  const [priorityName, setPriorityName] = useState("");
  const [assigneeAccountId, setAssigneeAccountId] = useState("__unassigned__");
  const [dateFields, setDateFields] = useState<DateFields | null>(null);
  const [dateFieldsLoading, setDateFieldsLoading] = useState(false);
  const [dateFieldsError, setDateFieldsError] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [labels, setLabels] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [createdIssue, setCreatedIssue] = useState<CreatedIssue | null>(null);
  const [connectionExpired, setConnectionExpired] = useState(initiallyExpired);

  useEffect(() => {
    if (!connected || !projectId) return;

    const controller = new AbortController();
    setOptionsLoading(true);
    setOptionsError("");
    setOptions(null);
    setIssueTypeId("");
    setPriorityName("");
    setAssigneeAccountId("__unassigned__");
    setDateFields(null);
    setDateFieldsLoading(false);
    setDateFieldsError("");
    setStartDate("");
    setDueDate("");

    fetch(`/api/create-jira/options?projectId=${encodeURIComponent(projectId)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          if (data.code === "ATLASSIAN_RECONNECT_REQUIRED") {
            setConnectionExpired(true);
          }
          throw new Error(data.error ?? "Could not load Jira fields.");
        }
        return data as JiraOptions;
      })
      .then((data) => {
        setOptions(data);
        setIssueTypeId(preferredId(data.issueTypes, "Task"));
        setPriorityName(preferredName(data.priorities, "P3"));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setOptionsError(
          error instanceof Error ? error.message : "Could not load Jira fields."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setOptionsLoading(false);
      });

    return () => controller.abort();
  }, [connected, projectId]);

  useEffect(() => {
    if (!connected || !projectId || !issueTypeId) return;

    const controller = new AbortController();
    setDateFieldsLoading(true);
    setDateFields(null);
    setDateFieldsError("");
    setStartDate("");
    setDueDate("");

    fetch(
      `/api/create-jira/options?projectId=${encodeURIComponent(projectId)}` +
        `&issueTypeId=${encodeURIComponent(issueTypeId)}`,
      { signal: controller.signal }
    )
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          if (data.code === "ATLASSIAN_RECONNECT_REQUIRED") {
            setConnectionExpired(true);
          }
          throw new Error(data.error ?? "Could not load scheduling fields.");
        }
        return data as { dateFields: DateFields };
      })
      .then((data) => setDateFields(data.dateFields))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDateFieldsError(
          error instanceof Error
            ? error.message
            : "Could not load scheduling fields."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setDateFieldsLoading(false);
      });

    return () => controller.abort();
  }, [connected, projectId, issueTypeId]);

  if (!connected || connectionExpired) {
    return (
      <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-[0_16px_48px_rgba(0,0,0,0.04)] sm:p-8 dark:shadow-none">
        <div className="flex max-w-2xl flex-col items-start">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#0C66E4]/10 text-sm font-bold text-[#0C66E4] ring-1 ring-[#0C66E4]/15">
            A
          </div>
          <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#0C66E4]">
            Atlassian connection
          </p>
          <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-foreground">
            {connectionExpired
              ? "Your connection needs attention"
              : "Connect Atlassian to get started"}
          </h2>
          <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
            Jiras are created with your own permissions and recorded under your
            Atlassian identity.
          </p>
          <Button
            asChild
            className="mt-6 h-10 rounded-lg bg-[#0C66E4] px-4 shadow-sm shadow-blue-600/15 hover:bg-[#0B5CC4]"
          >
            <a href="/api/atlassian/connect?redirectBack=/create-jira">
              {connectionExpired
                ? "Reconnect Atlassian"
                : "Connect Atlassian"}
              <RiArrowRightLine />
            </a>
          </Button>
          <p className="mt-3 text-[10px] text-muted-foreground">
            You can disconnect at any time from Settings.
          </p>
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/60 px-6 py-14 text-center">
        <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <RiInformationLine className="size-5" />
        </span>
        <h2 className="mt-4 text-sm font-semibold text-foreground">
          No Jira projects are available
        </h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Ask a portal administrator to add an active Jira project before
          creating an issue.
        </p>
      </div>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      submitting ||
      !projectId ||
      !issueTypeId ||
      !priorityName ||
      !summary.trim() ||
      (dateFields?.start?.required && !startDate) ||
      (dateFields?.due?.required && !dueDate)
    ) {
      return;
    }

    setSubmitting(true);
    setSubmitError("");

    try {
      const issueType = options?.issueTypes.find(
        (type) => type.id === issueTypeId
      );
      if (!issueType) {
        setSubmitError("Choose a valid Jira issue type.");
        return;
      }

      const response = await fetch("/api/create-jira", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          issueTypeId,
          issueTypeName: issueType.name,
          priorityName,
          assigneeAccountId:
            assigneeAccountId === "__unassigned__"
              ? undefined
              : assigneeAccountId,
          summary: summary.trim(),
          description: description.trim(),
          startDate: startDate || undefined,
          dueDate: dueDate || undefined,
          labels: labels
            .split(",")
            .map((label) => label.trim())
            .filter(Boolean),
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        if (data.code === "ATLASSIAN_RECONNECT_REQUIRED") {
          setConnectionExpired(true);
        }
        setSubmitError(data.error ?? "Jira could not be created.");
        return;
      }

      setCreatedIssue(data as CreatedIssue);
    } catch {
      setSubmitError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleShortcut(event: KeyboardEvent<HTMLFormElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  function createAnother() {
    setSummary("");
    setDescription("");
    setLabels("");
    setStartDate("");
    setDueDate("");
    setSubmitError("");
    setCreatedIssue(null);
    window.setTimeout(() => summaryRef.current?.focus(), 0);
  }

  if (createdIssue) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_16px_48px_rgba(0,0,0,0.04)] dark:shadow-none">
        <div className="px-6 py-12 text-center sm:px-10">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/15 dark:text-emerald-400">
          <RiCheckLine className="size-5" />
        </div>
        <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">
          Created successfully
        </p>
        <h2 className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground">
          {createdIssue.jiraIssueKey}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Your issue is live in Jira and was reported from your connected
          Atlassian account.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-lg px-4"
            onClick={createAnother}
          >
            <RiRefreshLine />
            Create another
          </Button>
          <Button asChild className="h-10 rounded-lg bg-[#0C66E4] px-4 hover:bg-[#0B5CC4]">
            <a
              href={createdIssue.issueUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Jira
              <RiExternalLinkLine />
            </a>
          </Button>
        </div>
        </div>
      </div>
    );
  }

  const selectedIssueType = options?.issueTypes.find(
    (type) => type.id === issueTypeId
  );
  const selectedTypeDescription = selectedIssueType?.description;

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onKeyDown={handleShortcut}
      className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_1px_2px_rgba(0,0,0,0.03),0_16px_48px_rgba(0,0,0,0.04)] dark:shadow-none"
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_19rem]">
      <section className="space-y-7 p-5 sm:p-7 lg:p-8">
        {submitError && (
          <div
            role="alert"
            className="rounded-xl border border-red-200/80 bg-red-50/70 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400"
          >
            {submitError}
          </div>
        )}

        <Field label="Summary" htmlFor="jira-summary" required>
          <Input
            ref={summaryRef}
            id="jira-summary"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="What needs to be done?"
            maxLength={255}
            autoFocus
            disabled={submitting}
            className="h-12 rounded-none border-0 border-b border-border bg-transparent px-0 text-lg font-medium shadow-none placeholder:text-muted-foreground/50 focus-visible:border-[#0C66E4] focus-visible:ring-0 md:text-lg dark:bg-transparent"
          />
          <p className="text-right text-[10px] tabular-nums text-muted-foreground/70">
            {summary.length}/255
          </p>
        </Field>

        <Field label="Description" htmlFor="jira-description">
          <Textarea
            id="jira-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add context, expected behaviour, links, or acceptance criteria…"
            rows={9}
            disabled={submitting}
            className="min-h-64 resize-y rounded-xl border-transparent bg-muted/40 px-4 py-3 text-sm leading-6 shadow-none focus-visible:bg-background md:text-sm dark:bg-muted/25"
          />
          <p className="text-[10px] text-muted-foreground/70">
            Markdown is supported.
          </p>
        </Field>

        <Field label="Labels" htmlFor="jira-labels" optional>
          <Input
            id="jira-labels"
            value={labels}
            onChange={(event) => setLabels(event.target.value)}
            placeholder="frontend, customer-request"
            disabled={submitting}
            className="h-10 rounded-lg bg-transparent px-3 shadow-none"
          />
          <p className="text-[10px] text-muted-foreground/70">
            Separate multiple labels with commas.
          </p>
        </Field>
      </section>

      <aside className="border-t border-border/70 bg-muted/20 p-5 sm:p-6 lg:border-l lg:border-t-0">
        <div className="mb-5">
          <p className="text-sm font-semibold text-foreground">Details</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Where this work belongs.
          </p>
        </div>
        <div className="space-y-5">
          <Field label="Project" htmlFor="jira-project" required>
            <SearchableSelect
              id="jira-project"
              value={projectId}
              onValueChange={setProjectId}
              options={projects.map((project) => ({
                value: project.id,
                label: `${project.key} · ${project.name}`,
                searchText: `${project.key} ${project.name}`,
              }))}
              placeholder="Choose project"
              searchPlaceholder="Search projects…"
              emptyMessage="No matching project."
              disabled={submitting}
            />
          </Field>

          {optionsLoading ? (
            <OptionsSkeleton />
          ) : optionsError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
              {optionsError}
            </div>
          ) : options ? (
            <>
              <Field label="Issue type" htmlFor="jira-issue-type" required>
                <SearchableSelect
                  id="jira-issue-type"
                  value={issueTypeId}
                  onValueChange={setIssueTypeId}
                  options={options.issueTypes.map((type) => ({
                    value: type.id,
                    label: type.name,
                    searchText: `${type.name} ${type.description}`,
                  }))}
                  placeholder="Choose type"
                  searchPlaceholder="Search issue types…"
                  emptyMessage="No matching issue type."
                  disabled={submitting}
                />
                {selectedTypeDescription && (
                  <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                    {selectedTypeDescription}
                  </p>
                )}
              </Field>

              <Field label="Priority" htmlFor="jira-priority" required>
                <SearchableSelect
                  id="jira-priority"
                  value={priorityName}
                  onValueChange={setPriorityName}
                  options={options.priorities.map((priority) => ({
                    value: priority.name,
                    label: priority.name,
                  }))}
                  placeholder="Choose priority"
                  searchPlaceholder="Search priorities…"
                  emptyMessage="No matching priority."
                  disabled={submitting}
                />
              </Field>

              <Field label="Assignee" htmlFor="jira-assignee" optional>
                <SearchableSelect
                  id="jira-assignee"
                  value={assigneeAccountId}
                  onValueChange={setAssigneeAccountId}
                  options={assigneeOptions(options)}
                  placeholder="Choose assignee"
                  searchPlaceholder="Search assignees…"
                  emptyMessage="No matching assignee."
                  disabled={submitting}
                />
              </Field>

              <div className="border-t border-border/70 pt-5">
                <div className="mb-4 flex items-center gap-2 text-xs font-semibold text-foreground">
                  <span className="flex size-6 items-center justify-center rounded-md bg-background text-muted-foreground ring-1 ring-border">
                    <RiCalendarLine className="size-3.5" />
                  </span>
                  Schedule
                </div>

                {dateFieldsLoading ? (
                  <DateFieldsSkeleton />
                ) : dateFieldsError ? (
                  <p className="text-[11px] leading-4 text-red-600 dark:text-red-400">
                    {dateFieldsError}
                  </p>
                ) : dateFields?.start || dateFields?.due ? (
                  <div className="space-y-4">
                    {dateFields.start && (
                      <Field
                        label={dateFields.start.name}
                        htmlFor="jira-start-date"
                        required={dateFields.start.required}
                        optional={!dateFields.start.required}
                      >
                        <Input
                          id="jira-start-date"
                          type="date"
                          value={startDate}
                          onChange={(event) => setStartDate(event.target.value)}
                          max={dueDate || undefined}
                          required={dateFields.start.required}
                          disabled={submitting}
                          className="h-10 rounded-lg bg-background px-3 shadow-none"
                        />
                      </Field>
                    )}

                    {dateFields.due && (
                      <Field
                        label={dateFields.due.name}
                        htmlFor="jira-due-date"
                        required={dateFields.due.required}
                        optional={!dateFields.due.required}
                      >
                        <Input
                          id="jira-due-date"
                          type="date"
                          value={dueDate}
                          onChange={(event) => setDueDate(event.target.value)}
                          min={startDate || undefined}
                          required={dateFields.due.required}
                          disabled={submitting}
                          className="h-10 rounded-lg bg-background px-3 shadow-none"
                        />
                      </Field>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] leading-4 text-muted-foreground">
                    This issue type has no start or due date on its Jira create
                    screen.
                  </p>
                )}
              </div>
            </>
          ) : null}
        </div>
      </aside>

      <footer className="flex flex-col gap-4 border-t border-border/70 bg-background/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7 lg:col-span-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#0C66E4]/10 text-[11px] font-bold text-[#0C66E4] ring-1 ring-[#0C66E4]/15">
            A
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              Creating as you
              <RiCheckLine className="size-3.5 text-emerald-500" />
            </div>
            <p className="truncate text-[11px] text-muted-foreground">
              {connectedEmail}
            </p>
          </div>
          <Link
            href="/settings"
            className="ml-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Manage Atlassian connection"
            aria-label="Manage Atlassian connection"
          >
            <RiSettings3Line className="size-3.5" />
          </Link>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          <p className="text-center text-[10px] text-muted-foreground">
            <kbd className="rounded border border-border bg-muted/70 px-1.5 py-0.5 font-mono">
              ⌘ Enter
            </kbd>
          </p>
          <Button
            type="submit"
            disabled={
              submitting ||
              optionsLoading ||
              Boolean(optionsError) ||
              dateFieldsLoading ||
              Boolean(dateFieldsError) ||
              !summary.trim() ||
              !issueTypeId ||
              !priorityName ||
              Boolean(dateFields?.start?.required && !startDate) ||
              Boolean(dateFields?.due?.required && !dueDate)
            }
            className="h-10 min-w-36 rounded-lg bg-[#0C66E4] px-5 text-sm shadow-sm shadow-blue-600/15 hover:bg-[#0B5CC4]"
          >
            {submitting ? (
              "Creating…"
            ) : (
              <>
                Create Jira
                <RiArrowRightLine />
              </>
            )}
          </Button>
        </div>
      </footer>
      </div>
    </form>
  );
}

type SearchableOption = {
  value: string;
  label: string;
  searchText?: string;
};

function OptionsSkeleton() {
  return (
    <div
      className="space-y-4"
      role="status"
      aria-label="Loading Jira fields"
      aria-busy="true"
    >
      {["w-16", "w-12", "w-14"].map((width, index) => (
        <div key={index} className="space-y-1.5">
          <Skeleton className={`h-3 ${width}`} />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      ))}
      <div className="border-t border-border pt-4">
        <div className="mb-3 flex items-center gap-2">
          <Skeleton className="size-3.5 rounded-sm" />
          <Skeleton className="h-3 w-16" />
        </div>
        <DateFieldsSkeleton announce={false} />
      </div>
      <span className="sr-only">Loading Jira fields…</span>
    </div>
  );
}

function DateFieldsSkeleton({ announce = true }: { announce?: boolean }) {
  return (
    <div
      className="space-y-4"
      role={announce ? "status" : undefined}
      aria-label={announce ? "Loading Jira date fields" : undefined}
      aria-busy={announce || undefined}
    >
      {[0, 1].map((index) => (
        <div key={index} className="space-y-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      ))}
      {announce && (
        <span className="sr-only">Loading Jira date fields…</span>
      )}
    </div>
  );
}

function SearchableSelect({
  id,
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled,
}: {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-options`}
          aria-haspopup="listbox"
          disabled={disabled}
          className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 text-left text-xs shadow-none outline-none transition-all hover:border-foreground/20 hover:bg-background focus-visible:border-[#0C66E4] focus-visible:ring-2 focus-visible:ring-[#0C66E4]/15 disabled:pointer-events-none disabled:opacity-50"
        >
          <span
            className={
              selected
                ? "min-w-0 flex-1 truncate text-foreground"
                : "min-w-0 flex-1 truncate text-muted-foreground"
            }
          >
            {selected?.label ?? placeholder}
          </span>
          <RiArrowDownSLine className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-64 rounded-xl p-0"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} autoFocus />
          <CommandList id={`${id}-options`}>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.searchText ?? ""}`}
                  data-checked={option.value === value}
                  onSelect={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Field({
  label,
  htmlFor,
  required,
  optional,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
      >
        {label}
        {required && <span className="text-red-500/80">*</span>}
        {optional && (
          <span className="font-normal normal-case tracking-normal text-muted-foreground/60">
            optional
          </span>
        )}
      </label>
      {children}
    </div>
  );
}
