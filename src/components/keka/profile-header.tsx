"use client";

import { useEffect, useState } from "react";
import type { KekaProfile } from "@/app/api/keka/profile/route";

function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function tenureLabel(days: number | null): string | null {
  if (days == null) return null;
  if (days <= 90) return "New joiner";
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  if (years >= 1) return `${years}y${months ? ` ${months}m` : ""} at company`;
  return `${months}m at company`;
}

/**
 * Compact org-context banner sourced from the Keka directory (job title,
 * department, reporting line, tenure). Renders nothing when the person has no
 * current Keka record, so non-employees / unmatched emails don't get an empty
 * card. Pass `email` for a specific person; omit it for the signed-in user.
 */
export function KekaProfileHeader({ email }: { email?: string }) {
  const [profile, setProfile] = useState<KekaProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    const qs = email ? `?email=${encodeURIComponent(email)}` : "";
    fetch(`/api/keka/profile${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p: KekaProfile | null) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [email]);

  if (!profile || !profile.found) return null;

  const name = profile.displayName ?? profile.email;
  const tenure = tenureLabel(profile.tenureDays);
  const bits: string[] = [];
  if (profile.department) bits.push(profile.department);
  if (tenure) bits.push(tenure);

  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-100 to-zinc-50 text-sm font-bold text-zinc-500 dark:from-zinc-800 dark:to-zinc-900">
        {initials(name)}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {name}
          </span>
          {profile.jobTitle && (
            <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {profile.jobTitle}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500 dark:text-zinc-400">
          {bits.map((b, i) => (
            <span key={b} className="flex items-center gap-2">
              {i > 0 && <span className="text-zinc-300 dark:text-zinc-600">·</span>}
              {b}
            </span>
          ))}
          {profile.managerName && (
            <>
              {bits.length > 0 && (
                <span className="text-zinc-300 dark:text-zinc-600">·</span>
              )}
              <span
                title={
                  profile.managerChain.length > 1
                    ? profile.managerChain.join(" → ")
                    : undefined
                }
              >
                Reports to {profile.managerName}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
