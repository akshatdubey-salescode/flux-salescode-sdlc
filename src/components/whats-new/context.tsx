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

// Per-browser read/seen state. Content lives in the DB; which notes a given
// user has read (badge state) and which ALERTs they've already had popped up
// (so they only auto-open once) is local UI state — no server round-trips.
const READ_KEY = "whatsNew.readIds";
const SEEN_ALERT_KEY = "whatsNew.seenAlertIds";

function readSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((x): x is string => typeof x === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function writeSet(key: string, value: Set<string>) {
  try {
    window.localStorage.setItem(key, JSON.stringify([...value]));
  } catch {
    // ignore (quota exceeded, private browsing, etc.)
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
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [seenAlertIds, setSeenAlertIds] = useState<Set<string>>(new Set());

  // Hydrate local state, then fetch the published feed once.
  useEffect(() => {
    setReadIds(readSet(READ_KEY));
    setSeenAlertIds(readSet(SEEN_ALERT_KEY));

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/whats-new");
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { notes: PublicReleaseNote[] };
        if (!cancelled) setNotes(data.notes ?? []);
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

  const isRead = useCallback((id: string) => readIds.has(id), [readIds]);

  const markRead = useCallback((id: string) => {
    setReadIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev).add(id);
      writeSet(READ_KEY, next);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setReadIds((prev) => {
      const next = new Set(prev);
      for (const n of notes) next.add(n.id);
      writeSet(READ_KEY, next);
      return next;
    });
  }, [notes]);

  const markAlertSeen = useCallback((id: string) => {
    setSeenAlertIds((prev) => {
      const next = new Set(prev).add(id);
      writeSet(SEEN_ALERT_KEY, next);
      return next;
    });
    // An auto-shown alert also counts as read once dismissed.
    markRead(id);
  }, [markRead]);

  const unreadCount = useMemo(
    () => notes.reduce((n, note) => (readIds.has(note.id) ? n : n + 1), 0),
    [notes, readIds]
  );

  // The next ALERT-type note this browser hasn't been shown yet. Dismissing it
  // marks it seen, which surfaces the following one (if any) on re-render.
  const pendingAlert = useMemo(
    () =>
      notes.find((n) => n.type === "ALERT" && !seenAlertIds.has(n.id)) ?? null,
    [notes, seenAlertIds]
  );

  const value = useMemo<WhatsNewContextValue>(
    () => ({ notes, loading, unreadCount, isRead, markRead, markAllRead }),
    [notes, loading, unreadCount, isRead, markRead, markAllRead]
  );

  return (
    <WhatsNewContext.Provider value={value}>
      {children}
      {pendingAlert && (
        <WhatsNewAlertModal
          note={pendingAlert}
          onDismiss={() => markAlertSeen(pendingAlert.id)}
        />
      )}
    </WhatsNewContext.Provider>
  );
}
