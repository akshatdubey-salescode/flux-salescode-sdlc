"use client";

import { useActionState } from "react";
import { createProject, type CreateProjectState } from "./actions";

const initialState: CreateProjectState = {};

export function CreateProjectForm() {
  const [state, action, isPending] = useActionState<
    CreateProjectState,
    FormData
  >(createProject, initialState);

  return (
    <form action={action} className="space-y-5">
      {state.error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
          {state.error}
        </div>
      )}

      <Field
        name="jiraBaseUrl"
        label="Jira Base URL"
        placeholder="https://your-org.atlassian.net"
        type="url"
        required
      />

      <Field
        name="jiraProjectKey"
        label="Project Key"
        placeholder="SC"
        hint="The short identifier shown before issue numbers, e.g. SC in SC-123."
        required
      />

      <Field
        name="jiraEmail"
        label="Jira Account Email"
        placeholder="you@salescode.ai"
        type="email"
        required
      />

      <Field
        name="jiraApiToken"
        label="API Token"
        placeholder="Paste your Jira API token"
        type="password"
        hint={
          <>
            Generate at{" "}
            <a
              href="https://id.atlassian.com/manage-profile/security/api-tokens"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              id.atlassian.com
            </a>
          </>
        }
        required
      />

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex h-9 w-full items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {isPending ? "Connecting & syncing…" : "Add project"}
      </button>
    </form>
  );
}

function Field({
  name,
  label,
  placeholder,
  type = "text",
  hint,
  required,
}: {
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  hint?: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={name}
        className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
      >
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        className="flex h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus-visible:ring-zinc-300"
      />
      {hint && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
      )}
    </div>
  );
}
