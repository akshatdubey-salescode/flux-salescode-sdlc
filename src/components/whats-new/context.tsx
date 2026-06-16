"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { PublicReleaseNote } from "@/lib/release-notes/queries";
import { WhatsNewAlertModal } from "./whats-new-alert-modal";

// Persist "seen" state server-side, per user — so it follows them across
// browsers and devices and we never re-spam a returning user with old alerts.
async function postSeen(ids: string[]) {
  if (ids.length === 0) return;
  try {
    await fetch("/api/whats-new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  } catch {
    // Best-effort: an optimistic UI update already happened. If this write is
    // lost the worst case is the note resurfaces as unread next load.
  }
}

type WhatsNewContextValue = {
  notes: PublicReleaseNote[];
  loading: boolean;
  unreadCount: number;
  isRead: (id: string) => boolean;
  markRead: (id: string) => void;
  markAllRead: () => void;
};

const WhatsNewContext = createContext<WhatsNewContextValue | null>(null);

export function useWhatsNew() {
  const ctx = useContext(WhatsNewContext);
  if (!ctx) {
    throw new Error("useWhatsNew must be used within a WhatsNewProvider");
  }
  return ctx;
}

export function WhatsNewProvider({ children }: { children: React.ReactNode }) {
  const [notes, setNotes] = useState<PublicReleaseNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  // The single alert to auto-open this load. Decided once, on first fetch, so
  // a backlog of unseen alerts can never avalanche into a stack of modals.
  const [alertToShow, setAlertToShow] = useState<PublicReleaseNote | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/whats-new");
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as {
          notes: PublicReleaseNote[];
          seenIds: string[];
        };
        if (cancelled) return;
        const seen = new Set(data.seenIds ?? []);
        setNotes(data.notes ?? []);
        setSeenIds(seen);
        // notes arrive newest-first; pop only the most recent unseen ALERT.
        const alert = (data.notes ?? []).find(
          (n) => n.type === "ALERT" && !seen.has(n.id)
        );
        setAlertToShow(alert ?? null);
      } catch {
        if (!cancelled) setNotes([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const markSeen = useCallback((ids: string[]) => {
    setSeenIds((prev) => {
      const fresh = ids.filter((id) => !prev.has(id));
      if (fresh.length === 0) return prev;
      const next = new Set(prev);
      for (const id of fresh) next.add(id);
      postSeen(fresh);
      return next;
    });
  }, []);

  const isRead = useCallback((id: string) => seenIds.has(id), [seenIds]);
  const markRead = useCallback((id: string) => markSeen([id]), [markSeen]);
  const markAllRead = useCallback(
    () => markSeen(notes.map((n) => n.id)),
    [markSeen, notes]
  );

  const unreadCount = useMemo(
    () => notes.reduce((n, note) => (seenIds.has(note.id) ? n : n + 1), 0),
    [notes, seenIds]
  );

  const dismissAlert = useCallback(() => {
    if (alertToShow) markRead(alertToShow.id);
    setAlertToShow(null);
  }, [alertToShow, markRead]);

  const value = useMemo<WhatsNewContextValue>(
    () => ({ notes, loading, unreadCount, isRead, markRead, markAllRead }),
    [notes, loading, unreadCount, isRead, markRead, markAllRead]
  );

  return (
    <WhatsNewContext.Provider value={value}>
      {children}
      {alertToShow && (
        <WhatsNewAlertModal note={alertToShow} onDismiss={dismissAlert} />
      )}
    </WhatsNewContext.Provider>
  );
}
