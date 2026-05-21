"use client";

import { useActionState } from "react";
import { submitFeatureRequest, type SubmitFeatureRequestState } from "./actions";

const initialState: SubmitFeatureRequestState = {};

export function FeatureRequestForm() {
  const [state, action, isPending] = useActionState<
    SubmitFeatureRequestState,
    FormData
  >(submitFeatureRequest, initialState);

  if (state.success) {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 px-6 py-8 text-center dark:border-green-800 dark:bg-green-950/40">
        <p className="text-base font-medium text-green-800 dark:text-green-300">
          Request submitted — thank you!
        </p>
        <p className="mt-1 text-sm text-green-700 dark:text-green-400">
          We&apos;ve recorded your idea. The team will review it and may reach
          out if they need more context.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      {state.error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
          {state.error}
        </div>
      )}

      <Field
        name="title"
        label="Feature title"
        placeholder="e.g. Bulk export issues to CSV"
        required
      />

      <TextareaField
        name="description"
        label="Description"
        placeholder="Describe the feature in as much detail as you can. What should it do? How should it behave?"
        rows={5}
        required
      />

      <TextareaField
        name="useCaseProblem"
        label="Problem or use case"
        placeholder="What problem does this solve for you? Describe the situation where you'd use this. (optional)"
        rows={3}
      />

      <div className="space-y-1.5">
        <label
          htmlFor="priority"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          How important is this to you?
        </label>
        <select
          id="priority"
          name="priority"
          defaultValue="medium"
          className="flex h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus-visible:ring-zinc-300"
        >
          <option value="low">Nice to have</option>
          <option value="medium">Important</option>
          <option value="high">Critical — blocking my work</option>
        </select>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex h-9 w-full items-center justify-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {isPending ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}

function Field({
  name,
  label,
  placeholder,
  required,
}: {
  name: string;
  label: string;
  placeholder?: string;
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
        type="text"
        placeholder={placeholder}
        required={required}
        className="flex h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus-visible:ring-zinc-300"
      />
    </div>
  );
}

function TextareaField({
  name,
  label,
  placeholder,
  rows = 4,
  required,
}: {
  name: string;
  label: string;
  placeholder?: string;
  rows?: number;
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
      <textarea
        id={name}
        name={name}
        placeholder={placeholder}
        rows={rows}
        required={required}
        className="flex w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus-visible:ring-zinc-300"
      />
    </div>
  );
}
