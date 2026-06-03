"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RiCheckLine, RiFileCopyLine, RiLink, RiCloseLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { setFreshdeskCompanyId } from "@/app/(app)/superuser/freshdesk/actions";

export type FreshdeskProjectRow = {
  id: string;
  name: string;
  jiraProjectKey: string;
  freshdeskCompanyId: string | null;
  webhookUrl: string;
};

function WebhookDialog({ project }: { project: FreshdeskProjectRow }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!project.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(project.webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs">
          <RiLink className="size-3.5" />
          Webhook
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Freshdesk webhook — {project.name}</DialogTitle>
          <DialogDescription>
            Add this URL to a Freshdesk automation rule (Admin → Workflows →
            Automations) so ticket changes push to this project in real time. The
            rule must send the same ticket-field payload CavinKare&apos;s rule uses.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 font-mono text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              {project.webhookUrl || "Webhook secret unavailable for this project."}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={copy}
              disabled={!project.webhookUrl}
              className="shrink-0 gap-1.5"
            >
              {copied ? <RiCheckLine className="size-3.5" /> : <RiFileCopyLine className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            The URL embeds the project&apos;s webhook secret — treat it like a credential.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProjectRow({ project }: { project: FreshdeskProjectRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(project.freshdeskCompanyId ?? "");
  const enabled = project.freshdeskCompanyId != null;
  const dirty = value.trim() !== (project.freshdeskCompanyId ?? "");

  function save(nextValue: string) {
    startTransition(async () => {
      const result = await setFreshdeskCompanyId(project.id, nextValue);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        nextValue.trim() === ""
          ? `Freshdesk disabled for "${project.name}".`
          : `"${project.name}" mapped to company ${nextValue.trim()}.`
      );
      router.refresh();
    });
  }

  return (
    <tr className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
      <td className="px-4 py-3">
        <div className="font-medium text-zinc-800 dark:text-zinc-200">{project.name}</div>
        <code className="text-xs font-mono text-zinc-400">{project.jiraProjectKey}</code>
      </td>
      <td className="px-4 py-3">
        {enabled ? (
          <Badge variant="default" className="gap-1">
            <RiCheckLine className="size-3" />
            Enabled
          </Badge>
        ) : (
          <Badge variant="outline" className="text-zinc-400">Disabled</Badge>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dirty && !isPending) save(value);
            }}
            placeholder="Company ID"
            inputMode="numeric"
            disabled={isPending}
            className="h-8 w-40 font-mono text-xs"
          />
          <Button
            size="sm"
            className="h-8"
            disabled={!dirty || isPending}
            onClick={() => save(value)}
          >
            {isPending ? "Saving…" : "Save"}
          </Button>
          {enabled && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-zinc-400 hover:text-red-600"
              title="Disable Freshdesk for this project"
              disabled={isPending}
              onClick={() => { setValue(""); save(""); }}
            >
              <RiCloseLine className="size-4" />
            </Button>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        {enabled && <WebhookDialog project={project} />}
      </td>
    </tr>
  );
}

export function FreshdeskIntegrationPanel({ projects }: { projects: FreshdeskProjectRow[] }) {
  const [query, setQuery] = useState("");
  const filtered = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(query.toLowerCase()) ||
      p.jiraProjectKey.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="space-y-3">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search projects…"
        className="h-9 max-w-xs"
      />
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/80">
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">Project</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">Status</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">Freshdesk Company ID</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-zinc-400">
                  No projects match &ldquo;{query}&rdquo;.
                </td>
              </tr>
            ) : (
              filtered.map((p) => <ProjectRow key={p.id} project={p} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
