"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RiTruckLine, RiCloseLine, RiArrowDownSLine, RiAlarmWarningLine } from "@remixicon/react";
import { cn } from "@/lib/utils";
import { localDateStr } from "@/lib/date-utils";
import type { UpcomingDelivery } from "@/lib/deliveries/entries";
import type { UpcomingForMeResponse } from "@/app/api/deliveries/upcoming-for-me/route";

const DISMISS_KEY = "delivery-banner-dismissed-until";
const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000;
// How often to re-check whether the 24h dismissal has lapsed — no reload or
// relogin required, just this tab staying open past the window.
const RECHECK_INTERVAL_MS = 60 * 1000;

function readDismissedUntil(): number {
  if (typeof window === "undefined") return 0;
  return Number(window.localStorage.getItem(DISMISS_KEY)) || 0;
}

/**
 * App-wide bottom reminder banner — starts showing notifyDaysBefore days
 * before a delivery's date, for anyone named responsible or assigned to one
 * of its items, across every project at once (one banner, not one per
 * delivery — the explicit simplification). Dismissing hides it for a
 * rolling 24 hours from the moment of dismissal — re-evaluated on a timer
 * so a long-lived tab sees it reappear on schedule without needing a reload
 * or relogin — and it keeps reappearing every 24h until the delivery date
 * passes, at which point the server stops returning it.
 */
export function DeliveryBanner({ userEmail }: { userEmail: string }) {
  const [deliveries, setDeliveries] = useState<UpcomingDelivery[] | null>(null);
  // Lazy initializer reads localStorage synchronously on first render, so
  // there's no setState-in-effect for this — the effect below only ever
  // re-derives dismissed on a timer tick, never synchronously during render.
  const [dismissed, setDismissed] = useState(() => readDismissedUntil() > Date.now());
  const [expanded, setExpanded] = useState(false);

  const loadDeliveries = useCallback(() => {
    fetch("/api/deliveries/upcoming-for-me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { deliveries: [] }))
      .then((d: UpcomingForMeResponse) => setDeliveries(d.deliveries))
      .catch(() => setDeliveries([]));
  }, []);

  useEffect(() => {
    loadDeliveries();
  }, [loadDeliveries, userEmail]);

  // Tracked in a ref (not just the `dismissed` state) so the interval below
  // can read the latest value without needing to resubscribe every time it
  // changes — setDismissed itself stays a plain value-set, no side effects
  // hidden inside a state updater function.
  const dismissedRef = useRef(dismissed);
  useEffect(() => {
    dismissedRef.current = dismissed;
  }, [dismissed]);

  // Poll for the 24h dismissal window lapsing — this is what makes the
  // banner reappear on its own in a tab that's been open the whole time,
  // instead of only ever resetting on a fresh page load/relogin.
  useEffect(() => {
    const interval = setInterval(() => {
      const stillDismissed = readDismissedUntil() > Date.now();
      if (dismissedRef.current && !stillDismissed) loadDeliveries(); // refresh stale data once we un-dismiss
      setDismissed(stillDismissed);
    }, RECHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadDeliveries]);

  function handleDismiss() {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DURATION_MS));
    setDismissed(true);
  }

  if (dismissed || !deliveries || deliveries.length === 0) return null;

  const today = localDateStr(new Date());
  const hasOverdue = deliveries.some((d) => d.deliveryDate < today);

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 animate-in slide-in-from-bottom duration-300">
      <div
        className={cn(
          "border-t-4 shadow-[0_-6px_24px_rgba(0,0,0,0.25)]",
          hasOverdue
            ? "border-red-400 bg-red-600 dark:border-red-500 dark:bg-red-700"
            : // Same brand hue as the Flux logo (app-sidebar.tsx), but pushed
              // to a deeper endpoint than the logo's own #227c9d — at banner
              // width a two-stop gradient needs more contrast than a 36px
              // square does to still read as "vibrant fading to dark"
              // rather than two similar mid-tones.
              "border-[#00c6b1]/70 bg-gradient-to-r from-[#00c6b1] to-[#0b2e3a]"
        )}
      >
        <div className="mx-auto max-w-5xl px-4 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15">
              {hasOverdue ? (
                <RiAlarmWarningLine className="size-5 text-white" />
              ) : (
                <RiTruckLine className="size-5 text-white" />
              )}
            </div>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex flex-1 items-center gap-2 text-left text-sm font-semibold text-white"
            >
              {deliveries.length} deliver{deliveries.length === 1 ? "y needs" : "ies need"} your attention
              {hasOverdue && (
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide">
                  Overdue
                </span>
              )}
              <RiArrowDownSLine className={cn("size-4 shrink-0 text-white/80 transition-transform", expanded && "rotate-180")} />
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss for 24 hours"
              title="Dismiss for 24 hours"
              className="shrink-0 rounded-full p-1.5 text-white/80 hover:bg-white/15 hover:text-white"
            >
              <RiCloseLine className="size-4" />
            </button>
          </div>

          {expanded && (
            <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto rounded-lg bg-white/10 p-1.5">
              {deliveries.map((d) => {
                const overdue = d.deliveryDate < today;
                return (
                  <Link
                    key={d.id}
                    href={`/projects/${d.projectId}?tab=delivery-tracker`}
                    className="flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-xs hover:bg-white/10"
                  >
                    <span className="truncate text-white">
                      <span className="font-semibold">{d.name}</span>
                      <span className="text-white/70"> · {d.projectName}</span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 font-semibold tabular-nums",
                        overdue ? "bg-white text-red-700" : "bg-white/20 text-white"
                      )}
                    >
                      {d.deliveryDate}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
