"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  RiSparklingLine,
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCheckLine,
  RiLoader4Line,
  RiRefreshLine,
  RiAlertLine,
  RiFolderLine,
  RiGoogleLine,
  RiArrowDownSLine,
  RiCloseLine,
} from "@remixicon/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const SALESCODE_TOKEN_KEY = "salescode_access_token";
const SALESCODE_TOKEN_EXPIRY_KEY = "salescode_token_expiry";

function getSalescodeToken(): string | null {
  if (typeof window === "undefined") return null;
  const expiry = sessionStorage.getItem(SALESCODE_TOKEN_EXPIRY_KEY);
  if (expiry && Date.now() >= parseInt(expiry)) {
    sessionStorage.removeItem(SALESCODE_TOKEN_KEY);
    sessionStorage.removeItem(SALESCODE_TOKEN_EXPIRY_KEY);
    return null;
  }
  return sessionStorage.getItem(SALESCODE_TOKEN_KEY);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type GitHubRepo = {
  id: number;
  name: string;
  fullName: string;
  description: string;
  language: string;
};

type Draft = {
  title: string;
  description: string;
  acceptanceCriteria: string;
  priority: "low" | "medium" | "high" | "critical";
};

const FALLBACK_AI_URL = "http://localhost:3000/agents";

// ─── Component ────────────────────────────────────────────────────────────────

export function RequirementBuilderForm() {
  const router = useRouter();
  const [salescodeToken, setSalescodeToken] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);

  // Repos
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]); // fullNames

  // Session launch
  const [launching, setLaunching] = useState(false);
  const [sessionLaunched, setSessionLaunched] = useState(false);
  const [launchError, setLaunchError] = useState("");

  // iframe
  const [iframeSrc, setIframeSrc] = useState(FALLBACK_AI_URL);
  const [iframeKey, setIframeKey] = useState(0);
  const [iframeLoadFailed, setIframeLoadFailed] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Step 2 draft
  const [draft, setDraft] = useState<Draft>({
    title: "",
    description: "",
    acceptanceCriteria: "",
    priority: "medium",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // ── Read Salescode token from sessionStorage ───────────────────────────────
  useEffect(() => {
    setSalescodeToken(getSalescodeToken());
  }, []);

  // ── Fetch GitHub repos ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/github/repos")
      .then((r) => r.json())
      .then((data: GitHubRepo[]) => {
        if (Array.isArray(data)) setRepos(data);
      })
      .catch(() => {})
      .finally(() => setReposLoading(false));
  }, []);

  // ── Listen for CHARJAN_TICKET_FINALIZED from iframe ────────────────────────
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type !== "CHARJAN_TICKET_FINALIZED") return;
      const { title, description, acceptanceCriteria } = event.data.ticket ?? {};
      setDraft((prev) => ({
        ...prev,
        title: title || prev.title,
        description: description || prev.description,
        acceptanceCriteria: acceptanceCriteria || prev.acceptanceCriteria,
      }));
      setStep(2);
      window.removeEventListener("message", handler);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // ── Launch AI session ──────────────────────────────────────────────────────
  const launchSession = useCallback(async () => {
    if (selectedRepos.length === 0) return;
    setLaunching(true);
    setLaunchError("");

    try {
      const token = getSalescodeToken();
      if (!token) {
        window.location.href = `/api/auth/salescode/initiate?redirectBack=${encodeURIComponent(window.location.pathname)}`;
        return;
      }

      const res = await fetch("/api/ai-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_names: selectedRepos, access_token: token }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (err.error === "SALESCODE_AUTH_REQUIRED") {
          window.location.href = `/api/auth/salescode/initiate?redirectBack=${encodeURIComponent(window.location.pathname)}`;
          return;
        }
        setLaunchError(err.error ?? `Failed to launch (${res.status})`);
        return;
      }

      const { conversation_url, api_key, tenant_id } = await res.json();

      const aiHost = (process.env.NEXT_PUBLIC_AI_BUILDER_URL ?? FALLBACK_AI_URL).replace(
        /\/agents.*$/,
        ""
      );
      const sep = conversation_url.includes("?") ? "&" : "?";
      const encodedKey = btoa(api_key);
      const url = `${aiHost}${conversation_url}${sep}apiKey=${encodeURIComponent(encodedKey)}&tenantId=${encodeURIComponent(tenant_id)}`;

      setIframeSrc(url);
      setIframeKey((k) => k + 1);
      setIframeLoadFailed(false);
      setSessionLaunched(true);
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLaunching(false);
    }
  }, [selectedRepos]);

  // ── Save requirement ───────────────────────────────────────────────────────
  const saveRequirement = useCallback(
    async (status: "draft" | "published") => {
      setSaving(true);
      setSaveError("");

      try {
        const res = await fetch("/api/requirements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            githubRepoName: selectedRepos[0] || "",
            title: draft.title || "Untitled Requirement",
            description: draft.description,
            acceptanceCriteria: draft.acceptanceCriteria || undefined,
            priority: draft.priority,
            status,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setSaveError(err.error ?? `Save failed (${res.status})`);
          return;
        }

        router.push("/requirements");
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setSaving(false);
      }
    },
    [selectedRepos, draft, router]
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Step tabs */}
      <div className="flex items-center gap-2">
        {(
          [
            { id: 1, label: "AI Builder", icon: RiSparklingLine },
            { id: 2, label: "Publish", icon: RiCheckLine },
          ] as const
        ).map(({ id, label, icon: Icon }, i) => {
          const isActive = step === id;
          const isDone = step > id;
          return (
            <div key={id} className="flex items-center gap-2 flex-1">
              <button
                onClick={() => setStep(id)}
                className={`flex items-center justify-center gap-2 w-full rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : isDone
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
                      : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
                }`}
              >
                {isDone ? <RiCheckLine size={15} /> : <Icon size={15} />}
                {label}
              </button>
              {i === 0 && (
                <RiArrowRightLine size={14} className="text-zinc-300 dark:text-zinc-600 shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Step 1: Select repos + iframe ── */}
      {step === 1 && (
        <div className="space-y-5">
          {/* Repo selector */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5 space-y-4">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-400">
              <RiFolderLine size={16} />
              Repository
            </label>

            {reposLoading ? (
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <RiLoader4Line className="animate-spin" size={14} />
                Loading repos…
              </div>
            ) : (
              <MultiSelect
                label="Select Repositories"
                options={repos.map((repo) => ({
                  value: repo.fullName,
                  label: `${repo.name}${repo.language ? ` (${repo.language})` : ""}`,
                }))}
                selected={selectedRepos}
                onChange={setSelectedRepos}
              />
            )}
          </div>

          {/* Salescode auth banner — shown until a valid dev-auth token is present */}
          {!salescodeToken && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-5 py-4 flex items-center justify-between gap-4">
              <p className="text-sm text-amber-800 dark:text-amber-300">
                Sign in with your Salescode Google account to launch the AI Builder.
              </p>
              <button
                onClick={() => {
                  window.location.href = `/api/auth/salescode/initiate?redirectBack=${encodeURIComponent(window.location.pathname)}`;
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-white border border-amber-300 px-4 py-2 text-sm font-medium text-amber-900 shadow-sm hover:bg-amber-50 dark:bg-zinc-900 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-zinc-800 shrink-0"
              >
                <RiGoogleLine size={15} />
                Sign in with Google
              </button>
            </div>
          )}

          {/* Launch button */}
          <div className="flex justify-end">
            <button
              onClick={launchSession}
              disabled={launching || selectedRepos.length === 0 || !salescodeToken}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {launching ? (
                <RiLoader4Line className="animate-spin" size={16} />
              ) : (
                <RiSparklingLine size={16} />
              )}
              {sessionLaunched ? "Relaunch AI Builder" : "Launch AI Builder"}
            </button>
          </div>

          {launchError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {launchError}
            </div>
          )}

          {/* Charjan iframe */}
          {sessionLaunched && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
              <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <RiSparklingLine size={14} className="text-zinc-500" />
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    AI Requirement Builder
                  </span>
                </div>
                <button
                  onClick={() => {
                    setIframeLoadFailed(false);
                    setIframeKey((k) => k + 1);
                  }}
                  className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                >
                  <RiRefreshLine size={13} />
                  Reload
                </button>
              </div>

              {iframeLoadFailed ? (
                <div className="flex flex-col items-center justify-center h-[600px] gap-4 text-center px-8">
                  <RiAlertLine size={32} className="text-amber-400" />
                  <div>
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                      Could not load the AI builder
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Make sure your charjan instance is reachable.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setIframeLoadFailed(false);
                      setIframeKey((k) => k + 1);
                    }}
                    className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    <RiRefreshLine size={14} />
                    Try Again
                  </button>
                </div>
              ) : (
                <iframe
                  key={iframeKey}
                  ref={iframeRef}
                  src={iframeSrc}
                  onError={() => setIframeLoadFailed(true)}
                  className="w-full border-0"
                  style={{ height: "600px" }}
                  allow="clipboard-read; clipboard-write"
                  title="AI Requirement Builder"
                />
              )}
            </div>
          )}

          {/* Manual next */}
          <div className="flex justify-end">
            <button
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Next: Publish
              <RiArrowRightLine size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Review & publish ── */}
      {step === 2 && (
        <div className="space-y-5">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-400">
              Requirement Details
            </h2>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Requirement title"
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Description <span className="text-red-500">*</span>
              </label>
              <textarea
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                rows={6}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 resize-y"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Acceptance Criteria
              </label>
              <textarea
                value={draft.acceptanceCriteria}
                onChange={(e) => setDraft({ ...draft, acceptanceCriteria: e.target.value })}
                rows={4}
                placeholder="- [ ] Given… When… Then…"
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-mono text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 resize-y"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Priority
              </label>
              <select
                value={draft.priority}
                onChange={(e) =>
                  setDraft({ ...draft, priority: e.target.value as Draft["priority"] })
                }
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          {/* Selected repo summary */}
          {selectedRepos.length > 0 && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-widest text-zinc-400 mb-2">
                Saving to
              </p>
              <div className="flex flex-wrap gap-2">
                {selectedRepos.map((repo) => (
                  <span
                    key={repo}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    <RiFolderLine size={13} className="text-zinc-400" />
                    {repo}
                  </span>
                ))}
              </div>
              {selectedRepos.length > 1 && (
                <p className="mt-2 text-[10px] text-zinc-500">
                  Note: The requirement will be associated with {selectedRepos[0]} in the database.
                </p>
              )}
            </div>
          )}

          {saveError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {saveError}
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              <RiArrowLeftLine size={14} />
              Back
            </button>

            <div className="flex items-center gap-3">
              <button
                onClick={() => saveRequirement("draft")}
                disabled={!draft.title || !draft.description || saving || selectedRepos.length === 0}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-5 py-2.5 text-sm font-semibold text-foreground shadow-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <RiLoader4Line className="animate-spin" size={15} /> : null}
                Save as Draft
              </button>
              <button
                onClick={() => saveRequirement("published")}
                disabled={!draft.title || !draft.description || saving || selectedRepos.length === 0}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <RiLoader4Line className="animate-spin" size={15} /> : <RiCheckLine size={15} />}
                Publish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  const hasSelection = selected.length > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex w-full min-h-[42px] items-center justify-between gap-2 rounded-xl border px-4 py-2 text-sm transition-all",
            hasSelection
              ? "border-primary bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 shadow-sm"
              : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-600"
          )}
        >
          <div className="flex flex-wrap gap-1.5 items-center">
            {!hasSelection && label}
            {selected.map((val) => {
              const opt = options.find((o) => o.value === val);
              return (
                <span
                  key={val}
                  className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300"
                >
                  {opt?.label || val}
                  <RiCloseLine
                    className="size-3 cursor-pointer hover:text-red-500"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(val);
                    }}
                  />
                </span>
              );
            })}
          </div>
          <RiArrowDownSLine className="size-4 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[400px] p-0" sideOffset={8}>
        <div className="max-h-80 overflow-y-auto py-2">
          {options.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-zinc-400">
              No repositories found
            </p>
          ) : (
            options.map((opt) => (
              <label
                key={opt.value}
                className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt.value)}
                  onChange={() => toggle(opt.value)}
                  className="size-4 rounded border-zinc-300 bg-white text-primary focus:ring-primary dark:border-zinc-700 dark:bg-zinc-900"
                />
                <span className="flex-1 truncate text-zinc-700 dark:text-zinc-300">
                  {opt.label}
                </span>
                {selected.includes(opt.value) && (
                  <RiCheckLine size={16} className="text-primary" />
                )}
              </label>
            ))
          )}
        </div>
        {hasSelection && (
          <div className="border-t border-zinc-100 dark:border-zinc-800 px-4 py-2 flex justify-between">
            <button
              onClick={() => onChange([])}
              className="text-xs font-medium text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Clear all
            </button>
            <p className="text-[10px] text-zinc-400 flex items-center">
              {selected.length} selected
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
