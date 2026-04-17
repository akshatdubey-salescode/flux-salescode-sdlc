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
  RiGoogleLine,
  RiBriefcaseLine,
} from "@remixicon/react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MarkdownEditor, splitContent } from "@/components/ui/markdown-editor";

const SALESCODE_TOKEN_KEY = "salescode_access_token";
const SALESCODE_TOKEN_EXPIRY_KEY = "salescode_token_expiry";

function getSalescodeToken(): string | null {
  if (typeof window === "undefined") return null;
  const expiry = localStorage.getItem(SALESCODE_TOKEN_EXPIRY_KEY);
  if (expiry && Date.now() >= parseInt(expiry)) {
    localStorage.removeItem(SALESCODE_TOKEN_KEY);
    localStorage.removeItem(SALESCODE_TOKEN_EXPIRY_KEY);
    return null;
  }
  return localStorage.getItem(SALESCODE_TOKEN_KEY);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type PlatformProject = {
  id: string;
  name: string;
  jiraProjectKey: string;
};

type Draft = {
  title: string;
  content: string;
};

const FALLBACK_AI_URL = "http://localhost:3000/agents";

// ─── Description cleaner ──────────────────────────────────────────────────────
// Strips artifacts from the raw AI response before storing:
//   • <think>…</think> reasoning blocks
//   • Top-level "# Jira Ticket" (or any single-# heading) title line
//   • "## Title" section (title is already in its own field)
//   • "## Acceptance Criteria" section (already in acceptanceCriteria field)
//   • Redundant horizontal-rule separators
function cleanDescription(raw: string): string {
  let text = raw;

  // 1. Remove <think>...</think> blocks (reasoning model artifact)
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");

  // 2. Remove the top-level single-# heading (e.g. "# Jira Ticket")
  text = text.replace(/^#\s[^\n]*\n?/m, "");

  // 3. Remove "## Title" section up to the next ## heading or end
  text = text.replace(/^##\s+Title\b[^\n]*\n[\s\S]*?(?=\n##\s|$)/im, "");

  // 4. Remove "## Acceptance Criteria" section up to the next ## heading or end
  text = text.replace(/^##\s+Acceptance Criteria\b[^\n]*\n[\s\S]*?(?=\n##\s|$)/im, "");

  // 5. Collapse horizontal-rule separators into blank lines
  text = text.replace(/\n---+\s*\n/g, "\n\n");

  // 6. Collapse runs of 3+ blank lines
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RequirementBuilderForm() {
  const router = useRouter();
  const [salescodeToken, setSalescodeToken] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);

  // Platform projects
  const [platformProjects, setPlatformProjects] = useState<PlatformProject[]>([]);
  const [platformProjectsLoading, setPlatformProjectsLoading] = useState(true);
  const [selectedPlatformProjectId, setSelectedPlatformProjectId] = useState<string | null>(null);

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
  const [draft, setDraft] = useState<Draft>({ title: "", content: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // ── Read Salescode token from sessionStorage ───────────────────────────────
  useEffect(() => {
    setSalescodeToken(getSalescodeToken());
  }, []);

  // ── Fetch platform projects ────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data: PlatformProject[]) => {
        if (Array.isArray(data)) setPlatformProjects(data);
      })
      .catch(() => {})
      .finally(() => setPlatformProjectsLoading(false));
  }, []);

  // ── Listen for CHARJAN_TICKET_FINALIZED from iframe ────────────────────────
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type !== "CHARJAN_TICKET_FINALIZED") return;
      const { title, description, acceptanceCriteria } = event.data.ticket ?? {};
      const cleanedDesc = description ? cleanDescription(description) : "";
      const content = acceptanceCriteria
        ? `${cleanedDesc}\n\n## Acceptance Criteria\n\n${acceptanceCriteria}`
        : cleanedDesc;
      setDraft((prev) => ({
        title: title || prev.title,
        content: content || prev.content,
      }));
      setStep(2);
      window.removeEventListener("message", handler);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // ── Launch AI session ──────────────────────────────────────────────────────
  const launchSession = useCallback(async () => {
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
        body: JSON.stringify({ access_token: token }),
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

      const { api_key, tenant_id } = await res.json();

      const aiHost = (process.env.NEXT_PUBLIC_AI_BUILDER_URL ?? FALLBACK_AI_URL).replace(
        /\/agents.*$/,
        ""
      );
      const encodedKey = btoa(api_key);
      const url = `${aiHost}/agents?apiKey=${encodeURIComponent(encodedKey)}&tenantId=${encodeURIComponent(tenant_id)}&agentType=code_generation&mode=qa`;

      setIframeSrc(url);
      setIframeKey((k) => k + 1);
      setIframeLoadFailed(false);
      setSessionLaunched(true);
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLaunching(false);
    }
  }, []);

  // ── Save requirement ───────────────────────────────────────────────────────
  const saveRequirement = useCallback(
    async (status: "draft" | "published") => {
      if (!selectedPlatformProjectId) {
        setSaveError("Please select a platform project before saving.");
        return;
      }

      setSaving(true);
      setSaveError("");

      try {
        const res = await fetch("/api/requirements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jiraProjectId: selectedPlatformProjectId,
            title: draft.title || "Untitled Requirement",
            ...splitContent(draft.content),
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
    [selectedPlatformProjectId, draft, router]
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
          {/* Platform project selector */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              <RiBriefcaseLine size={13} />
              Platform Project
              <span className="ml-1 text-red-400">*</span>
            </label>

            {platformProjectsLoading ? (
              <div className="h-9 w-full animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />
            ) : platformProjects.length === 0 ? (
              <p className="text-sm text-zinc-400">
                No platform projects found. Ask a Superuser to onboard a project first.
              </p>
            ) : (
              <Select
                value={selectedPlatformProjectId ?? ""}
                onValueChange={(v) => setSelectedPlatformProjectId(v || null)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a project…" />
                </SelectTrigger>
                <SelectContent>
                  {platformProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        {p.name}
                        <span className="font-mono text-xs text-zinc-400">{p.jiraProjectKey}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              disabled={launching || !salescodeToken}
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
          <div className="space-y-4">
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

            <MarkdownEditor
              label="Content"
              required
              value={draft.content}
              onChange={(v) => setDraft({ ...draft, content: v })}
              rows={16}
              placeholder={`Describe the requirement in full...\n\nTo include acceptance criteria, add a ## Acceptance Criteria heading.`}
            />
          </div>

          {/* Context summary */}
          {selectedPlatformProjectId && (() => {
            const proj = platformProjects.find((p) => p.id === selectedPlatformProjectId);
            return proj ? (
              <div className="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-4 py-2.5">
                <RiBriefcaseLine size={13} className="text-zinc-400 shrink-0" />
                <span className="text-sm text-zinc-700 dark:text-zinc-300 font-medium">{proj.name}</span>
                <span className="ml-auto font-mono text-xs text-zinc-400">{proj.jiraProjectKey}</span>
              </div>
            ) : null;
          })()}

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
                disabled={!draft.title || !draft.content || saving || !selectedPlatformProjectId}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-5 py-2.5 text-sm font-semibold text-foreground shadow-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <RiLoader4Line className="animate-spin" size={15} /> : null}
                Save as Draft
              </button>
              <button
                onClick={() => saveRequirement("published")}
                disabled={!draft.title || !draft.content || saving || !selectedPlatformProjectId}
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

