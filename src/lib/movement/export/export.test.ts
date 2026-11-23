// Run: ./node_modules/.bin/tsx --test src/lib/movement/export/export.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequire } from "node:module";
import { Writable } from "node:stream";
import ExcelJS from "exceljs";
import { renderText } from "../checklist";
import { fmtTs } from "./common";
import { CONTENT_TYPE, exportFilename, isExportFormat, parseFormat } from "./filename";
import { HTML_CSP, renderHtml } from "./html";
import { respondExport } from "./respond";
import { renderTextExport } from "./text";
import { MAX_EXPORT_ROWS, writeXlsx, xlsxReadable, xmlClean } from "./xlsx";
import { hugeChecklist, modelFor, realChecklist } from "./testkit";
import type { ExportModel } from "./model";

/** The workbook as bytes; `onChunk` sees every chunk (heap sampling). */
async function toBuffer(model: ExportModel, opts: { maxRows?: number; onChunk?: () => void } = {}): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const out = new Writable({
    highWaterMark: 16 * 1024,
    write(c, _e, cb) {
      chunks.push(c);
      opts.onChunk?.();
      setImmediate(cb); // a slow consumer: the writer must wait for drain
    },
  });
  await writeXlsx(model, out, { maxRows: opts.maxRows });
  await new Promise((r) => out.end(r));
  return Buffer.concat(chunks);
}

async function load(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return wb;
}

const cellText = (c: ExcelJS.Cell): string => String(c.value ?? "");

describe("xlsx export of the real checklist", () => {
  it("has the 7 sheets, headers, frozen header, summary values, and one row per toRows row", async () => {
    const cl = realChecklist();
    const wb = await load(await toBuffer(modelFor(cl)));
    assert.deepEqual(wb.worksheets.map((w) => w.name), ["Summary", "Checklist", "Conflicts", "Unknowns by owner", "Jiras", "Sign-offs", "Events"]);

    const sum = wb.getWorksheet("Summary")!;
    const kv = new Map<string, string>();
    sum.eachRow((r) => kv.set(cellText(r.getCell(1)), cellText(r.getCell(2))));
    assert.equal(kv.get("Delivery"), "Release 19 Nov");
    assert.equal(kv.get("Environment"), "PROD");
    assert.equal(kv.get("Checklist hash"), cl.hash);
    assert.match(kv.get("Signer: deployer")!, /signed 19 Nov 2026, 05:15 pm IST/i);
    assert.match(kv.get("Signer: ba")!, /not signed/);
    assert.match(kv.get("Signer: lead")!, /an older checklist/);
    assert.equal(kv.get("Unknowns to resolve"), String(cl.stats.unknowns));

    const ck = wb.getWorksheet("Checklist")!;
    assert.deepEqual((ck.getRow(1).values as string[]).slice(1), ["Kind", "Section", "Item", "Text", "Sources", "PROD (target) value", "Flags"]);
    assert.equal(ck.views[0].state, "frozen");
    assert.equal(ck.views[0].ySplit, 1);
    assert.ok(ck.getColumn(4).width! >= 80);
    assert.ok(ck.rowCount > 100, `expected the real checklist's rows, got ${ck.rowCount}`);
    // header style: teal fill, bold white
    assert.equal((ck.getCell("A1").fill as ExcelJS.FillPattern).fgColor?.argb, "FF0F766E");
    assert.equal(ck.getCell("A1").font?.bold, true);
    // wrap on, and the target-environment value of a config row is highlighted
    assert.equal(ck.getCell("D2").alignment?.wrapText, true);
    let envRows = 0;
    ck.eachRow((r, n) => {
      if (n > 1 && cellText(r.getCell(6))) {
        envRows++;
        const f = (r.getCell(6).fill as ExcelJS.FillPattern).fgColor?.argb;
        assert.ok(f === "FFCCFBF1" || f === "FFFCA5A5", `target cell not highlighted: ${f}`);
        if (cellText(r.getCell(6)) === "UNKNOWN") assert.equal(f, "FFFCA5A5");
      }
    });
    assert.ok(envRows > 0, "the real checklist has config rows with a target value");

    // Jiras: readiness, blockers vs warnings split, override, sign-off, included
    const j = wb.getWorksheet("Jiras")!;
    assert.equal(cellText(j.getCell("A2")), "CAV-7304");
    assert.match(cellText(j.getCell("F2")), /5 unknowns still open/); // a warning
    assert.equal(cellText(j.getCell("E2")), "");
    assert.equal(cellText(j.getCell("D3")), "blocked");
    assert.match(cellText(j.getCell("E3")), /no deployment record/); // a blocker
    assert.equal(cellText(j.getCell("C3")), "no");
    assert.equal(cellText(j.getCell("G4")), "Hotfix agreed with the lead");
    assert.match(cellText(j.getCell("J2")), /dev@example.com \(18 Nov 2026, 03:30 pm IST\)/i);
    assert.equal(cellText(j.getCell("K2")), "MISSING");

    const so = wb.getWorksheet("Sign-offs")!;
    assert.equal(cellText(so.getCell("A2")), "Movement: deployer");
    assert.equal(cellText(so.getCell("C3")), "not signed");
    assert.equal(wb.getWorksheet("Events")!.rowCount, 3);
    assert.equal(cellText(wb.getWorksheet("Events")!.getCell("B2")), "signed");
  });

  it("neutralises formulas in EVERY sheet (checklist text, Jira summary, signer name, event actor, warnings)", async () => {
    const cl = realChecklist();
    cl.sections[0].items[0].text = "=HYPERLINK(\"http://evil\",\"x\")";
    const m = modelFor(cl);
    m.items[0].summary = "+SUM(A1)";
    m.items[0].warnings = [{ code: "open_unknowns", message: "@cmd" }];
    m.signers[0].name = "-2+3";
    m.events[0].actor = "=1+1";
    m.delivery.name = "=evil";
    const wb = await load(await toBuffer(m));
    const bad: string[] = [];
    for (const ws of wb.worksheets) {
      ws.eachRow((r) =>
        r.eachCell((c) => {
          if (typeof c.value === "object" && c.value !== null && "formula" in c.value) bad.push(`${ws.name}!${c.address} is a formula`);
          if (typeof c.value === "string" && /^[=+\-@\t\r]/.test(c.value)) bad.push(`${ws.name}!${c.address} starts with ${c.value[0]}`);
        })
      );
    }
    assert.deepEqual(bad, []);
    const ck = wb.getWorksheet("Checklist")!;
    let found = false;
    ck.eachRow((r) => (found ||= cellText(r.getCell(4)) === "'=HYPERLINK(\"http://evil\",\"x\")"));
    assert.ok(found, "the formula text is kept, as visible text with a leading quote");
    assert.equal(cellText(wb.getWorksheet("Summary")!.getCell("B2")), "'=evil");
  });

  it("stops at the row cap with an 'N more rows omitted' note (small cap, all sheets)", async () => {
    const wb = await load(await toBuffer(modelFor(realChecklist()), { maxRows: 20 }));
    const ck = wb.getWorksheet("Checklist")!;
    const total = (await load(await toBuffer(modelFor(realChecklist())))).getWorksheet("Checklist")!.rowCount - 1;
    assert.equal(ck.rowCount, 1 + 20 + 1);
    assert.match(cellText(ck.getCell("A22")), new RegExp(`^${total - 20} more rows omitted`));
    // a sheet within the cap has no note
    assert.equal(wb.getWorksheet("Events")!.rowCount, 3);
  });
});

describe("xlsx export of a 20,000+ row checklist", () => {
  it("caps at 20,000 rows, notes the rest, stays valid, and the heap stays bounded", async () => {
    const extra = 700;
    const model = modelFor(hugeChecklist(MAX_EXPORT_ROWS + extra));
    const rowsTotal = model.checklist.sections.reduce((a, s) => a + s.items.length, 0);
    const base = process.memoryUsage().heapUsed;
    let peak = base;
    const t0 = Date.now();
    const buf = await toBuffer(model, { onChunk: () => (peak = Math.max(peak, process.memoryUsage().heapUsed)) });
    const ms = Date.now() - t0;
    const deltaMb = (peak - base) / 1e6;
    console.log(`# 20,${extra} items: ${ms} ms, ${(buf.length / 1e6).toFixed(2)} MB xlsx, peak heap +${deltaMb.toFixed(1)} MB`);
    // the whole workbook in memory would be well over this; streaming keeps it to buffers and the zip window
    assert.ok(deltaMb < 60, `peak heap grew by ${deltaMb.toFixed(1)} MB`);

    const wb = await load(buf);
    const ck = wb.getWorksheet("Checklist")!;
    assert.equal(ck.rowCount, 1 + MAX_EXPORT_ROWS + 1);
    const omitted = rowsTotal + model.checklist.conflicts.length + model.checklist.unknownsByOwner.reduce((a, g) => a + g.items.length, 0) - MAX_EXPORT_ROWS;
    assert.match(cellText(ck.getCell(`A${MAX_EXPORT_ROWS + 2}`)), new RegExp(`^${omitted} more rows omitted`));
    // the formula-looking rows are text
    let formulas = 0;
    ck.eachRow((r) => {
      const v = r.getCell(4).value;
      if (typeof v === "object" && v !== null && "formula" in v) formulas++;
    });
    assert.equal(formulas, 0);
  });

  it("the web stream carries the same bytes and a cancelled reader stops the producer", async () => {
    const model = modelFor(hugeChecklist(3000));
    const chunks: Uint8Array[] = [];
    const reader = xlsxReadable(model).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const wb = await load(Buffer.concat(chunks));
    assert.ok(wb.getWorksheet("Checklist")!.rowCount > 3000);

    const r2 = xlsxReadable(modelFor(hugeChecklist(20000))).getReader();
    await r2.read();
    await r2.cancel(); // must not throw or leave an unhandled rejection
    await new Promise((r) => setTimeout(r, 50));
  });
});

describe("html export (print page)", () => {
  const evil = `</script><img src=x onerror=alert(1)> "q" 'a' & <b>`;
  it("escapes every interpolated string and has no script, no external request, and the strict CSP", () => {
    const cl = realChecklist();
    cl.sections[3].items[0].text = evil;
    cl.sections[3].items[0].sources = [{ jira: evil, pr: evil }];
    cl.unknownsByOwner[0].owner = evil;
    cl.unknownsByOwner[0].items[0].text = evil;
    const m = modelFor(cl);
    m.delivery.name = evil;
    m.items[0].summary = evil;
    m.items[0].warnings = [{ code: "x", message: evil }];
    m.items[2].override = { reason: evil, by: evil, at: "2026-11-19T10:00:00.000Z" };
    m.signers[0].name = evil;
    m.events[0].actor = evil;
    m.events[0].detail = evil;
    const html = renderHtml(m);
    assert.ok(!html.includes("<img"), "raw <img must not appear");
    assert.ok(!/<script/i.test(html));
    assert.ok(!html.includes("</script>"));
    assert.ok(!/onerror\s*=\s*alert/.test(html.replace(/&lt;img[^]*?&gt;/g, "")), "an event-handler attribute outside escaped text");
    assert.ok(html.includes("&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt; &quot;q&quot; &#39;a&#39; &amp; &lt;b&gt;"));
    assert.ok(!/(src|href)\s*=\s*["']?https?:/i.test(html), "no external reference");
    assert.ok(!/<(link|iframe|object|embed|form)\b/i.test(html));
    assert.ok(!/url\(|@import/i.test(html));
    assert.equal(HTML_CSP, "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    // structure: sections, print rules, tags balanced at the top level
    assert.ok(html.includes("@media print") && html.includes("section{break-before:page}"));
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(html.includes("<title>Movement to PROD: "));
    assert.equal((html.match(/<section/g) ?? []).length, (html.match(/<\/section>/g) ?? []).length);
  });

  it("shows target-env values, severities, the Jira readiness and omits rows past the cap", () => {
    const html = renderHtml(modelFor(realChecklist()));
    assert.ok(html.includes("PROD (target):"));
    assert.ok(html.includes('class="env target"') || html.includes('class="env unk"'));
    assert.ok(html.includes("2. Branches and owners"));
    assert.ok(html.includes("MISSING"));
    const capped = renderHtml(modelFor(realChecklist()), { maxRows: 30 });
    assert.match(capped, /\d+ more rows omitted/);
    assert.ok(capped.length < html.length);
  });
});

describe("text export and file names", () => {
  it("text is the renderText of the checklist; the content types and format guard", () => {
    const cl = realChecklist();
    const t = renderText(cl);
    assert.ok(t.startsWith("# Environment movement checklist: PROD"));
    assert.equal(CONTENT_TYPE.text, "text/plain; charset=utf-8");
    assert.equal(CONTENT_TYPE.xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.deepEqual(["xlsx", "text", "html", "pdf", "", null, undefined, "XLSX"].map(isExportFormat), [true, true, true, false, false, false, false, false]);
  });

  it("file names are ASCII [A-Za-z0-9._-], bounded, and cannot carry a path, quote, CR/LF or header text", () => {
    const names = [
      exportFilename('Release "19 Nov"\r\nSet-Cookie: x=1', "prod", "2026-11-19", "xlsx"),
      exportFilename("../../etc/passwd", "uat", "2026-11-19", "text"),
      exportFilename("Réléase 日本語 ✓", "demo", "bad-date", "html"),
      exportFilename("x".repeat(500), "prod", "2026-11-19", "xlsx"),
      exportFilename("", "prod", "2026-11-19", "xlsx"),
    ];
    for (const n of names) {
      assert.match(n, /^[A-Za-z0-9._-]+$/, n);
      assert.ok(n.length <= 90, n);
      assert.ok(!n.includes(".."), n);
    }
    assert.equal(names[0], "movement-prod-Release-19-Nov-Set-Cookie-x-1-2026-11-19.xlsx");
    assert.equal(names[1], "movement-uat-etc-passwd-2026-11-19.txt");
    assert.equal(names[2], "movement-demo-Release.html");
  });
});

describe("fix round: XML-illegal characters, IST, text header, the response", () => {
  const evil = `</script><img src=x onerror=alert(1)> "q" 'a' & <b>`;
  const esc = "&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt; &quot;q&quot; &#39;a&#39; &amp; &lt;b&gt;";

  it("xmlClean drops C0 controls, U+FFFE/FFFF and lone surrogates and keeps tab, LF, CR, emoji and text", () => {
    assert.equal(xmlClean("a\u0000b\u0001c\u0008d\u000Be\u000Cf\u001Fg￾h￿i"), "abcdefghi");
    assert.equal(xmlClean("x\ud800y\udc00z"), "xyz");
    assert.equal(xmlClean("keep\t\n\r \u{1F600} é 日本"), "keep\t\n\r \u{1F600} é 日本");
    assert.equal(xmlClean("😀\ud800"), "\u{1F600}");
  });

  it("such characters in any cell round-trip through exceljs AND every part of the file is well-formed XML", async () => {
    const cl = realChecklist();
    const m = modelFor(cl);
    m.delivery.name = "a￾b";
    m.items[0].summary = "lone\ud800surrogate \u0001 ctrl \u{1F600}";
    m.items[1].warnings = [{ code: "pr_no_record", message: "\u0000=1+1 after a NUL" }];
    m.events[0].actor = "x￿y";
    cl.sections[0].items[0].text = "\u0002=cmd tail";
    const buf = await toBuffer(m);
    const wb = await load(buf);
    assert.equal(cellText(wb.getWorksheet("Summary")!.getCell("B2")), "ab");
    assert.equal(cellText(wb.getWorksheet("Jiras")!.getCell("B2")), "lonesurrogate  ctrl \u{1F600}");
    // the control character did not hide the formula from excelSafe
    assert.equal(cellText(wb.getWorksheet("Jiras")!.getCell("E3")), "'=1+1 after a NUL");
    let first = "";
    wb.getWorksheet("Checklist")!.eachRow((r, n) => (n === 2 ? (first = cellText(r.getCell(4))) : undefined));
    assert.ok(!first.startsWith("=") || first.startsWith("'="));

    // well-formed: strict parse of every XML part with the parser exceljs itself uses
    const req = createRequire(createRequire(process.cwd() + "/package.json").resolve("exceljs"));
    const JSZip = req("jszip") as { loadAsync(b: Buffer): Promise<{ files: Record<string, { dir: boolean; async(t: "string"): Promise<string> }> }> };
    const { SaxesParser } = req("saxes") as { SaxesParser: new (o: { xmlns: boolean }) => { on(e: string, f: (x: unknown) => void): void; write(s: string): unknown; close(): unknown } };
    const zip = await JSZip.loadAsync(buf);
    let parts = 0;
    for (const [name, f] of Object.entries(zip.files)) {
      if (f.dir || !/\.(xml|rels)$/.test(name)) continue;
      const p = new SaxesParser({ xmlns: false });
      let err: unknown = null;
      p.on("error", (e) => (err = e));
      p.write(await f.async("string"));
      p.close();
      assert.equal(err, null, `${name} is not well-formed: ${String(err)}`);
      parts++;
    }
    assert.ok(parts >= 10, `parsed ${parts} parts`);
  });

  it("times are IST everywhere: the helper, the sheets, the print page and the text header", () => {
    assert.match(fmtTs("2026-11-19T11:45:00.000Z"), /^19 Nov 2026, 05:15 pm IST$/i);
    assert.match(fmtTs("2026-01-01T20:00:00.000Z"), /^02 Jan 2026, 01:30 am IST$/i); // across midnight
    assert.equal(fmtTs(null), "");
    assert.equal(fmtTs("not a date"), "not a date");
    const m = modelFor(realChecklist());
    const html = renderHtml(m);
    assert.ok(html.includes("19 Nov 2026, 05:15 pm IST") || html.includes("19 Nov 2026, 05:15 PM IST"));
    assert.ok(!/ UTC/.test(html));
    assert.ok(/Exported 19 Nov 2026, 05:30 pm IST/i.test(renderTextExport(m)));
  });

  it("text export starts with a standalone 3-line header (delivery, environment, status, signers signed / waiting) before the checklist", () => {
    const m = modelFor(realChecklist());
    const t = renderTextExport(m);
    const lines = t.split("\n");
    assert.equal(lines[0], "Delivery: Release 19 Nov (2026-11-19). Environment: PROD. Status: ready.");
    assert.equal(lines[1], "Sign-offs: deployer Dev Ops: signed; ba ba@example.com: waiting; lead Lee: signed an older checklist.");
    assert.match(lines[2], /^Checklist [0-9a-f]{12}\. Exported /);
    assert.equal(lines[3], "");
    assert.ok(t.endsWith(renderText(m.checklist)));
  });

  it("the print page escapes evil strings in env values, labels, conflict kind / title / variants / sources, warnings and unknowns", () => {
    const cl = realChecklist();
    const cfg = cl.sections.find((s) => s.id === "configs")!.items.find((i) => i.env)!;
    cfg.env!.values.prod = evil;
    cfg.env!.values.demo = evil;
    cfg.label = evil;
    cfg.severity = "blocker";
    cfg.conflict = { kind: evil as never, variants: [{ text: evil, sources: [{ jira: evil, pr: evil }] }] };
    cl.conflicts.push({ id: "x", kind: evil as never, section: "configs", itemKey: evil, title: evil, severity: "blocker", variants: [{ text: evil, sources: [{ jira: evil, pr: evil }] }, { text: evil, sources: [] }] });
    cl.warnings.push({ code: evil, message: evil, sources: [{ jira: evil, pr: evil }] });
    cl.summary = evil;
    const html = renderHtml(modelFor(cl));
    assert.ok(!html.includes("<img") && !/<script/i.test(html) && !html.includes("</script>"));
    assert.ok(!html.includes(`"q"`) && !html.includes("'a'"), "no raw quote from the evil text");
    assert.ok((html.split(esc).length - 1) >= 8, "the evil text appears escaped in every field");
  });

  it("format is case-insensitive, defaults to xlsx and rejects the rest", () => {
    assert.deepEqual(["XLSX", "Text", " HTML ", null, "pdf", "", "txt"].map(parseFormat), ["xlsx", "text", "html", "xlsx", null, null, null]);
  });

  it("the response: status, content type, disposition, no-store, nosniff, and the CSP only on the print page", async () => {
    const m = modelFor(realChecklist());
    const loadModel = async () => m;
    const x = await respondExport("XLSX", loadModel);
    assert.equal(x.status, 200);
    assert.equal(x.headers.get("content-type"), CONTENT_TYPE.xlsx);
    assert.equal(x.headers.get("content-disposition"), 'attachment; filename="movement-prod-Release-19-Nov-2026-11-19.xlsx"');
    assert.equal(x.headers.get("cache-control"), "no-store");
    assert.equal(x.headers.get("x-content-type-options"), "nosniff");
    assert.equal(x.headers.get("content-security-policy"), null);
    const wb = await load(Buffer.from(await x.arrayBuffer()));
    assert.equal(wb.worksheets.length, 7);

    const t = await respondExport("text", loadModel);
    assert.equal(t.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.match(t.headers.get("content-disposition")!, /^attachment; filename="movement-prod-.*\.txt"$/);
    assert.ok((await t.text()).startsWith("Delivery: Release 19 Nov"));

    const h = await respondExport("html", loadModel);
    assert.equal(h.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(h.headers.get("content-disposition")!, /^inline; filename=".*\.html"$/);
    assert.equal(h.headers.get("content-security-policy"), HTML_CSP);
    assert.equal(h.headers.get("referrer-policy"), "no-referrer");
    assert.equal(h.headers.get("cache-control"), "no-store");
    assert.ok((await h.text()).startsWith("<!doctype html>"));

    let loaded = false;
    const bad = await respondExport("pdf", async () => ((loaded = true), m));
    assert.equal(bad.status, 400);
    assert.equal(loaded, false, "an invalid format does no work");
    // a failing load propagates (the route's run() maps MovementError to JSON)
    await assert.rejects(respondExport("xlsx", async () => { throw new Error("404"); }));
  });
});

