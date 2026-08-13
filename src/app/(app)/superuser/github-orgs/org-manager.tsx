"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  RiAddLine,
  RiAppsLine,
  RiCloseLine,
  RiDeleteBin2Line,
  RiGitRepositoryLine,
  RiGithubLine,
  RiKey2Line,
} from "@remixicon/react";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  addGithubOrg,
  addManualRepo,
  deleteGithubOrg,
  removeManualRepo,
  revertGithubOrgToPat,
  saveGithubAppCredentials,
  setGithubOrgActive,
  setGithubOrgAppAuth,
  updateGithubOrgToken,
  type DiscoveryMode,
} from "./actions";

export type OrgRow = {
  id: string;
  login: string;
  isActive: boolean;
  authMode: string;
  appInstallationId: string | null;
  discoveryMode: string;
  lastSyncedAt: Date | null;
  repoCount: number;
  // Populated for manual orgs only (auto orgs have hundreds — not listed here).
  repos: { id: string; fullName: string }[];
};

export function OrgManager({ orgs, hasAppCredentials }: { orgs: OrgRow[]; hasAppCredentials: boolean }) {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<DiscoveryMode>("auto");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAdd() {
    setError(null);
    startTransition(async () => {
      const res = await addGithubOrg(login, token, mode);
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

        {/* Discovery mode */}
        <div className="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
          <ModeTab active={mode === "auto"} onClick={() => setMode("auto")} disabled={isPending}>
            Whole org
          </ModeTab>
          <ModeTab active={mode === "manual"} onClick={() => setMode("manual")} disabled={isPending}>
            Specific repos
          </ModeTab>
        </div>

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
            placeholder={mode === "manual" ? "personal PAT (github_pat_…)" : "fine-grained PAT (github_pat_…)"}
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

        {mode === "auto" ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            The PAT must have <span className="font-medium">Contents: read</span> and{" "}
            <span className="font-medium">Metadata: read</span> on the org&apos;s repos, and be able
            to list the org. It&apos;s validated against GitHub and stored encrypted. Re-adding an
            existing org rotates its token.
          </p>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            For an org you have <span className="font-medium">no org-wide PAT</span> for. Paste a
            personal PAT with <span className="font-medium">Contents + Metadata: read</span> on the
            specific repos you can access. We only check the token is valid here; after adding, use{" "}
            <span className="font-medium">Manage repos</span> to register each{" "}
            <span className="font-mono">owner/repo</span> by name.
          </p>
        )}
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <GithubAppCard hasAppCredentials={hasAppCredentials} />

      {/* Org list */}
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
        {orgs.length === 0 ? (
          <div className="p-5 text-sm text-zinc-500 dark:text-zinc-400">
            No organisations yet. Add one above to start syncing.
          </div>
        ) : (
          orgs.map((org) => (
            <OrgRowItem key={org.id} org={org} pending={isPending} hasAppCredentials={hasAppCredentials} />
          ))
        )}
      </div>
    </div>
  );
}

/** Configure the one shared GitHub App every authMode='app' org installs. */
function GithubAppCard({ hasAppCredentials }: { hasAppCredentials: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [appId, setAppId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveGithubAppCredentials(appId, privateKey);
      if (res.error) {
        setError(res.error);
        return;
      }
      setAppId("");
      setPrivateKey("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 flex items-center gap-3">
      <RiAppsLine className="size-5 shrink-0 text-zinc-400" />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">GitHub App</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {hasAppCredentials
            ? "Configured. Orgs can switch to it below — no per-person PAT to keep alive."
            : "Not configured yet — orgs below can only use PATs until this is set."}
        </p>
      </div>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setAppId(""); setPrivateKey(""); setError(null); } }}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="shrink-0">
            {hasAppCredentials ? "Rotate key" : "Configure"}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>GitHub App credentials</DialogTitle>
            <DialogDescription>
              From the App&apos;s settings page on GitHub: the App ID and a generated private key
              (.pem). Stored encrypted. Rotating this invalidates every org&apos;s cached
              installation token — they re-mint automatically on next use.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="App ID (e.g. 123456)"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            disabled={isPending}
            className="font-mono"
          />
          <Textarea
            placeholder={"-----BEGIN RSA PRIVATE KEY-----\n…\n-----END RSA PRIVATE KEY-----"}
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            disabled={isPending}
            rows={6}
            className="font-mono text-xs"
          />
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <DialogFooter>
            <Button onClick={save} disabled={isPending || !appId.trim() || !privateKey.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50",
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      )}
    >
      {children}
    </button>
  );
}

function OrgRowItem({
  org, pending, hasAppCredentials,
}: {
  org: OrgRow;
  pending: boolean;
  hasAppCredentials: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const busy = pending || isPending;
  const isManual = org.discoveryMode === "manual";
  const isAppAuth = org.authMode === "app";

  // Edit-credential dialog state — rotates a PAT when authMode='pat', or
  // switches back to one when authMode='app' (revertGithubOrgToPat).
  const [tokenOpen, setTokenOpen] = useState(false);
  const [newToken, setNewToken] = useState("");
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Switch-to-App dialog state (only reachable from authMode='pat').
  // Defaults to 'auto', not the org's current mode — an App installed with
  // "All repositories" only auto-tracks new repos when the org is 'auto'
  // too, and that's the whole point of migrating, so nudge toward it rather
  // than silently carrying over a 'manual' org's old limitation.
  const [appOpen, setAppOpen] = useState(false);
  const [installationId, setInstallationId] = useState("");
  const [appDiscoveryMode, setAppDiscoveryMode] = useState<DiscoveryMode>("auto");
  const [appError, setAppError] = useState<string | null>(null);

  function toggle() {
    startTransition(async () => {
      await setGithubOrgActive(org.id, !org.isActive);
      router.refresh();
    });
  }

  function saveToken() {
    setTokenError(null);
    startTransition(async () => {
      const res = isAppAuth
        ? await revertGithubOrgToPat(org.id, newToken)
        : await updateGithubOrgToken(org.id, newToken);
      if (res.error) {
        setTokenError(res.error);
        return;
      }
      setNewToken("");
      setTokenOpen(false);
      router.refresh();
    });
  }

  function switchToApp() {
    setAppError(null);
    startTransition(async () => {
      const res = await setGithubOrgAppAuth(org.id, installationId, appDiscoveryMode);
      if (res.error) {
        setAppError(res.error);
        return;
      }
      setInstallationId("");
      setAppDiscoveryMode("auto");
      setAppOpen(false);
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
        <span className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          <span className="truncate">{org.login}</span>
          <Badge
            variant="secondary"
            className={cn(
              "shrink-0",
              isManual
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                : "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"
            )}
          >
            {isManual ? "Manual" : "Auto"}
          </Badge>
          <Badge
            variant="secondary"
            className={cn(
              "shrink-0",
              isAppAuth
                ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
            )}
          >
            {isAppAuth ? "App" : "PAT"}
          </Badge>
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

      {isManual && <ManageReposDialog org={org} disabled={busy} />}

      <Button variant="outline" size="sm" onClick={toggle} disabled={busy} className="shrink-0">
        {org.isActive ? "Pause" : "Resume"}
      </Button>

      {!isAppAuth && (
        <Dialog
          open={appOpen}
          onOpenChange={(o) => {
            setAppOpen(o);
            if (!o) {
              setInstallationId("");
              setAppDiscoveryMode("auto");
              setAppError(null);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !hasAppCredentials}
              className="shrink-0 gap-1.5"
              title={hasAppCredentials ? "Switch to GitHub App auth" : "Configure the GitHub App above first"}
            >
              <RiAppsLine className="size-4" />
              App
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Switch {org.login} to GitHub App auth</DialogTitle>
              <DialogDescription>
                Install the shared GitHub App on <span className="font-medium">{org.login}</span> first
                (with &quot;All repositories&quot; for auto-discovery of new repos), then paste its
                Installation ID here. Verified against GitHub before saving; replaces the stored PAT.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Repo discovery</p>
              <div className="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
                <ModeTab
                  active={appDiscoveryMode === "auto"}
                  onClick={() => setAppDiscoveryMode("auto")}
                  disabled={busy}
                >
                  Whole org
                </ModeTab>
                <ModeTab
                  active={appDiscoveryMode === "manual"}
                  onClick={() => setAppDiscoveryMode("manual")}
                  disabled={busy}
                >
                  Specific repos
                </ModeTab>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {appDiscoveryMode === "auto"
                  ? "Recommended when installed with \"All repositories\" — new repos in this org are tracked automatically, no manual step."
                  : "Only if the installation is scoped to specific repos — new repos still need registering by hand under \"Repos\"."}
              </p>
            </div>

            <Input
              placeholder="Installation ID (e.g. 12345678)"
              value={installationId}
              onChange={(e) => setInstallationId(e.target.value)}
              disabled={busy}
              className="font-mono"
            />
            {appError && <p className="text-xs text-red-600 dark:text-red-400">{appError}</p>}
            <DialogFooter>
              <Button onClick={switchToApp} disabled={busy || !installationId.trim()}>
                Switch to App
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

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
            title={isAppAuth ? "Switch back to a PAT" : "Update token"}
          >
            <RiKey2Line className="size-4" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isAppAuth ? `Switch ${org.login} back to a PAT` : `Update token for ${org.login}`}
            </DialogTitle>
            <DialogDescription>
              {isAppAuth ? (
                <>
                  Paste a PAT for <span className="font-medium">{org.login}</span> to stop using the
                  GitHub App installation and go back to a token-based org.
                </>
              ) : (
                <>
                  Paste a new {isManual ? "personal" : "fine-grained"} PAT for{" "}
                  <span className="font-medium">{org.login}</span>. It needs{" "}
                  <span className="font-medium">Contents: read</span> and{" "}
                  <span className="font-medium">Metadata: read</span>
                  {isManual
                    ? " on the repos you track, and replaces the stored token for all of them."
                    : ", is validated against GitHub, and replaces the stored token for every repo in this org."}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            placeholder="PAT (github_pat_…)"
            value={newToken}
            onChange={(e) => setNewToken(e.target.value)}
            disabled={busy}
            className="font-mono"
          />
          {tokenError && <p className="text-xs text-red-600 dark:text-red-400">{tokenError}</p>}
          <DialogFooter>
            <Button onClick={saveToken} disabled={busy || !newToken}>
              {isAppAuth ? "Switch to PAT" : "Update token"}
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

/** Add/list/remove the repos tracked under a manual-discovery org. */
function ManageReposDialog({ org, disabled }: { org: OrgRow; disabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function add() {
    setError(null);
    startTransition(async () => {
      const res = await addManualRepo(org.id, fullName);
      if (res.error) {
        setError(res.error);
        return;
      }
      setFullName("");
      router.refresh();
    });
  }

  function remove(repoId: string) {
    setError(null);
    startTransition(async () => {
      const res = await removeManualRepo(repoId);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setFullName(""); setError(null); } }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className="shrink-0 gap-1.5">
          <RiGitRepositoryLine className="size-4" />
          Repos
          <span className="text-zinc-400">({org.repos.length})</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Repos for {org.login}</DialogTitle>
          <DialogDescription>
            Register repos by <span className="font-mono">owner/repo</span>. Each is verified
            against this org&apos;s token, then synced like any tracked repo. Removing one deletes
            its stored stats.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            placeholder="owner/repo"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && fullName.trim() && !isPending) add();
            }}
            disabled={isPending}
            className="font-mono"
          />
          <Button onClick={add} disabled={isPending || !fullName.trim()} className="shrink-0 gap-1.5">
            <RiAddLine className="size-4" />
            Add
          </Button>
        </div>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="max-h-64 overflow-y-auto rounded-lg border border-zinc-200 divide-y divide-zinc-100 dark:border-zinc-800 dark:divide-zinc-800">
          {org.repos.length === 0 ? (
            <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
              No repos registered yet. Add one above.
            </div>
          ) : (
            org.repos.map((repo) => (
              <div key={repo.id} className="flex items-center gap-2 px-3 py-2">
                <RiGitRepositoryLine className="size-4 shrink-0 text-zinc-400" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-700 dark:text-zinc-300">
                  {repo.fullName}
                </span>
                <button
                  type="button"
                  onClick={() => remove(repo.id)}
                  disabled={isPending}
                  aria-label={`Remove ${repo.fullName}`}
                  className="rounded-sm text-zinc-400 hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
                >
                  <RiCloseLine className="size-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
