"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  RiAddLine,
  RiAlertLine,
  RiBookOpenLine,
  RiDownload2Line,
  RiFileCopyLine,
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Markdown } from "@/components/ui/markdown";
import { MultiSelect } from "@/components/ui/multi-select";
import { cn } from "@/lib/utils";
import { createApiToken, revokeApiToken } from "./actions";

export type TokenRow = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  projectIds: string[] | null;
  createdBy: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
};

export type ProjectOption = { id: string; key: string; name: string };

export type EndpointInfo = {
  scope: string;
  title: string;
  method: string;
  path: string;
  summary: string;
  projectScoped: boolean;
  docs: string;
};

const CARD =
  "rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900";

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error("Couldn't copy to the clipboard")
  );
}

function downloadMarkdown(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Deferred: revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ago(iso: string) {
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

export function TokenManager({
  tokens,
  projects,
  endpoints,
  baseUrl,
}: {
  tokens: TokenRow[];
  projects: ProjectOption[];
  endpoints: EndpointInfo[];
  baseUrl: string;
}) {
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const endpointByScope = useMemo(() => new Map(endpoints.map((e) => [e.scope, e])), [endpoints]);
  const active = tokens.filter((t) => !t.revokedAt);
  const revoked = tokens.filter((t) => t.revokedAt);

  return (
    <div className="space-y-6">
      {/* Endpoint catalogue */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Endpoints</h2>
        <div className={cn(CARD, "divide-y divide-zinc-100 dark:divide-zinc-800")}>
          {endpoints.map((e) => (
            <EndpointItem key={e.scope} endpoint={e} />
          ))}
        </div>
      </section>

      {/* Tokens */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Tokens <span className="font-normal text-zinc-500">({active.length} active)</span>
          </h2>
          <CreateTokenDialog projects={projects} endpoints={endpoints} baseUrl={baseUrl} />
        </div>
        <div className={cn(CARD, "divide-y divide-zinc-100 dark:divide-zinc-800")}>
          {tokens.length === 0 ? (
            <div className="p-5 text-sm text-zinc-500 dark:text-zinc-400">
              No tokens yet. Create one to let another app call an endpoint above.
            </div>
          ) : (
            [...active, ...revoked].map((t) => (
              <TokenItem
                key={t.id}
                token={t}
                projectById={projectById}
                endpointByScope={endpointByScope}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function EndpointItem({ endpoint: e }: { endpoint: EndpointInfo }) {
  const filename = `flux-api-${e.scope.replace(/[^a-z0-9]+/gi, "-")}.md`;
  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{e.title}</span>
          <Badge variant="outline" className="font-mono">
            {e.scope}
          </Badge>
        </div>
        <p className="font-mono text-xs text-zinc-600 dark:text-zinc-400">
          <span className="font-semibold">{e.method}</span> {e.path}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{e.summary}</p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <RiBookOpenLine className="size-4" />
              Docs
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{e.title} API</DialogTitle>
              <DialogDescription>
                Share this with the team building the other app.
              </DialogDescription>
            </DialogHeader>
            <div className="min-w-0">
              <Markdown content={e.docs} />
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => copy(e.docs, "Docs")}>
                <RiFileCopyLine className="size-4" />
                Copy markdown
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => downloadMarkdown(filename, e.docs)}>
                <RiDownload2Line className="size-4" />
                Download .md
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          title="Download docs as markdown"
          onClick={() => downloadMarkdown(filename, e.docs)}
        >
          <RiDownload2Line className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function TokenItem({
  token: t,
  projectById,
  endpointByScope,
}: {
  token: TokenRow;
  projectById: Map<string, ProjectOption>;
  endpointByScope: Map<string, EndpointInfo>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isRevoked = Boolean(t.revokedAt);

  function revoke() {
    startTransition(async () => {
      const res = await revokeApiToken(t.id);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`Revoked "${t.name}"`);
      router.refresh();
    });
  }

  return (
    <div className={cn("flex flex-col gap-3 p-4 sm:flex-row sm:items-start", isRevoked && "opacity-60")}>
      <RiKey2Line className="mt-0.5 size-4 shrink-0 text-zinc-400" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t.name}</span>
          <span className="font-mono text-xs text-zinc-500">{t.tokenPrefix}…</span>
          {isRevoked ? (
            <Badge variant="destructive">Revoked</Badge>
          ) : (
            <Badge variant="secondary">Active</Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {t.scopes.map((s) => (
            <Badge key={s} variant="outline" className="font-mono">
              {endpointByScope.get(s)?.title ?? s}
            </Badge>
          ))}
          {t.projectIds === null ? (
            <Badge variant="outline">All projects</Badge>
          ) : (
            t.projectIds.map((id) => {
              const p = projectById.get(id);
              return (
                <Badge key={id} variant="outline" title={p?.name}>
                  {p ? p.key : "deleted project"}
                </Badge>
              );
            })
          )}
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Created {ago(t.createdAt)}
          {t.createdBy ? ` by ${t.createdBy}` : ""} · {t.lastUsedAt ? `Last used ${ago(t.lastUsedAt)}` : "Never used"}
          {t.revokedAt ? ` · Revoked ${ago(t.revokedAt)}${t.revokedBy ? ` by ${t.revokedBy}` : ""}` : ""}
        </p>
      </div>
      {!isRevoked && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={isPending} className="shrink-0">
              Revoke
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke &quot;{t.name}&quot;?</AlertDialogTitle>
              <AlertDialogDescription>
                Any app using this token gets 401 errors from its next request. This can&apos;t be
                undone. Create a new token if access is needed again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={revoke}>
                Revoke token
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function CreateTokenDialog({
  projects,
  endpoints,
  baseUrl,
}: {
  projects: ProjectOption[];
  endpoints: EndpointInfo[];
  baseUrl: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(endpoints.length === 1 ? [endpoints[0].scope] : []);
  const [allProjects, setAllProjects] = useState(true);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ token: string; scopes: string[]; projectIds: string[] | null } | null>(
    null
  );
  const [isPending, startTransition] = useTransition();

  function reset() {
    setName("");
    setScopes(endpoints.length === 1 ? [endpoints[0].scope] : []);
    setAllProjects(true);
    setProjectIds([]);
    setError(null);
    setCreated(null);
  }

  function submit() {
    setError(null);
    const chosenProjects = !needsProjects || allProjects ? null : projectIds;
    startTransition(async () => {
      const res = await createApiToken({ name, scopes, projectIds: chosenProjects });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setCreated({ token: res.token, scopes, projectIds: chosenProjects });
      router.refresh();
    });
  }

  // A ready-to-run curl for the first granted endpoint, with a real project id
  // filled in where we can.
  const exampleCurl = useMemo(() => {
    if (!created) return "";
    const endpoint = endpoints.find((e) => created.scopes.includes(e.scope));
    if (!endpoint) return "";
    const projectId = created.projectIds?.[0] ?? projects[0]?.id ?? "{projectId}";
    const path = endpoint.path.replace("{projectId}", projectId);
    return `curl -H "Authorization: Bearer ${created.token}" \\\n  "${baseUrl}${path}"`;
  }, [created, endpoints, projects, baseUrl]);

  const projectOptions = useMemo(
    () => projects.map((p) => ({ value: p.id, label: `${p.key} · ${p.name}` })),
    [projects]
  );
  const needsProjects = endpoints.some((e) => scopes.includes(e.scope) && e.projectScoped);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <RiAddLine className="size-4" />
          Create token
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Token created</DialogTitle>
              <DialogDescription>Copy it now. You won&apos;t be able to see it again.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex gap-1.5">
                <Input readOnly value={created.token} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
                <Button variant="outline" className="shrink-0 gap-1.5" onClick={() => copy(created.token, "Token")}>
                  <RiFileCopyLine className="size-4" />
                  Copy
                </Button>
              </div>
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                <RiAlertLine className="mt-0.5 size-4 shrink-0" />
                <span>
                  This token never expires. Store it as a secret on the calling app&apos;s server and
                  never put it in browser or mobile code. If it leaks, revoke it here.
                </span>
              </div>
              {exampleCurl && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Try it</Label>
                    <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={() => copy(exampleCurl, "curl command")}>
                      <RiFileCopyLine className="size-3.5" />
                      Copy
                    </Button>
                  </div>
                  <pre className="overflow-x-auto whitespace-pre rounded-lg bg-zinc-100 px-3 py-2 font-mono text-xs text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                    {exampleCurl}
                  </pre>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create API token</DialogTitle>
              <DialogDescription>
                The token never expires. It works until you revoke it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="token-name">Name</Label>
                <Input
                  id="token-name"
                  placeholder="The app that will use it, e.g. Delivery dashboard"
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isPending}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Endpoints</Label>
                <div className="space-y-2">
                  {endpoints.map((e) => (
                    <label key={e.scope} className="flex cursor-pointer items-start gap-2.5">
                      <Checkbox
                        className="mt-0.5"
                        checked={scopes.includes(e.scope)}
                        disabled={isPending}
                        onCheckedChange={(checked) =>
                          setScopes((prev) =>
                            checked ? [...prev, e.scope] : prev.filter((s) => s !== e.scope)
                          )
                        }
                      />
                      <span className="space-y-0.5">
                        <span className="block text-sm text-zinc-900 dark:text-zinc-100">{e.title}</span>
                        <span className="block font-mono text-xs text-zinc-500">
                          {e.method} {e.path}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {needsProjects && (
                <div className="space-y-1.5">
                  <Label>Projects</Label>
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <Checkbox
                      checked={allProjects}
                      disabled={isPending}
                      onCheckedChange={(checked) => setAllProjects(Boolean(checked))}
                    />
                    <span className="text-sm text-zinc-900 dark:text-zinc-100">All projects</span>
                  </label>
                  {!allProjects && (
                    <MultiSelect
                      options={projectOptions}
                      defaultValue={projectIds}
                      onValueChange={setProjectIds}
                      placeholder="Pick the projects this token can read"
                      maxCount={4}
                      modalPopover
                      disabled={isPending}
                    />
                  )}
                </div>
              )}

              {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            </div>
            <DialogFooter>
              <Button
                onClick={submit}
                disabled={isPending || !name.trim() || scopes.length === 0 || (needsProjects && !allProjects && projectIds.length === 0)}
              >
                {isPending ? "Creating…" : "Create token"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
