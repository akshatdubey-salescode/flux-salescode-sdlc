"use client";

import { useEffect, useState } from "react";
import {
  RiCheckLine,
  RiLoader4Line,
  RiLinkUnlinkM,
  RiExternalLinkLine,
  RiGoogleFill,
} from "@remixicon/react";

type IntegrationStatus =
  | { connected: false }
  | {
      connected: true;
      email: string;
      tokenExpiresAt: string | null;
      lastSyncedAt: string | null;
      connectedAt: string;
    };

export function GoogleCalendarCard() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    fetch("/api/integrations/google")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ connected: false }));
  }, []);

  async function disconnect() {
    setDisconnecting(true);
    try {
      await fetch("/api/integrations/google", { method: "DELETE" });
      setStatus({ connected: false });
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-white border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 shrink-0">
            <RiGoogleFill size={20} className="text-[#4285F4]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Google Calendar</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Surface your meeting hours on observer boards so managers can see
              time spent in discussions.
            </p>
          </div>
        </div>

        {status?.connected && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 shrink-0">
            <RiCheckLine size={11} />
            Connected
          </span>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
        {status === null ? (
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <RiLoader4Line className="animate-spin" size={14} />
            Loading…
          </div>
        ) : status.connected ? (
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">{status.email}</p>
              <p className="text-xs text-muted-foreground">
                {status.lastSyncedAt
                  ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString()}`
                  : "Not synced yet"}
              </p>
            </div>
            <button
              onClick={disconnect}
              disabled={disconnecting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {disconnecting ? (
                <RiLoader4Line className="animate-spin" size={12} />
              ) : (
                <RiLinkUnlinkM size={12} />
              )}
              Disconnect
            </button>
          </div>
        ) : (
          <a
            href="/api/google/connect?redirectBack=/settings"
            className="inline-flex items-center gap-2 rounded-lg bg-[#4285F4] hover:bg-[#3367D6] px-4 py-2 text-sm font-semibold text-white transition-colors"
          >
            <RiExternalLinkLine size={14} />
            Connect Google Calendar
          </a>
        )}
      </div>
    </div>
  );
}
