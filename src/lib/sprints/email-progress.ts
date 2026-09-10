import { compareSprintOrder, type SprintWithItems, type SprintItemRow } from "@/lib/sprints/entries";
import {
  esc,
  tile,
  bar,
  pctColor,
  ctaButton,
  emailShell,
  senderLine,
  messageBlock,
  phaseBadge,
  callout,
  preheader,
  riskCell,
  riskBadge,
  riskTile,
  riskLegend,
  carryBadge,
  carryTile,
  carryCallout,
  carryCountBadge,
  carryFlowCallout,
  RISK_EMAIL_STYLES,
  PROGRESS_LABELS,
  PROGRESS_COLORS,
} from "@/lib/sprints/email-html";
import {
  classifySprintItemRisk,
  summarizeRisk,
  istNowStr,
  RISK_ORDER,
  type RiskCounts,
} from "@/lib/sprints/risk";

// ---------------------------------------------------------------------------
// The stakeholder progress emails — sprint and workstream.
//
// Extracted from the two route handlers for the same reason the workbook lives
// in report.ts: the routes should only do auth, validation and delivery, and
// the thing recipients actually read should be unit-testable.
//
// Both builders return subject AND html together so the risk figures quoted in
// the subject line can never drift from the ones rendered in the body.
// ---------------------------------------------------------------------------

/** Items beyond this stay in the attached workbook; the mail shows the riskiest. */
const MAX_INLINE_ITEMS = 60;

/** Worst risk first, then in-progress before to-do before done. */
const PROGRESS_SORT: Record<string, number> = { in_progress: 0, todo: 1, done: 2 };

export type BuiltEmail = { subject: string; html: string };

/** The compact "3 overdue, 2 at risk" clause, shared by subject and preheader. */
function riskClause(counts: RiskCounts): string {
  const parts: string[] = [];
  if (counts.overdue > 0) parts.push(`${counts.overdue} overdue`);
  if (counts.at_risk > 0) parts.push(`${counts.at_risk} at risk`);
  return parts.join(", ");
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

function unplannedSentence(counts: RiskCounts): string {
  return `${counts.unplanned} item${plural(counts.unplanned)} still have no start or due date.`;
}

function riskTiles(counts: RiskCounts): string {
  const tiles = [
    ...(counts.overdue > 0 ? [riskTile("Overdue", String(counts.overdue), "overdue")] : []),
    ...(counts.at_risk > 0 ? [riskTile("At risk", String(counts.at_risk), "at_risk")] : []),
    ...(counts.unplanned > 0 ? [riskTile("Unplanned", String(counts.unplanned), "unplanned")] : []),
  ];
  if (tiles.length === 0) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${tiles.join("")}</tr></table>`;
}

function phaseOf(s: SprintWithItems): { label: string; kind: "planned" | "active" | "completed" } {
  if (s.completedAt) return { label: "Completed", kind: "completed" };
  if (s.startedAt) return { label: "Active", kind: "active" };
  return { label: "Planned", kind: "planned" };
}

// ---------------------------------------------------------------------------
// Sprint
// ---------------------------------------------------------------------------

export function buildSprintEmail(
  s: SprintWithItems,
  message: string,
  senderName: string,
  sprintUrl: string,
  nowStr: string = istNowStr()
): BuiltEmail {
  const r = s.rollup;
  const committedPct = r.committed > 0 ? Math.round((r.committedDone / r.committed) * 100) : 0;
  const overallPct = r.total > 0 ? Math.round((r.done / r.total) * 100) : 0;

  const ranked = s.items
    .map((item) => ({ item, risk: classifySprintItemRisk(item, nowStr) }))
    .sort((a, b) => {
      const ar = a.risk ? RISK_ORDER[a.risk] : 9;
      const br = b.risk ? RISK_ORDER[b.risk] : 9;
      if (ar !== br) return ar - br;
      const ap = PROGRESS_SORT[a.item.progress] ?? 9;
      const bp = PROGRESS_SORT[b.item.progress] ?? 9;
      if (ap !== bp) return ap - bp;
      return (a.item.dueDate ?? "9999-99-99").localeCompare(b.item.dueDate ?? "9999-99-99");
    });
  const counts = summarizeRisk(s.items, nowStr);
  const clause = riskClause(counts);

  // Issues that crossed a boundary, grouped by the sprint on the other side —
  // normally one group each way, but a sprint closed twice can hand work to
  // more than one, and a sprint can inherit from several.
  //
  // Outbound spans removed rows too: an item moved out mid-sprint drops out of
  // the table below entirely, so that line is the only place the mail can
  // account for it. Inbound reads live rows only — inherited work that has
  // since been dropped isn't this sprint's story.
  const groupBy = (rows: typeof s.items, pick: (i: (typeof s.items)[number]) => string | null) => {
    const by = new Map<string, string[]>();
    for (const item of rows) {
      const name = pick(item);
      if (!name) continue;
      const keys = by.get(name) ?? [];
      keys.push(item.jiraKey);
      by.set(name, keys);
    }
    return [...by].map(([sprintName, keys]) => ({ sprintName, keys }));
  };
  const carriedOutGroups = groupBy([...s.items, ...s.removedItems], (i) => i.carriedToSprintName);
  const carriedInGroups = groupBy(s.items, (i) => i.carriedFromSprintName);

  const subject = `Sprint update: ${s.name}${
    s.startedAt && r.committed > 0 ? ` — ${committedPct}% of commitment done` : ""
  }${clause ? ` · ${clause}` : ""} (${s.startDate} → ${s.endDate})`;

  // The banner is the whole mail for a stakeholder who reads one line: what
  // needs attention, and which items specifically.
  const named = (risk: "overdue" | "at_risk") => {
    const keys = ranked.filter((x) => x.risk === risk).map((x) => x.item.jiraKey);
    const head = keys.slice(0, 6).map(esc).join(", ");
    return keys.length > 6 ? `${head} and ${keys.length - 6} more` : head;
  };
  const banner =
    counts.attention > 0
      ? callout(
          counts.overdue > 0 ? "danger" : "warn",
          `${counts.attention} item${plural(counts.attention)} need${counts.attention === 1 ? "s" : ""} attention${clause ? ` — ${clause}` : ""}`,
          [
            counts.overdue > 0 ? `<strong>Overdue:</strong> ${named("overdue")}` : "",
            counts.at_risk > 0 ? `<strong>At risk:</strong> ${named("at_risk")}` : "",
            counts.unplanned > 0
              ? `<strong>Unplanned:</strong> ${counts.unplanned} item${plural(counts.unplanned)} with no start or due date`
              : "",
          ]
            .filter(Boolean)
            .join("<br>")
        )
      : callout(
          "ok",
          "Nothing overdue or at risk",
          counts.unplanned > 0
            ? unplannedSentence(counts)
            : `All ${r.total} item${plural(r.total)} are inside their planned dates.`
        );

  const tiles = s.startedAt
    ? [
        tile("Committed", String(r.committed)),
        tile("Commitment done", `${committedPct}%`, pctColor(committedPct)),
        tile("In progress", String(r.inProgress), "#1d4ed8"),
        tile("To do", String(r.todo)),
        ...(r.addedAfterStart > 0 ? [tile("Added after start", String(r.addedAfterStart), "#b45309")] : []),
        ...(r.removed > 0 ? [tile("Removed", String(r.removed), "#6b7280")] : []),
        ...(r.carriedOver > 0 ? [carryTile("Carried in", String(r.carriedOver))] : []),
        ...(r.carriedOut > 0 ? [carryTile("Carried forward", String(r.carriedOut))] : []),
      ]
    : [
        tile("Planned issues", String(r.total)),
        tile("Done", String(r.done), "#047857"),
        tile("In progress", String(r.inProgress), "#1d4ed8"),
        tile("To do", String(r.todo)),
        // A sprint that hasn't started is exactly where inherited work waits,
        // so this tile matters MORE here, not less.
        ...(r.carriedOver > 0 ? [carryTile("Carried in", String(r.carriedOver))] : []),
      ];

  const shown = ranked.slice(0, MAX_INLINE_ITEMS);
  // Explain the carryover tags only when the table actually carries some —
  // a legend for a marker that isn't on screen is just noise.
  const hasCarryTags = shown.some((x) => x.item.carriedFromSprintName || x.item.carriedToSprintName);
  const itemRows = shown
    .map(({ item, risk }, i) => {
      const style = risk ? RISK_EMAIL_STYLES[risk] : null;
      const rowBg = style ? style.row : i % 2 === 1 ? "#f0fdfa" : "#ffffff";
      const accent = style ? style.fg : "transparent";
      const cell = `padding:5px 8px;font-size:12px;border-bottom:1px solid #f4f4f5;`;
      const scope =
        !s.startedAt || item.committed
          ? ""
          : ` <span style="color:#b45309;font-size:11px;">*added mid-sprint</span>`;
      // Both directions of carryover, under the summary: where the issue came
      // from, and — the part the closed sprint's own report could never show —
      // where it went when this sprint ran out of time.
      const carry = [
        item.carriedFromSprintName ? carryBadge("in", item.carriedFromSprintName) : "",
        item.carriedToSprintName ? carryBadge("out", item.carriedToSprintName) : "",
      ]
        .filter(Boolean)
        .join(" ");
      const carryHtml = carry ? `<div style="margin-top:3px;">${carry}</div>` : "";
      const link = `${item.jiraBaseUrl.replace(/\/$/, "")}/browse/${item.jiraKey}`;
      const dueColor = risk === "overdue" ? "#b91c1c" : risk === "at_risk" ? "#b45309" : "#6b7280";
      const dueWeight = risk === "overdue" || risk === "at_risk" ? "700" : "400";
      return `<tr style="background:${rowBg};">
        <td style="${cell}white-space:nowrap;border-left:3px solid ${accent};"><a href="${link}" style="color:#0f766e;font-weight:600;text-decoration:none;">${esc(item.jiraKey)}</a></td>
        <td style="${cell}color:#111827;">${esc(item.summary)}${scope}${carryHtml}</td>
        <td style="${cell}white-space:nowrap;">${riskCell(risk, item.progress === "done")}</td>
        <td style="${cell}white-space:nowrap;font-weight:600;color:${PROGRESS_COLORS[item.progress]};">${PROGRESS_LABELS[item.progress]}</td>
        <td style="${cell}white-space:nowrap;color:#6b7280;">${esc(item.assigneeName ?? "Unassigned")}</td>
        <td style="${cell}white-space:nowrap;color:${dueColor};font-weight:${dueWeight};">${item.dueDate ?? "—"}</td>
      </tr>`;
    })
    .join("");
  const moreLine =
    ranked.length > shown.length
      ? `<p style="font-size:12px;color:#6b7280;">…and ${ranked.length - shown.length} more at lower risk than the rows above — full detail in the attached report.</p>`
      : "";

  const html = emailShell(
    s.name,
    `${s.startDate} → ${s.endDate}${s.goal ? ` · ${esc(s.goal)}` : ""}`,
    `
      ${preheader(
        `${overallPct}% done${clause ? ` · ${clause}` : " · nothing overdue or at risk"}${
          r.carriedOver > 0 ? ` · ${r.carriedOver} carried in` : ""
        }${r.carriedOut > 0 ? ` · ${r.carriedOut} carried forward` : ""} · ${s.startDate} to ${s.endDate}`
      )}
      ${senderLine(phaseBadge(phaseOf(s).label, phaseOf(s).kind), senderName)}
      ${messageBlock(message)}
      ${banner}
      ${carryCallout("in", carriedInGroups)}
      ${carryCallout("out", carriedOutGroups)}
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>${tiles.join("")}</tr></table>
      ${riskTiles(counts)}
      <div style="margin:8px 0 4px;font-size:12px;color:#6b7280;">Overall progress — <strong style="color:#111827;">${r.done} of ${r.total} done (${overallPct}%)</strong></div>
      ${bar(overallPct, "#0d9488")}
      ${
        s.startedAt && r.committed > 0
          ? `<div style="margin:10px 0 4px;font-size:12px;color:#6b7280;">Committed scope — <strong style="color:#111827;">${r.committedDone} of ${r.committed} done (${committedPct}%)</strong></div>${bar(committedPct, "#1d4ed8")}`
          : ""
      }
      <div style="margin:18px 0;">${ctaButton(sprintUrl, "Open sprint in Flux →")}</div>
      <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">Items, highest risk first</div>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e5e7eb;border-collapse:collapse;">
        <tr style="background:#0d9488;color:#ffffff;">
          <th align="left" style="padding:6px 8px;font-size:11px;">Key</th>
          <th align="left" style="padding:6px 8px;font-size:11px;">Summary</th>
          <th align="left" style="padding:6px 8px;font-size:11px;">Risk</th>
          <th align="left" style="padding:6px 8px;font-size:11px;">Status</th>
          <th align="left" style="padding:6px 8px;font-size:11px;">Assignee</th>
          <th align="left" style="padding:6px 8px;font-size:11px;">Due</th>
        </tr>
        ${itemRows}
      </table>
      ${riskLegend()}
      ${moreLine}
      <p style="font-size:12px;color:#6b7280;margin-top:16px;">Risk is judged against IST.${
        hasCarryTags
          ? ` A <strong style="color:#6d28d9;">&#8617; Carried from</strong> tag means the item came in unfinished from an earlier sprint; <strong style="color:#6d28d9;">&#8618; Carried to</strong> means it moved on to a later one.`
          : ""
      } The attached Excel report has the complete breakdown — every item with dates, risk, scope changes, and removals. Or <a href="${sprintUrl}" style="color:#0f766e;">open the live sprint in Flux</a>.</p>`
  );

  return { subject, html };
}

// ---------------------------------------------------------------------------
// Workstream
// ---------------------------------------------------------------------------

type Agg = {
  committed: number;
  committedDone: number;
  done: number;
  total: number;
  addedAfterStart: number;
  active: number;
  planned: number;
  completed: number;
};

function aggregate(sprints: SprintWithItems[], live: (s: SprintWithItems) => SprintItemRow[]): Agg {
  const out: Agg = { committed: 0, committedDone: 0, done: 0, total: 0, addedAfterStart: 0, active: 0, planned: 0, completed: 0 };
  for (const s of sprints) {
    // Commitment stays a historical fact of the sprint that made it: a sprint
    // that committed to 26 and delivered 24 committed to 26, whatever became
    // of the 2 it missed. Deduping these would quietly rewrite it to 24/24.
    out.committed += s.rollup.committed;
    out.committedDone += s.rollup.committedDone;
    out.addedAfterStart += s.rollup.addedAfterStart;
    // Current state is a question about ISSUES, not rows — see liveItemsOf.
    const items = live(s);
    out.total += items.length;
    out.done += items.filter((i) => i.progress === "done").length;
    if (s.completedAt) out.completed += 1;
    else if (s.startedAt) out.active += 1;
    else out.planned += 1;
  }
  return out;
}

/** Per-sprint risk summary for the breakdown table. */
function sprintRiskCell(counts: RiskCounts): string {
  const parts = [
    counts.overdue > 0 ? riskBadge("overdue", `${counts.overdue} overdue`) : "",
    counts.at_risk > 0 ? riskBadge("at_risk", `${counts.at_risk} at risk`) : "",
    counts.unplanned > 0 ? riskBadge("unplanned", `${counts.unplanned} unplanned`) : "",
  ].filter(Boolean);
  if (parts.length === 0) return `<span style="font-size:11px;color:#059669;">On track</span>`;
  return parts.join(" ");
}

export function buildWorkstreamEmail(
  name: string,
  description: string | null,
  sprints: SprintWithItems[],
  message: string,
  senderName: string,
  workstreamUrl: string,
  appUrl: string,
  nowStr: string = istNowStr()
): BuiltEmail {
  // A carryover leaves a row in BOTH sprints — the record in the one that ran
  // out of time, the live copy in the one that picked it up — so summing
  // sprints counts that issue twice, and the risk banner reports two overdue
  // items where there is one. Whenever both ends are in this mail, the row in
  // the sprint that handed it on is history: current-state figures count the
  // live copy only. (A carryover OUT of this workstream keeps its row here,
  // since its destination isn't in this mail to be counted instead.)
  const inThisMail = new Set(sprints.map((sp) => sp.id));
  const liveItemsOf = (sp: SprintWithItems): SprintItemRow[] =>
    sp.items.filter((i) => !(i.carriedToSprintId && inThisMail.has(i.carriedToSprintId)));
  const supersededCount = sprints.reduce((n, sp) => n + (sp.items.length - liveItemsOf(sp).length), 0);

  // Movement between the sprints in this mail, as a flow — at this altitude
  // "a boundary was crossed, between these two sprints" is the story.
  const flows: { from: string; to: string; keys: string[] }[] = [];
  {
    const byPair = new Map<string, { from: string; to: string; keys: string[] }>();
    for (const sp of sprints) {
      for (const item of [...sp.items, ...sp.removedItems]) {
        if (!item.carriedToSprintName) continue;
        const key = `${sp.name}→${item.carriedToSprintName}`;
        const entry = byPair.get(key) ?? { from: sp.name, to: item.carriedToSprintName, keys: [] };
        entry.keys.push(item.jiraKey);
        byPair.set(key, entry);
      }
    }
    flows.push(...byPair.values());
  }

  const agg = aggregate(sprints, liveItemsOf);
  const committedPct = agg.committed > 0 ? Math.round((agg.committedDone / agg.committed) * 100) : 0;
  const overallPct = agg.total > 0 ? Math.round((agg.done / agg.total) * 100) : 0;
  const minStart = sprints.reduce<string | null>((m, s) => (m === null || s.startDate < m ? s.startDate : m), null);
  const maxEnd = sprints.reduce<string | null>((m, s) => (m === null || s.endDate > m ? s.endDate : m), null);

  const perSprint = sprints.map((s) => ({ sprint: s, counts: summarizeRisk(liveItemsOf(s), nowStr) }));
  const counts = summarizeRisk(sprints.flatMap(liveItemsOf), nowStr);
  const clause = riskClause(counts);
  const sp = plural(sprints.length);

  const subject = `Workstream update: ${name}${
    agg.committed > 0 ? ` — ${committedPct}% of commitment done` : ""
  }${clause ? ` · ${clause}` : ""} (${sprints.length} sprint${sp})`;

  // Which sprints the trouble sits in — more actionable at this altitude than
  // naming individual issues.
  const worstSprints = perSprint
    .filter((x) => x.counts.attention > 0)
    .sort((a, b) => b.counts.overdue - a.counts.overdue || b.counts.at_risk - a.counts.at_risk)
    .slice(0, 4)
    // Picked by severity, then listed in sprint order — the worst four, but
    // never in an order that contradicts the table below.
    .sort((a, b) => compareSprintOrder(a.sprint, b.sprint))
    .map((x) => `${esc(x.sprint.name)} (${riskClause(x.counts)})`);

  const banner =
    counts.attention > 0
      ? callout(
          counts.overdue > 0 ? "danger" : "warn",
          `${counts.attention} item${plural(counts.attention)} need${counts.attention === 1 ? "s" : ""} attention${clause ? ` — ${clause}` : ""}`,
          [
            worstSprints.length > 0 ? `<strong>Concentrated in:</strong> ${worstSprints.join(" · ")}` : "",
            counts.unplanned > 0
              ? `<strong>Unplanned:</strong> ${counts.unplanned} item${plural(counts.unplanned)} with no start or due date`
              : "",
          ]
            .filter(Boolean)
            .join("<br>")
        )
      : callout(
          "ok",
          "Nothing overdue or at risk",
          counts.unplanned > 0
            ? unplannedSentence(counts)
            : `All ${agg.total} item${plural(agg.total)} across ${sprints.length} sprint${sp} are inside their planned dates.`
        );

  const tiles = [
    tile("Sprints", String(sprints.length)),
    ...(agg.committed > 0
      ? [tile("Committed", String(agg.committed)), tile("Commitment done", `${committedPct}%`, pctColor(committedPct))]
      : []),
    tile("Done", String(agg.done), "#047857"),
    tile("Total items", String(agg.total)),
    ...(agg.addedAfterStart > 0 ? [tile("Added after start", String(agg.addedAfterStart), "#b45309")] : []),
  ];

  // Sprint order, not risk order. Trouble is still impossible to miss — the
  // banner names the sprints it sits in, and each row keeps its red tint and
  // risk badge — but a breakdown that reshuffles itself as due dates pass is
  // one the reader has to re-orient in every single week's mail.
  const orderedSprints = [...perSprint].sort((a, b) => compareSprintOrder(a.sprint, b.sprint));

  const sprintRows = orderedSprints
    .map(({ sprint: s, counts: c }, i) => {
      const phase = phaseOf(s);
      const r = s.rollup;
      const pct = r.committed > 0 ? Math.round((r.committedDone / r.committed) * 100) : null;
      const style = c.overdue > 0 ? RISK_EMAIL_STYLES.overdue : c.at_risk > 0 ? RISK_EMAIL_STYLES.at_risk : null;
      const rowBg = style ? style.row : i % 2 === 1 ? "#f0fdfa" : "#ffffff";
      const accent = style ? style.fg : "transparent";
      const cell = `padding:6px 8px;font-size:12px;border-bottom:1px solid #f4f4f5;`;
      return `<tr style="background:${rowBg};">
        <td style="${cell}border-left:3px solid ${accent};"><a href="${appUrl}/sprints/${s.id}" style="color:#0f766e;font-weight:600;text-decoration:none;">${esc(s.name)}</a></td>
        <td style="${cell}white-space:nowrap;color:#6b7280;">${s.startDate} → ${s.endDate}</td>
        <td style="${cell}white-space:nowrap;">${phaseBadge(phase.label, phase.kind)}</td>
        <td style="${cell}white-space:nowrap;">${sprintRiskCell(c)}</td>
        <td style="${cell}white-space:nowrap;color:#111827;">${
          pct !== null ? `<strong style="color:${pctColor(pct)};">${r.committedDone}/${r.committed} (${pct}%)</strong>` : "—"
        }</td>
        <td style="${cell}color:#6b7280;">
          <span style="white-space:nowrap;">${r.done} done · ${r.inProgress} in progress · ${r.todo} to do</span>${
            r.carriedOver > 0 || r.carriedOut > 0
              ? `<div style="margin-top:4px;">${r.carriedOver > 0 ? carryCountBadge("in", r.carriedOver) : ""}${
                  r.carriedOver > 0 && r.carriedOut > 0 ? " " : ""
                }${r.carriedOut > 0 ? carryCountBadge("out", r.carriedOut) : ""}</div>`
              : ""
          }
        </td>
      </tr>`;
    })
    .join("");

  const html = emailShell(
    name,
    `Workstream${minStart && maxEnd ? ` · ${minStart} → ${maxEnd}` : ""}${description ? ` · ${esc(description)}` : ""}`,
    `
      ${preheader(
        `${overallPct}% done across ${sprints.length} sprint${sp}${clause ? ` · ${clause}` : " · nothing overdue or at risk"}`
      )}
      ${senderLine(
        phaseBadge(
          `${sprints.length} sprint${sp} · ${agg.active} active`,
          agg.active > 0 ? "active" : agg.completed === sprints.length && sprints.length > 0 ? "completed" : "planned"
        ),
        senderName
      )}
      ${messageBlock(message)}
      ${banner}
      ${carryFlowCallout(flows)}
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>${tiles.join("")}</tr></table>
      ${riskTiles(counts)}
      <div style="margin:8px 0 4px;font-size:12px;color:#6b7280;">Overall progress across sprints — <strong style="color:#111827;">${agg.done} of ${agg.total} done (${overallPct}%)</strong></div>
      ${bar(overallPct, "#0d9488")}
      ${
        agg.committed > 0
          ? `<div style="margin:10px 0 4px;font-size:12px;color:#6b7280;">Committed scope — <strong style="color:#111827;">${agg.committedDone} of ${agg.committed} done (${committedPct}%)</strong></div>${bar(committedPct, "#1d4ed8")}`
          : ""
      }
      <div style="margin:18px 0;">${ctaButton(workstreamUrl, "Open workstream in Flux →")}</div>
      <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">Sprints, in order</div>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e5e7eb;border-collapse:collapse;">
        <tr style="background:#0d9488;color:#ffffff;">
          <th align="left" style="padding:6px 8px;font-size:11px;">Sprint</th>
          <th align="left" style="padding:6px 8px;font-size:11px;">Time box</th>
          <th align="left" style="padding:6px 8px;font-size:11px;">Phase</th>
          <th align="left" style="padding:6px 8px;font-size:11px;">Risk</th>
          <th align="left" style="padding:6px 8px;font-size:11px;">Commitment done</th>
          <th align="left" style="padding:6px 8px;font-size:11px;">Progress</th>
        </tr>
        ${sprintRows}
      </table>
      ${riskLegend()}
      ${
        supersededCount > 0
          ? `<p style="font-size:11px;color:#6d28d9;margin-top:10px;">Totals and risk count each issue once: ${supersededCount} carried-over item${
              supersededCount === 1 ? " is" : "s are"
            } counted in the sprint holding ${supersededCount === 1 ? "it" : "them"} now, not in the one ${
              supersededCount === 1 ? "it" : "they"
            } left. Each sprint's own commitment figures are untouched.</p>`
          : ""
      }
      <p style="font-size:12px;color:#6b7280;margin-top:16px;">Risk is judged against IST. The attached Excel report has the complete breakdown of every sprint — all items with dates, risk, scope changes, and removals. Or <a href="${workstreamUrl}" style="color:#0f766e;">open the live workstream in Flux</a>.</p>`
  );

  return { subject, html };
}
