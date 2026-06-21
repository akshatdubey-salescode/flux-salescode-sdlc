"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  RiAddLine,
  RiUserLine,
  RiDeleteBin6Line,
  RiUserAddLine,
  RiSearchLine,
  RiSettings3Line,
} from "@remixicon/react";
import { TeamTimelineClient } from "@/components/observer/team-timeline-client";
import { BugTracker } from "@/components/bug-summary";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ObserverBoard, ObserverBoardMember } from "@/lib/db/schema";

type Member = ObserverBoardMember;
type Board = ObserverBoard;
type KnownDev = { email: string; name: string; jira_account_id: string | null };

type Props = {
  board: Board;
  initialMembers: Member[];
  isOwner: boolean;
};

export function BoardDetailClient({ board, initialMembers, isOwner }: Props) {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [removeMember, setRemoveMember] = useState<Member | null>(null);
  const [searchName, setSearchName] = useState("");
  const [searchEmail, setSearchEmail] = useState("");
  const [knownDevs, setKnownDevs] = useState<KnownDev[]>([]);
  const [filteredDevs, setFilteredDevs] = useState<KnownDev[]>([]);
  const [saving, setSaving] = useState(false);
  const [boardName, setBoardName] = useState(board.name);
  const [boardDescription, setBoardDescription] = useState(board.description ?? "");
  const [boardManagerName, setBoardManagerName] = useState(board.managerName ?? "");
  const [boardManagerEmail, setBoardManagerEmail] = useState(board.managerEmail ?? "");
  const [boardSaving, setBoardSaving] = useState(false);

  async function handleSaveBoard() {
    setBoardSaving(true);
    try {
      const res = await fetch(`/api/observer/boards/${board.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: boardName.trim(),
          description: boardDescription.trim() || undefined,
          managerName: boardManagerName.trim() || undefined,
          managerEmail: boardManagerEmail.trim() || undefined,
        }),
      });
      if (res.ok) {
        setSettingsOpen(false);
        router.refresh();
      }
    } finally {
      setBoardSaving(false);
    }
  }

  async function loadKnownDevs(query: string) {
    const res = await fetch(
      `/api/observer/developers?q=${encodeURIComponent(query)}&limit=20`
    );
    if (res.ok) {
      const data = await res.json();
      setKnownDevs(data);
      filterDevs(data, query);
    }
  }

  function filterDevs(devs: KnownDev[], query: string) {
    const existing = new Set(members.map((m) => m.email));
    setFilteredDevs(devs.filter((d) => !existing.has(d.email)));
  }

  function handleSearchChange(q: string) {
    setSearchName(q);
    if (q.trim()) {
      loadKnownDevs(q.trim());
    } else {
      setFilteredDevs([]);
    }
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
      const found = knownDevs.find(
        (d) => d.email === searchEmail.toLowerCase().trim()
      );
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
        toast.error(err.error ?? "Failed to add member");
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


  return (
    <>
      <div className="max-w-6xl mx-auto">
        {/* Board header */}
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {board.name}
            </h1>
            {board.description && (
              <p className="text-sm text-muted-foreground mt-1">{board.description}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {members.length} {members.length === 1 ? "member" : "members"}
            </p>
          </div>
          {isOwner && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSettingsOpen(true);
                loadKnownDevs("");
              }}
              className="gap-1.5 shrink-0"
            >
              <RiSettings3Line size={14} />
              Manage Team
            </Button>
          )}
        </div>

        {members.length === 0 ? (
          <EmptyMembersState
            isOwner={isOwner}
            onAdd={() => {
              setSettingsOpen(true);
              loadKnownDevs("");
            }}
          />
        ) : (
          <Tabs defaultValue="timeline" className="w-full space-y-4">
            <TabsList>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="bugs">Bugs</TabsTrigger>
            </TabsList>
            <TabsContent value="timeline" className="outline-none">
              <TeamTimelineClient
                boardId={board.id}
                name={board.name}
                onRemoveMember={isOwner
                  ? (email) => setRemoveMember(members.find((m) => m.email === email) ?? null)
                  : undefined
                }
              />
            </TabsContent>
            <TabsContent value="bugs" className="outline-none">
              <BugTracker
                dataUrl={`/api/observer/boards/${board.id}/bugs`}
                exportTitle={board.name}
                showProject
              />
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Manage Team sheet */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent className="w-[400px] sm:w-[440px] flex flex-col p-0 gap-0" closeButtonClassName="top-2.5">
          {/* Header */}
          <div className="px-4 py-3 border-b border-border shrink-0">
            <SheetHeader className="p-0">
              <SheetTitle className="text-sm font-semibold">Manage Team</SheetTitle>
            </SheetHeader>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
            {/* Board details */}
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="board-details" className="border-none">
                <AccordionTrigger className="py-0 hover:no-underline">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Board Details</p>
                </AccordionTrigger>
                <AccordionContent className="pt-4 pb-0">
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor="sheet-board-name" className="text-xs">Name</Label>
                      <Input
                        id="sheet-board-name"
                        value={boardName}
                        onChange={(e) => setBoardName(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="sheet-board-desc" className="text-xs">Description</Label>
                      <Textarea
                        id="sheet-board-desc"
                        value={boardDescription}
                        onChange={(e) => setBoardDescription(e.target.value)}
                        rows={2}
                        className="text-sm resize-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor="sheet-mgr-name" className="text-xs">Manager name</Label>
                        <Input
                          id="sheet-mgr-name"
                          value={boardManagerName}
                          onChange={(e) => setBoardManagerName(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="sheet-mgr-email" className="text-xs">Manager email</Label>
                        <Input
                          id="sheet-mgr-email"
                          type="email"
                          value={boardManagerEmail}
                          onChange={(e) => setBoardManagerEmail(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={handleSaveBoard}
                      disabled={!boardName.trim() || boardSaving}
                      className="h-7 text-xs px-3"
                    >
                      {boardSaving ? "Saving…" : "Save Changes"}
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {/* Members list */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Members</p>
                  <span className="text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                    {members.length}
                  </span>
                </div>
                <button
                  onClick={() => {
                    setSearchName("");
                    setSearchEmail("");
                    setFilteredDevs([]);
                    setAddOpen(true);
                    loadKnownDevs("");
                  }}
                  className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 bg-primary/8 hover:bg-primary/12 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <RiUserAddLine size={13} />
                  Add member
                </button>
              </div>

              {members.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 rounded-xl border border-dashed border-border text-center">
                  <div className="size-9 rounded-full bg-muted flex items-center justify-center mb-2">
                    <RiUserLine size={16} className="text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground">No members added yet.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
                  {members.map((member) => {
                    const initials = member.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase()
                      .slice(0, 2);
                    const colors = [
                      "from-violet-400 to-indigo-400",
                      "from-emerald-400 to-teal-400",
                      "from-amber-400 to-orange-400",
                      "from-pink-400 to-rose-400",
                      "from-sky-400 to-blue-400",
                      "from-fuchsia-400 to-purple-400",
                    ];
                    const color = colors[member.email.charCodeAt(0) % colors.length];

                    return (
                      <div
                        key={member.id}
                        className="group flex items-center justify-between gap-3 px-4 py-3 bg-card hover:bg-muted/40 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`size-8 rounded-full bg-gradient-to-br ${color} flex items-center justify-center text-[11px] font-bold text-white shrink-0 shadow-sm`}>
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-foreground truncate leading-tight">
                              {member.name}
                            </p>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {member.email}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => setRemoveMember(member)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-destructive transition-all shrink-0"
                          title="Remove from board"
                        >
                          <RiDeleteBin6Line size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

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
                <RiSearchLine
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
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
                        <p className="text-xs text-muted-foreground truncate">
                          {dev.email}
                        </p>
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
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
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
      <AlertDialog
        open={!!removeMember}
        onOpenChange={(o) => !o && setRemoveMember(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeMember?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove them from this board. You can always add them
              back later.
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

function EmptyMembersState({ isOwner, onAdd }: { isOwner: boolean; onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-8 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 mb-4">
        <RiUserLine size={22} className="text-primary" />
      </div>
      <h3 className="text-base font-semibold text-foreground mb-2">
        No members yet
      </h3>
      <p className="text-sm text-muted-foreground max-w-xs mb-5">
        {isOwner
          ? "Add team members to start tracking their Jira workload and timeline."
          : "The board owner hasn't added any members yet."}
      </p>
      {isOwner && (
        <Button size="sm" onClick={onAdd} className="gap-1.5">
          <RiAddLine size={14} />
          Add First Member
        </Button>
      )}
    </div>
  );
}
