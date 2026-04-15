"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  RiSparklingLine,
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCheckLine,
  RiLoader4Line,
  RiFileList3Line,
  RiInformationLine,
} from "@remixicon/react";

type Project = {
  id: string;
  name: string;
  jiraProjectKey: string;
};

type Citation = {
  id: string;
  title: string;
  snippet: string;
  relevance_score: number;
};

type GeneratedRequirement = {
  title: string;
  description: string;
  acceptanceCriteria: string;
  charjanContext: {
    answer: string;
    citations: Citation[];
  };
};

const PRIORITIES = ["low", "medium", "high", "critical"] as const;
type Priority = (typeof PRIORITIES)[number];

export function RequirementBuilderForm({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 state
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [roughIdea, setRoughIdea] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");

  // Step 2 state
  const [generated, setGenerated] = useState<GeneratedRequirement | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [citationsOpen, setCitationsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Step 3 state
  const [savedId, setSavedId] = useState("");

  async function handleGenerate() {
    if (!selectedProjectId || !roughIdea.trim()) return;
    setGenerating(true);
    setGenerateError("");

    try {
      const res = await fetch("/api/requirements/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId, roughIdea }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      const data: GeneratedRequirement = await res.json();
      setGenerated(data);
      setTitle(data.title);
      setDescription(data.description);
      setAcceptanceCriteria(data.acceptanceCriteria);
      setStep(2);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave(status: "draft" | "published") {
    setSaving(true);
    setSaveError("");

    try {
      const res = await fetch("/api/requirements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: selectedProjectId,
          title,
          description,
          acceptanceCriteria,
          priority,
          status,
          charjanContext: generated?.charjanContext,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Save failed (${res.status})`);
      }

      const saved = await res.json();
      setSavedId(saved.id);
      setStep(3);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <div className="max-w-3xl mx-auto">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {[
          { n: 1, label: "Describe" },
          { n: 2, label: "Review" },
          { n: 3, label: "Done" },
        ].map(({ n, label }, i) => (
          <div key={n} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className={`h-px w-12 ${step > i ? "bg-zinc-900 dark:bg-zinc-100" : "bg-zinc-200 dark:bg-zinc-700"}`}
              />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={`flex size-6 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                  step === n
                    ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                    : step > n
                      ? "bg-emerald-500 text-white"
                      : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
                }`}
              >
                {step > n ? <RiCheckLine size={12} /> : n}
              </div>
              <span
                className={`text-sm font-medium ${step === n ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-400 dark:text-zinc-500"}`}
              >
                {label}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Step 1: Project + rough idea */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-1">
              Describe your requirement
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Select a project and describe what you want to build. Charjan will analyze the
              codebase and generate a detailed requirement for you.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Project
              </label>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500"
              >
                <option value="">Select a project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.jiraProjectKey}] {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                What do you want to build?
              </label>
              <textarea
                value={roughIdea}
                onChange={(e) => setRoughIdea(e.target.value)}
                placeholder="e.g. Add a notification system that alerts users when their Jira issues breach an SLA threshold"
                rows={4}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500 resize-none"
              />
              <p className="mt-1.5 text-xs text-zinc-400">
                1–3 sentences is enough. Charjan will use the codebase to fill in the details.
              </p>
            </div>
          </div>

          {generateError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {generateError}
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={!selectedProjectId || !roughIdea.trim() || generating}
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {generating ? (
              <>
                <RiLoader4Line className="animate-spin" size={16} />
                Analyzing codebase…
              </>
            ) : (
              <>
                <RiSparklingLine size={16} />
                Generate Requirement
              </>
            )}
          </button>
        </div>
      )}

      {/* Step 2: Review & edit */}
      {step === 2 && generated && (
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-1">
                Review & edit
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Charjan generated this requirement based on the{" "}
                <span className="font-medium">{selectedProject?.name}</span> codebase. Edit
                as needed before saving.
              </p>
            </div>
            <button
              onClick={() => { setStep(1); setGenerateError(""); }}
              className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <RiArrowLeftLine size={14} />
              Back
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={8}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500 resize-y"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Acceptance Criteria
              </label>
              <textarea
                value={acceptanceCriteria}
                onChange={(e) => setAcceptanceCriteria(e.target.value)}
                rows={6}
                placeholder="- [ ] Criterion 1&#10;- [ ] Criterion 2"
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-mono text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500 resize-y"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Priority
              </label>
              <div className="flex gap-2">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPriority(p)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                      priority === p
                        ? priorityActiveClass(p)
                        : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Citations */}
            {generated.charjanContext.citations.length > 0 && (
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
                <button
                  onClick={() => setCitationsOpen((o) => !o)}
                  className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/50"
                >
                  <span className="flex items-center gap-2">
                    <RiInformationLine size={15} className="text-zinc-400" />
                    Sources ({generated.charjanContext.citations.length} from codebase)
                  </span>
                  <RiArrowRightLine
                    size={14}
                    className={`text-zinc-400 transition-transform ${citationsOpen ? "rotate-90" : ""}`}
                  />
                </button>
                {citationsOpen && (
                  <div className="border-t border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-800">
                    {generated.charjanContext.citations.map((c) => (
                      <div key={c.id} className="px-4 py-3">
                        <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                          {c.title}
                          <span className="ml-2 font-normal text-zinc-400">
                            {Math.round(c.relevance_score * 100)}% match
                          </span>
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-3">
                          {c.snippet}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {saveError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {saveError}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={() => handleSave("published")}
              disabled={!title.trim() || !description.trim() || saving}
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {saving ? (
                <RiLoader4Line className="animate-spin" size={16} />
              ) : (
                <RiArrowRightLine size={16} />
              )}
              Publish
            </button>
            <button
              onClick={() => handleSave("draft")}
              disabled={!title.trim() || !description.trim() || saving}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Save as Draft
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
            >
              <RiSparklingLine size={13} />
              Regenerate
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Done */}
      {step === 3 && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-6">
          <div className="flex size-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
            <RiCheckLine size={32} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
              Requirement saved
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Your requirement has been saved and is ready to hand to developers.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/requirements")}
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <RiFileList3Line size={16} />
              View all requirements
            </button>
            <button
              onClick={() => {
                setStep(1);
                setRoughIdea("");
                setSelectedProjectId("");
                setGenerated(null);
                setSavedId("");
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <RiSparklingLine size={16} />
              Build another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function priorityActiveClass(p: Priority): string {
  switch (p) {
    case "low":
      return "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400";
    case "medium":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    case "high":
      return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400";
    case "critical":
      return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  }
}
