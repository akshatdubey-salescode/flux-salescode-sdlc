"use client";

import { useState } from "react";
import {
  RiLoader4Line,
  RiExternalLinkLine,
  RiCheckLine,
  RiCloseLine,
  RiUser3Line,
  RiArrowDownSLine,
} from "@remixicon/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

type IssueType = {
  id: string;
  name: string;
  iconUrl: string;
  description: string;
};

type Assignee = {
  accountId: string;
  displayName: string;
  avatarUrl: string;
};

type Priority = {
  id: string;
  name: string;
  iconUrl: string;
};

type JiraOptions = {
  issueTypes: IssueType[];
  assignees: Assignee[];
  priorities: Priority[];
};

type Props = {
  requirementId: string;
  existingIssueKey: string | null;
  jiraBaseUrl: string;
};

type ModalState = "closed" | "loading" | "ready" | "publishing";

export function PublishToJiraButton({ requirementId, existingIssueKey, jiraBaseUrl }: Props) {
  const [modalState, setModalState] = useState<ModalState>("closed");
  const [options, setOptions] = useState<JiraOptions | null>(null);
  const [optionsError, setOptionsError] = useState("");

  const [selectedIssueType, setSelectedIssueType] = useState("");
  const [selectedPriority, setSelectedPriority] = useState("");
  const [selectedAssignee, setSelectedAssignee] = useState("");
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [issueKey, setIssueKey] = useState<string | null>(existingIssueKey);

  const issueUrl = issueKey ? `${jiraBaseUrl}/browse/${issueKey}` : null;

  async function openModal() {
    setModalState("loading");
    setOptionsError("");
    setPublishError("");

    try {
      const res = await fetch(`/api/requirements/${requirementId}/jira-options`);
      const data = await res.json();

      if (!res.ok) {
        setOptionsError(data.error ?? "Failed to load Jira options.");
        setModalState("closed");
        return;
      }

      setOptions(data);
      if (data.issueTypes?.length > 0) setSelectedIssueType(data.issueTypes[0].name);
      if (data.priorities?.length > 0) setSelectedPriority(data.priorities[0].name);
      setModalState("ready");
    } catch {
      setOptionsError("Could not reach the server.");
      setModalState("closed");
    }
  }

  async function publish() {
    if (!selectedIssueType || !selectedPriority) return;

    setModalState("publishing");
    setPublishError("");

    try {
      const res = await fetch(`/api/requirements/${requirementId}/publish-to-jira`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueTypeName: selectedIssueType,
          priorityName: selectedPriority,
          assigneeAccountId: selectedAssignee && selectedAssignee !== "__unassigned__" ? selectedAssignee : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setPublishError(data.error ?? `Failed to publish (${res.status})`);
        setModalState("ready");
        return;
      }

      setIssueKey(data.jiraIssueKey);
      setModalState("closed");
    } catch {
      setPublishError("Unexpected error. Please try again.");
      setModalState("ready");
    }
  }

  // Already published state
  if (issueKey) {
    return (
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 px-3 py-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          <RiCheckLine size={14} />
          {issueKey}
        </span>
        <a
          href={issueUrl!}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
        >
          <RiExternalLinkLine size={14} />
          View in Jira
        </a>
      </div>
    );
  }

  return (
    <>
      {/* Trigger button */}
      <div className="space-y-1.5">
        <button
          onClick={openModal}
          disabled={modalState === "loading"}
          className="inline-flex items-center gap-2 rounded-lg bg-[#0052CC] hover:bg-[#0747A6] disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white transition-colors"
        >
          {modalState === "loading" ? (
            <RiLoader4Line className="animate-spin" size={15} />
          ) : (
            <span className="font-bold text-base leading-none">A</span>
          )}
          {modalState === "loading" ? "Loading…" : "Publish to Jira"}
        </button>
        {optionsError && (
          <p className="text-xs text-red-600 dark:text-red-400">{optionsError}</p>
        )}
      </div>

      {/* Modal */}
      {(modalState === "ready" || modalState === "publishing") && options && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 dark:bg-black/60"
            onClick={() => modalState !== "publishing" && setModalState("closed")}
          />

          {/* Dialog */}
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <div className="flex size-6 items-center justify-center rounded bg-[#0052CC] text-white font-bold text-xs">
                  A
                </div>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Publish to Jira
                </h2>
              </div>
              <button
                onClick={() => setModalState("closed")}
                disabled={modalState === "publishing"}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-40"
              >
                <RiCloseLine size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              {/* Issue type */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
                  Issue type <span className="text-red-500 normal-case tracking-normal font-normal">required</span>
                </label>
                <Select
                  value={selectedIssueType}
                  onValueChange={setSelectedIssueType}
                  disabled={modalState === "publishing"}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select issue type…" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.issueTypes.map((t) => (
                      <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedIssueType && options.issueTypes.find((t) => t.name === selectedIssueType)?.description && (
                  <p className="text-xs text-zinc-400">
                    {options.issueTypes.find((t) => t.name === selectedIssueType)?.description}
                  </p>
                )}
              </div>

              {/* Priority */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
                  Priority <span className="text-red-500 normal-case tracking-normal font-normal">required</span>
                </label>
                <Select
                  value={selectedPriority}
                  onValueChange={setSelectedPriority}
                  disabled={modalState === "publishing"}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select priority…" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.priorities.map((p) => (
                      <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Assignee */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
                  Assignee <span className="text-zinc-400 normal-case tracking-normal font-normal">optional</span>
                </label>
                {options.assignees.length === 0 ? (
                  <p className="text-xs text-zinc-400 flex items-center gap-1.5">
                    <RiUser3Line size={13} />
                    No assignable users found for this project.
                  </p>
                ) : (
                  <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        disabled={modalState === "publishing"}
                        className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        <span className={selectedAssignee && selectedAssignee !== "__unassigned__" ? "text-foreground" : "text-muted-foreground"}>
                          {selectedAssignee && selectedAssignee !== "__unassigned__"
                            ? options.assignees.find((a) => a.accountId === selectedAssignee)?.displayName ?? "Unassigned"
                            : "Unassigned"}
                        </span>
                        <RiArrowDownSLine className="size-4 opacity-50 shrink-0" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[320px] p-0" align="start" sideOffset={4}>
                      <Command>
                        <CommandInput placeholder="Search assignee…" autoFocus />
                        <CommandList>
                          <CommandEmpty>No users found.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="__unassigned__"
                              onSelect={() => { setSelectedAssignee("__unassigned__"); setAssigneeOpen(false); }}
                              data-checked={!selectedAssignee || selectedAssignee === "__unassigned__"}
                            >
                              Unassigned
                            </CommandItem>
                            {options.assignees.map((a) => (
                              <CommandItem
                                key={a.accountId}
                                value={a.displayName}
                                onSelect={() => { setSelectedAssignee(a.accountId); setAssigneeOpen(false); }}
                                data-checked={selectedAssignee === a.accountId}
                              >
                                {a.displayName}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                )}
              </div>

              {publishError && (
                <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2.5 text-xs text-red-700 dark:text-red-400">
                  {publishError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-100 dark:border-zinc-800">
              <button
                onClick={() => setModalState("closed")}
                disabled={modalState === "publishing"}
                className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={publish}
                disabled={!selectedIssueType || !selectedPriority || modalState === "publishing"}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0052CC] hover:bg-[#0747A6] disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white transition-colors"
              >
                {modalState === "publishing" ? (
                  <RiLoader4Line className="animate-spin" size={14} />
                ) : (
                  <RiCheckLine size={14} />
                )}
                {modalState === "publishing" ? "Publishing…" : "Create Issue"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
