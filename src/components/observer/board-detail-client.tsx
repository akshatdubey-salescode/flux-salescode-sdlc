"use client";

import { useState, useEffect } from "react";
import {
  RiAddLine,
  RiUserLine,
  RiDeleteBin6Line,
  RiUserAddLine,
  RiSearchLine,
} from "@remixicon/react";
import { TeamPulseClient } from "@/components/observer/team-pulse-client";
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
import type { ObserverBoard, ObserverBoardMember } from "@/lib/db/schema";

type Member = ObserverBoardMember;
type Board = ObserverBoard;

type KnownDev = { email: string; name: string; jira_account_id: string | null };

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
  const [stalenessThreshold, setStalenessThreshold] = useState(board.stalenessThresholdDays);
  const [stalenessTimer, setStalenessTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (stalenessTimer) clearTimeout(stalenessTimer); };
  }, [stalenessTimer]);

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
    }
    setRemoveMember(null);
  }

  function handleStalenessChange(val: number) {
    setStalenessThreshold(val);
    if (stalenessTimer) clearTimeout(stalenessTimer);
    setStalenessTimer(
      setTimeout(() => {
        fetch(`/api/observer/boards/${board.id}/settings`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stalenessThresholdDays: val }),
        });
      }, 600)
    );
  }

  return (
    <>
      <div className="max-w-6xl mx-auto">
        {/* Board header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {board.name}
            </h1>
            {board.description && (
              <p className="text-sm text-zinc-500 mt-1">{board.description}</p>
            )}
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <p className="text-xs text-muted-foreground">
                {members.length} {members.length === 1 ? "member" : "members"}
              </p>
              <span className="text-xs text-muted-foreground">·</span>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Staleness after
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={stalenessThreshold}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 1 && v <= 90) handleStalenessChange(v);
                  }}
                  className="w-10 h-6 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-center text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-primary/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                days
              </label>
            </div>
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

        {members.length === 0 ? (
          <EmptyMembersState onAdd={() => { setAddOpen(true); loadKnownDevs(""); }} />
        ) : (
          <TeamPulseClient
            boardId={board.id}
            onRemoveMember={(email) => setRemoveMember(members.find((m) => m.email === email) ?? null)}
          />
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
