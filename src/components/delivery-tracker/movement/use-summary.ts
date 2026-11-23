"use client";

/**
 * The Checklist tab's summary: GET summary (the deterministic rollup comes at once; the stored AI summary only when it is fresh) and POST summary to
 * generate with AI. Lazy (only when `enabled`), abortable, with a sequence guard so an older answer never replaces a newer one. A failed AI generation is
 * not an error (the server answers with the rules summary and a note); a 429 only shows its message. Nothing here blocks the page.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { SummaryView } from "./api-types";
import { generateErrorText } from "./summary";

export interface SummaryState {
  data: SummaryView | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  generating: boolean;
  genError: string | null;
}

export function useSummary(base: string, enabled: boolean, hash: string | null) {
  const [data, setData] = useState<SummaryView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const seq = useRef(0);
  const ctl = useRef<AbortController | null>(null);
  const dataRef = useRef<SummaryView | null>(null);

  const fetchSummary = useCallback(async (): Promise<SummaryView | null> => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    const mine = ++seq.current;
    setLoading(true);
    const r = await api<SummaryView>(`${base}/summary`, { signal: c.signal, timeoutMs: 30_000, fallbackError: "Could not load the summary" });
    if (mine !== seq.current || r.aborted) return null;
    setLoading(false);
    if (!r.ok || !r.data) {
      setError(r.error ?? "Could not load the summary");
      setStale(r.status === 409 && (r.body as { code?: unknown } | null)?.code === "inputs_stale");
      return null;
    }
    setError(null);
    setStale(false);
    dataRef.current = r.data;
    setData(r.data);
    return r.data;
  }, [base]);

  // Once the tab wants it, and again when the checklist hash moves (ticks, picks, edits): the stored summary may now be stale.
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    queueMicrotask(() => {
      if (live) void fetchSummary();
    });
    return () => {
      live = false;
      ctl.current?.abort();
    };
  }, [enabled, hash, fetchSummary]);

  const generate = useCallback(
    async (force: boolean) => {
      setGenerating(true);
      setGenError(null);
      const r = await api<SummaryView>(`${base}/summary`, { method: "POST", body: { force }, timeoutMs: 90_000, fallbackError: "Could not generate the summary" });
      setGenerating(false);
      if (r.aborted) return;
      if (!r.ok || !r.data) {
        setGenError(generateErrorText(r.status, r.error));
        return;
      }
      seq.current++;
      dataRef.current = r.data;
      setData(r.data);
      setError(null);
    },
    [base]
  );

  /** The summary for Copy: the loaded one, else fetched now (no tab needs to be open). */
  const ensure = useCallback(async (): Promise<SummaryView | null> => dataRef.current ?? fetchSummary(), [fetchSummary]);

  const state: SummaryState = { data, loading, error, stale, generating, genError };
  return { ...state, retry: () => void fetchSummary(), generate, ensure };
}
