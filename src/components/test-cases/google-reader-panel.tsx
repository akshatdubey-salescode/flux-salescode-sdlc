"use client";

import { useCallback, useEffect, useState } from "react";
import { RiLoader4Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Reader = { email: string; connectedBy: string; connectedAt: string; lastOkAt: string | null; problem: string | null };

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }) : "never";

/** Admin: the one Google account Flux reads Sheets with, and a way to test whether a given sheet opens with it. */
export function GoogleReaderPanel() {
  const [reader, setReader] = useState<Reader | null | undefined>(undefined);
  const [setup, setSetup] = useState<{ dedicatedClient: boolean; pinnedEmail: string | null } | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"test" | "disconnect" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/test-cases/google-reader", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Could not load the Google account.");
      setReader(null);
    } else {
      setReader(data.reader);
      setSetup({ dedicatedClient: !!data.dedicatedClient, pinnedEmail: data.pinnedEmail ?? null });
    }
  }, []);

  useEffect(() => {
    void load();
    const q = new URLSearchParams(window.location.search);
    if (q.get("connected") === "shared-reader") setFlash({ ok: true, text: "Connected. Flux now reads Google Sheets with this account." });
    else if (q.get("shared_reader_error")) setFlash({ ok: false, text: q.get("shared_reader_error") ?? "Could not connect." });
  }, [load]);

  async function test() {
    if (!url.trim() || busy) return;
    setBusy("test");
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/test-cases/google-reader", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test", url }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setError(d.error ?? "That didn't work.");
      else setResult(d.ok ? { ok: true, text: `Opens: "${d.title}", ${d.tabs} tab${d.tabs === 1 ? "" : "s"} (${d.ms} ms).` } : { ok: false, text: d.message });
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect the shared Google account? Sheets will then need each person's own Google connection.")) return;
    setBusy("disconnect");
    await fetch("/api/test-cases/google-reader", { method: "DELETE" });
    setBusy(null);
    setResult(null);
    await load();
  }

  const connectHref = "/api/google/connect?mode=shared&redirectBack=/admin/ai-guidelines";
  const tone = reader ? (reader.problem ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30" : "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20") : "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900";

  return (
    <section className={cn("space-y-2 rounded-lg border p-3 text-xs", tone)} aria-label="Google Sheets access">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">Google Sheets access</h2>
        <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold dark:bg-black/30">
          {reader === undefined ? "Loading…" : reader === null ? "Not connected" : reader.problem ? "Needs reconnecting" : "Connected"}
        </span>
        <div className="ml-auto flex gap-2">
          <a href={connectHref} className="inline-flex h-7 items-center rounded-md border border-zinc-300 bg-white px-2.5 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800">
            {reader ? "Reconnect" : "Connect Google account"}
          </a>
          {reader && (
            <Button type="button" size="sm" variant="ghost" onClick={disconnect} disabled={busy !== null}>
              {busy === "disconnect" && <RiLoader4Line className="size-3.5 animate-spin" />}
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {reader ? (
        <p className="text-muted-foreground">
          Flux reads Google Sheets as <b className="text-foreground">{reader.email}</b>. Any sheet shared with the whole Salescode domain, or with that address, opens for everyone
          without them connecting Google. Connected by {reader.connectedBy} on {fmt(reader.connectedAt)}; last used {fmt(reader.lastOkAt)}.
        </p>
      ) : (
        <p className="text-muted-foreground">
          Not set up. Connect a dedicated Salescode Google account (for example a shared &quot;flux&quot; mailbox): press the button, then sign in to Google as <i>that</i> account, not as yourself.
          Until then each person has to connect their own Google to submit a sheet.
        </p>
      )}
      {reader?.problem && <p className="text-amber-900 dark:text-amber-200">{reader.problem}</p>}
      {setup && (
        <p className="text-muted-foreground">
          {setup.dedicatedClient ? "Uses its own Google OAuth client (TC_GOOGLE_CLIENT_ID)." : "Uses the sign-in Google OAuth client. Set TC_GOOGLE_CLIENT_ID and TC_GOOGLE_CLIENT_SECRET to give this feature its own."}{" "}
          {setup.pinnedEmail ? `Only ${setup.pinnedEmail} can be connected.` : "Any Salescode account can be connected; set TC_GOOGLE_READER_EMAIL to pin one."}
        </p>
      )}
      {flash && <p className={flash.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}>{flash.text}</p>}

      {reader && !reader.problem && (
        <form
          className="flex flex-wrap items-center gap-2 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            void test();
          }}
        >
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Test a sheet link: does it open with this account?" aria-label="Google Sheet link to test" className="min-w-64 flex-1 text-xs" />
          <Button type="submit" size="sm" variant="outline" disabled={!url.trim() || busy !== null}>
            {busy === "test" && <RiLoader4Line className="size-3.5 animate-spin" />}
            Test
          </Button>
        </form>
      )}
      {result && <p className={result.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}>{result.text}</p>}
      {error && <p className="text-destructive">{error}</p>}
    </section>
  );
}
