"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { RiAddLine, RiDeleteBin2Line, RiGithubLine, RiKey2Line } from "@remixicon/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  addGithubOrg,
  deleteGithubOrg,
  setGithubOrgActive,
  updateGithubOrgToken,
} from "./actions";

export type OrgRow = {
  id: string;
  login: string;
  isActive: boolean;
  lastSyncedAt: Date | null;
  repoCount: number;
};

export function OrgManager({ orgs }: { orgs: OrgRow[] }) {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAdd() {
    setError(null);
    startTransition(async () => {
      const res = await addGithubOrg(login, token);
      if (res.error) {
        setError(res.error);
        return;
      }
      setLogin("");
      setToken("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Add form */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Add an organisation
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="org login (e.g. salescode-ai)"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            disabled={isPending}
            className="sm:max-w-[220px]"
          />
          <Input
            type="password"
            placeholder="fine-grained PAT (github_pat_…)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={isPending}
            className="flex-1 font-mono"
          />
          <Button onClick={handleAdd} disabled={isPending || !login || !token} className="gap-1.5 shrink-0">
            <RiAddLine className="size-4" />
            Add
          </Button>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          The PAT must have <span className="font-medium">Contents: read</span> and{" "}
          <span className="font-medium">Metadata: read</span> on the org&apos;s repos. It&apos;s
          validated against GitHub and stored encrypted. Re-adding an existing org rotates its token.
        </p>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {/* Org list */}
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
        {orgs.length === 0 ? (
          <div className="p-5 text-sm text-zinc-500 dark:text-zinc-400">
            No organisations yet. Add one above to start syncing.
          </div>
        ) : (
          orgs.map((org) => (
            <OrgRowItem key={org.id} org={org} pending={isPending} />
          ))
        )}
      </div>
    </div>
  );
}

function OrgRowItem({ org, pending }: { org: OrgRow; pending: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const busy = pending || isPending;

  // Edit-token dialog state.
  const [tokenOpen, setTokenOpen] = useState(false);
  const [newToken, setNewToken] = useState("");
  const [tokenError, setTokenError] = useState<string | null>(null);

  function toggle() {
    startTransition(async () => {
      await setGithubOrgActive(org.id, !org.isActive);
      router.refresh();
    });
  }

  function saveToken() {
    setTokenError(null);
    startTransition(async () => {
      const res = await updateGithubOrgToken(org.id, newToken);
      if (res.error) {
        setTokenError(res.error);
        return;
      }
      setNewToken("");
      setTokenOpen(false);
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      await deleteGithubOrg(org.id);
      router.refresh();
    });
  }

  return (
    <div className={cn("flex items-center gap-3 px-5 py-3", busy && "opacity-60")}>
      <RiGithubLine className="size-5 shrink-0 text-zinc-400" />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {org.login}
        </span>
        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
          {org.repoCount.toLocaleString()} repos
          {org.lastSyncedAt
            ? ` · synced ${formatDistanceToNow(new Date(org.lastSyncedAt), { addSuffix: true })}`
            : " · never synced"}
        </span>
      </div>

      <Badge
        variant="secondary"
        className={cn(
          "shrink-0",
          org.isActive
            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
        )}
      >
        {org.isActive ? "Active" : "Paused"}
      </Badge>

      <Button variant="outline" size="sm" onClick={toggle} disabled={busy} className="shrink-0">
        {org.isActive ? "Pause" : "Resume"}
      </Button>

      <Dialog
        open={tokenOpen}
        onOpenChange={(o) => {
          setTokenOpen(o);
          if (!o) {
            setNewToken("");
            setTokenError(null);
          }
        }}
      >
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            className="shrink-0 gap-1.5"
            title="Update token"
          >
            <RiKey2Line className="size-4" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update token for {org.login}</DialogTitle>
            <DialogDescription>
              Paste a new fine-grained PAT for <span className="font-medium">{org.login}</span>.
              It needs <span className="font-medium">Contents: read</span> and{" "}
              <span className="font-medium">Metadata: read</span>, is validated against GitHub,
              and replaces the stored token for every repo in this org.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            placeholder="fine-grained PAT (github_pat_…)"
            value={newToken}
            onChange={(e) => setNewToken(e.target.value)}
            disabled={busy}
            className="font-mono"
          />
          {tokenError && <p className="text-xs text-red-600 dark:text-red-400">{tokenError}</p>}
          <DialogFooter>
            <Button onClick={saveToken} disabled={busy || !newToken}>
              Update token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            className="shrink-0 gap-1.5 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:hover:bg-red-950/40"
          >
            <RiDeleteBin2Line className="size-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {org.login}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the org and <span className="font-medium">all its repos and
              contributor stats</span> from the database. The stored token is deleted too. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
