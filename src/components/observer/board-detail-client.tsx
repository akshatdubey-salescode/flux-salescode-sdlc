"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  RiAddLine,
  RiUserLine,
  RiDeleteBin6Line,
  RiCalendarLine,
  RiCheckLine,
  RiTimeLine,
  RiListCheck3,
  RiArrowRightLine,
  RiRefreshLine,
  RiUserAddLine,
  RiSearchLine,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks } from "date-fns";
import type { ObserverBoard, ObserverBoardMember } from "@/lib/db/schema";

type Member = ObserverBoardMember;
type Board = ObserverBoard;

type Issue = {
  id: string;
  jiraKey: string;
  summary: string;
  status: string;
  statusCategory: string | null;
  issueType: string;
  priority: string | null;
  assigneeEmail: string | null;
  assigneeName: string | null;
  jiraUpdatedAt: string | null;
  jiraCreatedAt: string | null;
  projectId: string;
  projectName: string;
  projectKey: string;
};

type MemberGroup = {
  member: Member;
  issues: Issue[];
  statusCounts: Record<string, number>;
};

type KnownDev = { email: string; name: string; jira_account_id: string | null };

const DATE_PRESETS = [
  { label: "Today", value: "today" },
  { label: "This week", value: "this-week" },
  { label: "Last week", value: "last-week" },
  { label: "This month", value: "this-month" },
  { label: "All time", value: "all" },
] as const;
type DatePreset = (typeof DATE_PRESETS)[number]["value"];

function getDateRange(preset: DatePreset): { from?: string; to?: string } {
  const now = new Date();
  if (preset === "today") {
    return { from: format(now, "yyyy-MM-dd"), to: format(now, "yyyy-MM-dd") };
  }
  if (preset === "this-week") {
    return {
      from: format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      to: format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    };
  }
  if (preset === "last-week") {
    const lastWeek = subWeeks(now, 1);
    return {
      from: format(startOfWeek(lastWeek, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      to: format(endOfWeek(lastWeek, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    };
  }
  if (preset === "this-month") {
    return {
      from: format(startOfMonth(now), "yyyy-MM-dd"),
      to: format(endOfMonth(now), "yyyy-MM-dd"),
    };
  }
  return {};
}

type Props = {
  board: Board;
  initialMembers: Member[];
};

export function BoardDetailClient({ board, initialMembers }: Props) {
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [addOpen, setAddOpen] = useState(false);
  const [removeMember, setRemoveMember] = useState<Member | null>(null);
  const [searchName, setSearchName] = useState("");
  const [searchEmail, setSearchEmail] = useState("");
  const [knownDevs, setKnownDevs] = useState<KnownDev[]>([]);
  const [filteredDevs, setFilteredDevs] = useState<KnownDev[]>([]);
  const [saving, setSaving] = useState(false);
  const [groups, setGroups] = useState<MemberGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [preset, setPreset] = useState<DatePreset>("this-week");

  const fetchTasks = useCallback(async () => {
    if (members.length === 0) {
      setGroups([]);
      return;
    }
    setLoading(true);
    try {
      const range = getDateRange(preset);
      const params = new URLSearchParams();
      if (range.from) params.set("from", range.from);
      if (range.to) params.set("to", range.to);
      const url = `/api/observer/boards/${board.id}/tasks?${params}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setGroups(data);
      }
    } finally {
      setLoading(false);
    }
  }, [board.id, members, preset]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  async function loadKnownDevs(query: string) {
    if (knownDevs.length === 0) {
      const res = await fetch("/api/observer/developers");
      if (res.ok) {
        const data = await res.json();
        setKnownDevs(data);
        filterDevs(data, query);
      }
    } else {
      filterDevs(knownDevs, query);
    }
  }

  function filterDevs(devs: KnownDev[], query: string) {
    const q = query.toLowerCase();
    const existing = new Set(members.map((m) => m.email));
    setFilteredDevs(
      devs.filter(
        (d) =>
          !existing.has(d.email) &&
          (d.name.toLowerCase().includes(q) || d.email.toLowerCase().includes(q))
      )
    );
  }

  function handleSearchChange(q: string) {
    setSearchName(q);
    filterDevs(knownDevs.length > 0 ? knownDevs : [], q);
    if (knownDevs.length === 0) loadKnownDevs(q);
  }

  function selectDev(dev: KnownDev) {
    setSearchName(dev.name);
    setSearchEmail(dev.email);
    setFilteredDevs([]);
  }

  async function handleAdd() {
    if (!searchName.trim() || !searchEmail.trim()) return;
    setSaving(true);
    try {
      const found = knownDevs.find((d) => d.email === searchEmail.toLowerCase().trim());
      const res = await fetch(`/api/observer/boards/${board.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: searchName.trim(),
          email: searchEmail.trim().toLowerCase(),
          jiraAccountId: found?.jira_account_id ?? undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "Failed to add member");
        return;
      }
      const member = await res.json();
      setMembers((prev) => [...prev, member]);
      setAddOpen(false);
      setSearchName("");
      setSearchEmail("");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!removeMember) return;
    const res = await fetch(
      `/api/observer/boards/${board.id}/members/${removeMember.id}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      setMembers((prev) => prev.filter((m) => m.id !== removeMember.id));
      setGroups((prev) => prev.filter((g) => g.member.id !== removeMember.id));
    }
    setRemoveMember(null);
  }

  return (
    <>
      {/* Board header */}
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {board.name}
            </h1>
            {board.description && (
              <p className="text-sm text-zinc-500 mt-1">{board.description}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {members.length} {members.length === 1 ? "member" : "members"}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSearchName("");
              setSearchEmail("");
              setFilteredDevs([]);
              setAddOpen(true);
              loadKnownDevs("");
            }}
            className="gap-1.5 shrink-0"
          >
            <RiUserAddLine size={14} />
            Add Member
          </Button>
        </div>

        {/* Date range controls */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <RiCalendarLine size={14} />
            <span>Showing tasks updated in:</span>
          </div>
          <Tabs value={preset} onValueChange={(v) => setPreset(v as DatePreset)}>
            <TabsList className="h-8">
              {DATE_PRESETS.map((p) => (
                <TabsTrigger key={p.value} value={p.value} className="text-xs h-7 px-3">
                  {p.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchTasks}
            disabled={loading}
            className="gap-1.5 h-8 text-xs"
          >
            <RiRefreshLine size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>

        {/* Empty members state */}
        {members.length === 0 ? (
          <EmptyMembersState onAdd={() => { setAddOpen(true); loadKnownDevs(""); }} />
        ) : (
          <>
            {loading && (
              <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
                <RiRefreshLine size={16} className="animate-spin" />
                Loading tasks…
              </div>
            )}
            {!loading && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {members.map((member) => {
                  const group = groups.find((g) => g.member.id === member.id);
                  return (
                    <MemberTaskCard
                      key={member.id}
                      member={member}
                      boardId={board.id}
                      boardName={board.name}
                      group={group}
                      onRemove={() => setRemoveMember(member)}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Add member dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Team Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5 relative">
              <Label htmlFor="search-name">Search or enter name</Label>
              <div className="relative">
                <RiSearchLine size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="search-name"
                  placeholder="Search by name or email…"
                  value={searchName}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-8"
                />
              </div>
              {filteredDevs.length > 0 && (
                <div className="absolute z-50 w-full top-full mt-1 bg-popover border border-border rounded-lg shadow-md overflow-hidden max-h-48 overflow-y-auto">
                  {filteredDevs.slice(0, 8).map((dev) => (
                    <button
                      key={dev.email}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent text-left transition-colors"
                      onClick={() => selectDev(dev)}
                    >
                      <div className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold shrink-0">
                        {dev.name[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{dev.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{dev.email}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-email">Email address</Label>
              <Input
                id="member-email"
                type="email"
                placeholder="developer@company.com"
                value={searchEmail}
                onChange={(e) => setSearchEmail(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={handleAdd}
              disabled={!searchName.trim() || !searchEmail.trim() || saving}
            >
              {saving ? "Adding…" : "Add Member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirm */}
      <AlertDialog open={!!removeMember} onOpenChange={(o) => !o && setRemoveMember(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeMember?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove them from this board. You can always add them back later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleRemove}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MemberTaskCard({
  member,
  boardId,
  boardName,
  group,
  onRemove,
}: {
  member: Member;
  boardId: string;
  boardName: string;
  group: MemberGroup | undefined;
  onRemove: () => void;
}) {
  const issues = group?.issues ?? [];
  const total = issues.length;

  const todo = issues.filter((i) => isDoneCategory(i.statusCategory) === false && isInProgressCategory(i.statusCategory) === false).length;
  const inProgress = issues.filter((i) => isInProgressCategory(i.statusCategory)).length;
  const done = issues.filter((i) => isDoneCategory(i.statusCategory)).length;
  const other = total - todo - inProgress - done;

  const initials = member.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="group flex flex-col rounded-xl border border-zinc-200 bg-white transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 overflow-hidden">
      {/* Card header */}
      <div className="flex items-center gap-3 p-4 pb-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 text-primary font-semibold text-sm ring-2 ring-primary/10">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <Link
            href={`/observer/developer/${encodeURIComponent(member.email)}?boardId=${boardId}&boardName=${encodeURIComponent(boardName)}`}
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 hover:text-primary truncate block transition-colors"
          >
            {member.name}
          </Link>
          <p className="text-xs text-muted-foreground truncate">{member.email}</p>
        </div>
        <button
          onClick={onRemove}
          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
          title="Remove from board"
        >
          <RiDeleteBin6Line size={13} />
        </button>
      </div>

      {/* Stats */}
      <div className="px-4 py-2 grid grid-cols-3 gap-2 border-t border-zinc-100 dark:border-zinc-800">
        <StatPill icon={<RiListCheck3 size={11} />} label="Open" value={todo + inProgress + other} color="text-zinc-500" />
        <StatPill icon={<RiTimeLine size={11} />} label="In Progress" value={inProgress} color="text-amber-600 dark:text-amber-400" />
        <StatPill icon={<RiCheckLine size={11} />} label="Done" value={done} color="text-emerald-600 dark:text-emerald-400" />
      </div>

      {/* Total + link */}
      <div className="flex items-center justify-between px-4 py-3 mt-auto border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30">
        <span className="text-xs text-muted-foreground">
          {total} {total === 1 ? "issue" : "issues"} total
        </span>
        <Link
          href={`/observer/developer/${encodeURIComponent(member.email)}?boardId=${boardId}&boardName=${encodeURIComponent(boardName)}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Full insights <RiArrowRightLine size={11} />
        </Link>
      </div>

      {/* Recent issues preview */}
      {issues.length > 0 && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            Recent
          </p>
          {issues.slice(0, 3).map((issue) => (
            <IssueRow key={issue.id} issue={issue} />
          ))}
          {issues.length > 3 && (
            <p className="text-xs text-muted-foreground text-center pt-1">
              +{issues.length - 3} more
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StatPill({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-lg font-bold ${color}`}>{value}</span>
      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
        {icon}
        {label}
      </span>
    </div>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  const statusColor = getStatusColor(issue.statusCategory);
  const priorityColor = getPriorityColor(issue.priority);

  return (
    <div className="flex items-start gap-2 min-w-0">
      <span className={`mt-0.5 shrink-0 inline-block size-1.5 rounded-full ${statusColor}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-zinc-700 dark:text-zinc-300 truncate leading-tight">
          {issue.summary}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] font-mono text-muted-foreground">{issue.jiraKey}</span>
          {issue.priority && (
            <span className={`text-[10px] font-medium ${priorityColor}`}>{issue.priority}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function isDoneCategory(cat: string | null): boolean {
  if (!cat) return false;
  const c = cat.toLowerCase();
  return c === "done" || c === "complete" || c === "completed";
}

function isInProgressCategory(cat: string | null): boolean {
  if (!cat) return false;
  const c = cat.toLowerCase();
  return c === "in progress" || c === "indeterminate";
}

function getStatusColor(statusCategory: string | null): string {
  if (isDoneCategory(statusCategory)) return "bg-emerald-500";
  if (isInProgressCategory(statusCategory)) return "bg-amber-500";
  return "bg-zinc-400";
}

function getPriorityColor(priority: string | null): string {
  switch (priority?.toLowerCase()) {
    case "highest":
    case "critical":
      return "text-red-600 dark:text-red-400";
    case "high":
      return "text-orange-600 dark:text-orange-400";
    case "medium":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "text-muted-foreground";
  }
}

function EmptyMembersState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white px-8 py-16 text-center dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 mb-4">
        <RiUserLine size={22} className="text-primary" />
      </div>
      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
        No members yet
      </h3>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-xs mb-5">
        Add team members to start observing their tasks and productivity insights.
      </p>
      <Button size="sm" onClick={onAdd} className="gap-1.5">
        <RiAddLine size={14} />
        Add First Member
      </Button>
    </div>
  );
}
