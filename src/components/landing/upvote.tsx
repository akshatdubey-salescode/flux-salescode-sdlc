"use client";

import { RiArrowUpSLine } from "@remixicon/react";
import { useState } from "react";

/** Discover's upvote, as a toy: press it and the count rolls by one. */
export function Upvote({ count }: { count: number }) {
  const [on, setOn] = useState(false);
  const value = count + (on ? 1 : 0);
  return (
    <button
      type="button"
      className="lp-upvote"
      data-on={on || undefined}
      aria-pressed={on}
      aria-label={on ? "Remove upvote" : "Upvote"}
      onClick={() => setOn((v) => !v)}
    >
      <RiArrowUpSLine size={16} aria-hidden />
      <span className="lp-upvote__count" key={value}>
        {value}
      </span>
    </button>
  );
}
