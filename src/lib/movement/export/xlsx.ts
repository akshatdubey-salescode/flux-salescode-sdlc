/**
 * Excel export through the exceljs STREAMING writer: rows are committed one by one (nothing keeps
 * the whole workbook), strings are inline (no shared-string table that grows with the data), and
 * the producer waits for the destination to drain and yields to the event loop, so the memory used
 * does not follow the row count. Every string cell goes through `excelSafe` (formula injection).
 */
import ExcelJS from "exceljs";
import type { Writable } from "node:stream";
import { PassThrough, Readable } from "node:stream";
import { excelSafe, formatSources, toRows, type Checklist } from "../checklist";
import { fmtTs, MAX_EXPORT_ROWS } from "./common";
import type { ExportModel } from "./model";

export { MAX_EXPORT_ROWS };
/** Excel's own limit is 32,767 characters per cell. */
const MAX_CELL_CHARS = 32_000;
/** Yield to the event loop (and wait for the destination) every this many rows. */
const YIELD_EVERY = 250;

const TEAL = "FF0F766E";
const FILL = {
  blocker: "FFFEE2E2",
  warn: "FFFEF3C7",
  unknown: "FFFFEDD5",
  conflict: "FFFECACA",
  target: "FFCCFBF1",
  targetUnknown: "FFFCA5A5",
  label: "FFF3F4F6",
} as const;

type RowTone = keyof typeof FILL | "none";
type Cell = string | number | boolean | null | undefined;
interface Col {
  header: string;
  width: number;
}

/**
 * XML 1.0 cannot carry C0 controls (except tab, LF, CR), U+FFFE / U+FFFF or a lone surrogate, and exceljs
 * strips only some of them: a stray one in a Jira summary or a record would make the file "corrupt" in Excel.
 */
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export const xmlClean = (s: string): string => s.replace(XML_ILLEGAL, "");

// Clean BEFORE excelSafe: a control character in front of "=" must not hide the formula from it.
const safe = (v: Cell): string | number | boolean | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return v;
  const s = excelSafe(xmlClean(v));
  if (s.length <= MAX_CELL_CHARS) return s;
  let cut = s.slice(0, MAX_CELL_CHARS - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1); // do not leave half a surrogate pair
  return `${cut}…`;
};

const WRAP: Partial<ExcelJS.Style> = { alignment: { vertical: "top", wrapText: true } };
const HEADER_STYLE: Partial<ExcelJS.Style> = {
  font: { bold: true, color: { argb: "FFFFFFFF" } },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } },
  alignment: { vertical: "middle", wrapText: true },
};
const fillOf = (tone: Exclude<RowTone, "none">): Partial<ExcelJS.Style> => ({ ...WRAP, fill: { type: "pattern", pattern: "solid", fgColor: { argb: FILL[tone] } } });
const STYLE: Record<RowTone, Partial<ExcelJS.Style>> = {
  none: WRAP,
  blocker: fillOf("blocker"),
  warn: fillOf("warn"),
  unknown: fillOf("unknown"),
  conflict: fillOf("conflict"),
  target: { ...fillOf("target"), font: { bold: true } },
  targetUnknown: { ...fillOf("targetUnknown"), font: { bold: true, color: { argb: "FF7F1D1D" } } },
  label: { ...fillOf("label"), font: { bold: true } },
};

/** Wait until the destination can take more (or it is gone), then give the event loop a turn. */
async function pace(out: Writable): Promise<void> {
  if (out.destroyed) throw new Error("The export was aborted");
  if (out.writableNeedDrain) {
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        out.off("drain", onDrain);
        out.off("close", onClose);
        out.off("error", onError);
      };
      const onDrain = () => (done(), resolve());
      const onClose = () => (done(), reject(new Error("The export was aborted")));
      const onError = (e: Error) => (done(), reject(e));
      out.once("drain", onDrain);
      out.once("close", onClose);
      out.once("error", onError);
    });
  }
  await new Promise<void>((r) => setImmediate(r));
}

class Sheet {
  private ws: ExcelJS.Worksheet;
  private rows = 0;
  private dropped = 0;
  constructor(
    private out: Writable,
    wb: ExcelJS.stream.xlsx.WorkbookWriter,
    name: string,
    private cols: Col[],
    private maxRows: number
  ) {
    this.ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    this.ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    this.ws.columns = cols.map((c) => ({ width: c.width }));
    const h = this.ws.addRow(cols.map((c) => c.header));
    h.height = 20;
    h.eachCell((cell) => {
      cell.style = HEADER_STYLE;
    });
    h.commit();
  }

  /** `tones[i]` overrides the row tone for column i (the target-environment cell). */
  async row(values: Cell[], tone: RowTone = "none", cellTones?: Record<number, RowTone>): Promise<void> {
    if (this.rows >= this.maxRows) {
      this.dropped++;
      return;
    }
    const r = this.ws.addRow(values.map(safe));
    for (let i = 1; i <= this.cols.length; i++) r.getCell(i).style = STYLE[cellTones?.[i - 1] ?? tone];
    r.commit();
    this.rows++;
    if (this.rows % YIELD_EVERY === 0) await pace(this.out);
  }

  async finish(): Promise<void> {
    if (this.dropped > 0) {
      const r = this.ws.addRow([`${this.dropped} more rows omitted (the export shows at most ${this.maxRows} rows per sheet)`]);
      r.getCell(1).style = STYLE.warn;
      r.commit();
    }
    this.ws.commit();
    await pace(this.out);
  }
}

// --- row tones and the Jira columns --------------------------------------------------------------

const BLOCKER_CODES = new Set(["pr_no_record", "sibling_no_record", "no_record", "tree_unreadable", "tree_incomplete"]); // pr_no_record: rows stored before reviews were per Jira

/** One tone per `toRows` row, in the same order (conflicts, unknowns, then every section item). Same length or no colouring. */
export function rowTones(cl: Checklist): RowTone[] {
  const out: RowTone[] = [];
  for (const c of cl.conflicts) out.push(c.severity === "blocker" ? "conflict" : "warn");
  for (const g of cl.unknownsByOwner) for (let i = 0; i < g.items.length; i++) out.push("unknown");
  for (const s of cl.sections) {
    for (const it of s.items) out.push(it.conflict ? "conflict" : it.severity === "blocker" ? "blocker" : it.severity === "warn" || it.needsAttention ? "warn" : "none");
  }
  return out;
}

const signoffText = (s: { by: string; at: string } | "missing" | undefined): string => (s === undefined ? "" : s === "missing" ? "MISSING" : `${s.by} (${fmtTs(s.at)})`);

// --- the workbook --------------------------------------------------------------------------------

export interface XlsxOptions {
  maxRows?: number;
}

export async function writeXlsx(model: ExportModel, out: Writable, opts: XlsxOptions = {}): Promise<void> {
  const maxRows = opts.maxRows ?? MAX_EXPORT_ROWS;
  const cl = model.checklist;
  const m = model.movement;
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
  wb.creator = "Flux";
  wb.created = new Date(model.generatedAt);

  // Summary
  {
    const s = new Sheet(out, wb, "Summary", [{ header: "Field", width: 30 }, { header: "Value", width: 80 }], maxRows);
    const kv = async (k: string, v: Cell, tone: RowTone = "none") => s.row([k, v], tone, { 0: "label" });
    await kv("Delivery", model.delivery.name);
    await kv("Delivery date", model.delivery.date);
    await kv("Environment", m.environment.toUpperCase());
    await kv("Movement status", m.status);
    await kv("Checklist hash", m.hash);
    await kv("Records last refreshed", m.refreshedAt ? fmtTs(m.refreshedAt) : "never");
    await kv("Movement created", `${fmtTs(m.createdAt)}${m.createdByName ? ` by ${m.createdByName}` : ""}`);
    if (m.startedAt) await kv("Deployment started", fmtTs(m.startedAt));
    if (m.doneAt) await kv("Marked done", `${fmtTs(m.doneAt)}${m.doneByName ? ` by ${m.doneByName}` : ""}`);
    await kv("Exported at", fmtTs(model.generatedAt));
    await kv("Summary", cl.summary);
    for (const g of model.signers) {
      const who = `${g.name ? `${g.name} <${g.email}>` : g.email || "(nobody named)"}`;
      await kv(`Signer: ${g.slot}`, `${who}: ${g.signed ? `signed ${fmtTs(g.signedAt)}${g.signedCurrent ? "" : " (an older checklist)"}` : "not signed"}`, g.signed && g.signedCurrent ? "none" : "warn");
    }
    const st = cl.stats;
    await kv("Jiras (ticked / total / held back)", `${st.included} / ${st.jiras} / ${st.held}`);
    await kv("Records, PRs", `${st.records} records, ${st.prs} PRs`);
    await kv("Checklist items", st.items);
    await kv("Conflicts", st.conflicts, st.conflicts ? "conflict" : "none");
    await kv("Unknowns to resolve", st.unknowns, st.unknowns ? "unknown" : "none");
    await kv("Need attention", st.needsAttention, st.needsAttention ? "warn" : "none");
    await kv("Items by severity (blocker / warn / info)", `${st.bySeverity.items.blocker} / ${st.bySeverity.items.warn} / ${st.bySeverity.items.info}`);
    await s.finish();
  }

  // Checklist
  {
    const s = new Sheet(
      out,
      wb,
      "Checklist",
      [
        { header: "Kind", width: 11 },
        { header: "Section", width: 30 },
        { header: "Item", width: 34 },
        { header: "Text", width: 90 },
        { header: "Sources", width: 40 },
        { header: `${m.environment.toUpperCase()} (target) value`, width: 24 },
        { header: "Flags", width: 30 },
      ],
      maxRows
    );
    const rows = toRows(cl);
    const tones = rowTones(cl);
    const aligned = tones.length === rows.length;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const tone = aligned ? tones[i] : "none";
      const envTone: RowTone | undefined = r.envValue ? (r.envValue === "UNKNOWN" ? "targetUnknown" : "target") : undefined;
      await s.row([r.kind, r.section, r.item, r.text, r.sources, r.envValue, r.flags], tone, envTone ? { 5: envTone } : undefined);
    }
    await s.finish();
  }

  // Conflicts
  {
    const s = new Sheet(
      out,
      wb,
      "Conflicts",
      [{ header: "Kind", width: 20 }, { header: "Section", width: 20 }, { header: "Item", width: 34 }, { header: "Severity", width: 11 }, { header: "Title", width: 50 }, { header: "Variant", width: 70 }, { header: "Sources", width: 40 }],
      maxRows
    );
    for (const c of cl.conflicts) {
      for (const v of c.variants) await s.row([c.kind, c.section, c.itemKey, c.severity, c.title, v.text, formatSources(v.sources)], c.severity === "blocker" ? "conflict" : "warn");
    }
    await s.finish();
  }

  // Unknowns by owner
  {
    const s = new Sheet(out, wb, "Unknowns by owner", [{ header: "Owner", width: 22 }, { header: "Unknown", width: 90 }, { header: "Sources", width: 44 }], maxRows);
    for (const g of cl.unknownsByOwner) {
      for (const u of g.items) await s.row([g.owner || "owner not named", u.text, formatSources(u.sources, u.moreSources)], "unknown", { 0: "label" });
      if (g.more) await s.row([g.owner || "owner not named", `${g.more} more not listed`, ""], "none", { 0: "label" });
    }
    await s.finish();
  }

  // Jiras
  {
    const s = new Sheet(
      out,
      wb,
      "Jiras",
      [
        { header: "Jira", width: 14 },
        { header: "Summary", width: 46 },
        { header: "Included", width: 10 },
        { header: "Readiness", width: 11 },
        { header: "Blockers", width: 54 },
        { header: "Warnings", width: 54 },
        { header: "Override reason", width: 40 },
        { header: "Override by", width: 22 },
        { header: "Override at", width: 18 },
        { header: "Dev sign-off", width: 30 },
        { header: "Tester sign-off", width: 30 },
        { header: "Records", width: 40 },
        { header: "Result", width: 10 },
      ],
      maxRows
    );
    const sign = new Map(cl.signoffs.map((x) => [x.jira, x]));
    for (const it of model.items) {
      const blockers = it.warnings.filter((w) => BLOCKER_CODES.has(w.code)).map((w) => w.message);
      const warnings = it.warnings.filter((w) => !BLOCKER_CODES.has(w.code)).map((w) => w.message);
      const so = sign.get(it.key);
      const records = it.records.map((r) => `${r.repo}#${r.pr}${r.version !== null ? ` v${r.version}` : ""}${r.status ? ` ${r.status}` : ""}`).join("\n");
      await s.row(
        [it.key, it.summary, it.included ? "yes" : "no", it.readiness, blockers.join("\n"), warnings.join("\n"), it.override?.reason ?? "", it.override?.by ?? "", fmtTs(it.override?.at), signoffText(so?.dev), signoffText(so?.tester), records, it.result],
        it.readiness === "blocked" ? "blocker" : it.readiness === "override" || warnings.length ? "warn" : "none",
        { 9: so?.dev === "missing" ? "warn" : "none", 10: so?.tester === "missing" ? "warn" : "none" }
      );
    }
    await s.finish();
  }

  // Sign-offs
  {
    const s = new Sheet(out, wb, "Sign-offs", [{ header: "Sign-off", width: 28 }, { header: "Person", width: 34 }, { header: "State", width: 36 }, { header: "When", width: 22 }], maxRows);
    for (const g of model.signers) {
      await s.row([`Movement: ${g.slot}`, g.name ? `${g.name} <${g.email}>` : g.email, g.signed ? (g.signedCurrent ? "signed" : "signed an older checklist") : "not signed", fmtTs(g.signedAt)], g.signed && g.signedCurrent ? "none" : "warn");
    }
    for (const x of cl.signoffs) {
      for (const role of ["dev", "tester"] as const) {
        const v = x[role];
        await s.row([`${x.jira}: ${role}`, v === "missing" ? "" : v.by, v === "missing" ? "MISSING" : "signed", v === "missing" ? "" : fmtTs(v.at)], v === "missing" ? "warn" : "none");
      }
    }
    await s.finish();
  }

  // Events (last 100)
  {
    const s = new Sheet(out, wb, "Events", [{ header: "When", width: 22 }, { header: "Event", width: 24 }, { header: "By", width: 28 }, { header: "Detail", width: 90 }], maxRows);
    for (const e of model.events) await s.row([fmtTs(e.at), e.type, e.actor, e.detail]);
    await s.finish();
  }

  await wb.commit();
}

/**
 * The workbook as a web ReadableStream for a Response. The producer runs behind the stream; if the
 * client goes away (cancel or `signal`) the destination is destroyed, the producer stops at its next
 * pace() and nothing is left running.
 */
export function xlsxReadable(model: ExportModel, opts: XlsxOptions & { signal?: AbortSignal } = {}): ReadableStream<Uint8Array> {
  const pass = new PassThrough({ highWaterMark: 64 * 1024 });
  const abort = () => pass.destroy(new Error("The export was aborted"));
  if (opts.signal?.aborted) abort();
  else opts.signal?.addEventListener("abort", abort, { once: true });
  writeXlsx(model, pass, opts)
    .catch((e) => {
      if (!pass.destroyed) pass.destroy(e instanceof Error ? e : new Error(String(e)));
    })
    .finally(() => opts.signal?.removeEventListener("abort", abort));
  return Readable.toWeb(pass) as ReadableStream<Uint8Array>;
}
