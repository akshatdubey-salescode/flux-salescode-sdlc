"use client";

import { createContext, Fragment, useContext, useMemo } from "react";
import { cn } from "@/lib/utils";
import { richSegments, type LinkContext, type StateKind } from "./rich-text";

const LinkCtx = createContext<LinkContext>({ jiraBaseUrl: null });

/** Gives every `Linkified` below it the Jira base URL (the page sets it once; nothing is drilled through props). */
export function LinkProvider({ jiraBaseUrl, children }: { jiraBaseUrl: string | null; children: React.ReactNode }) {
  const value = useMemo(() => ({ jiraBaseUrl }), [jiraBaseUrl]);
  return <LinkCtx.Provider value={value}>{children}</LinkCtx.Provider>;
}

/** Each state has its own font and colour (light and dark), the same everywhere the words appear. */
const STATE_CLASS: Record<StateKind, string> = {
  done: "font-semibold text-emerald-700 dark:text-emerald-400",
  notdone: "text-[0.9em] font-bold uppercase tracking-wider text-red-700 dark:text-red-400",
  na: "text-[0.9em] italic text-muted-foreground",
  yesno: "font-medium text-sky-700 dark:text-sky-400",
  unknown: "italic text-amber-700 underline decoration-dotted underline-offset-2 dark:text-amber-400",
};

/** A state word (Done, NOT DONE, N/A, Yes / No, unknown + its owner as a muted tag). React text only. */
export function StateWord({ state, owner, children }: { state: StateKind; owner?: string | null; children: React.ReactNode }) {
  return (
    <span data-state={state} className={cn("whitespace-nowrap", STATE_CLASS[state])}>
      {state === "unknown" && owner ? (
        <>
          unknown <span className="ml-0.5 rounded bg-muted px-1 text-[0.85em] not-italic text-muted-foreground no-underline">{owner}</span>
        </>
      ) : (
        children
      )}
    </span>
  );
}

const LINK_CLASS = "text-blue-600 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring dark:text-blue-400";

/**
 * Text from a review comment with its Jira keys, GitHub PR references and URLs as links (new tab, noopener) and its state words styled.
 * The text is only ever rendered as React text nodes: there is no HTML anywhere in it.
 */
export function Linkified({ text, className }: { text: string; className?: string }) {
  const ctx = useContext(LinkCtx);
  const segs = useMemo(() => richSegments(text, ctx), [text, ctx]);
  const parts = segs.map((s, i) => {
    if (s.type === "text") return <Fragment key={i}>{s.text}</Fragment>;
    if (s.type === "state")
      return (
        <StateWord key={i} state={s.state} owner={s.owner}>
          {s.text}
        </StateWord>
      );
    return (
      <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS} data-link={s.type}>
        {s.text}
      </a>
    );
  });
  // No wrapper element unless asked for: the text stays directly inside its cell or paragraph.
  return className ? <span className={className}>{parts}</span> : <>{parts}</>;
}
