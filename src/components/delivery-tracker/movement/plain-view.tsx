"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Linkified } from "./linkified";
import { isEmptyPlain, type Plain } from "./plain-text";

/** SQL and backticked fragments are shown in a small code style; the rest of the text is linkified as everywhere else. */
const CODE_RE = /(`[^`\n]{2,160}`|\bCREATE (?:UNIQUE )?INDEX [\w.]+ ON [\w.]+ ?\([^)]*\)|\bCREATE INDEX on [\w.]+ \([^)]*\)|\bSHOW INDEX FROM [\w.]+(?: WHERE [^;]*?\))?|\bALTER TABLE [\w.]+ [^;.]{3,120})/g;

export function Rich({ text }: { text: string }) {
  const parts = text.split(CODE_RE);
  if (parts.length === 1) return <Linkified text={text} />;
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] [overflow-wrap:anywhere]">
            {p.replace(/^`|`$/g, "")}
          </code>
        ) : (
          <Linkified key={i} text={p} />
        ),
      )}
    </>
  );
}

/** A lead sentence, up to four short points, and the rest behind "Show N more". */
export function PlainView({ plain, muted, testId }: { plain: Plain; muted?: boolean; testId?: string }) {
  const [more, setMore] = useState(false);
  if (isEmptyPlain(plain)) return null;
  return (
    <div className={cn("space-y-0.5", muted && "text-muted-foreground")} data-testid={testId}>
      {plain.lead && (
        <p className="[overflow-wrap:anywhere]">
          <Rich text={plain.lead} />
        </p>
      )}
      {(plain.bullets.length > 0 || (more && plain.more.length > 0)) && (
        <ul className="list-disc space-y-0.5 pl-4">
          {[...plain.bullets, ...(more ? plain.more : [])].map((b, i) => (
            <li key={i} className="[overflow-wrap:anywhere]">
              <Rich text={b} />
            </li>
          ))}
        </ul>
      )}
      {plain.more.length > 0 && (
        <button type="button" aria-expanded={more} onClick={() => setMore((x) => !x)} className="text-[11px] text-blue-600 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring dark:text-blue-400">
          {more ? "Show less" : `Show ${plain.more.length} more`}
        </button>
      )}
    </div>
  );
}

