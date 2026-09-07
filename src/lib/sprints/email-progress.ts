import type { SprintWithItems } from "@/lib/sprints/entries";
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
      ]
    : [
        tile("Planned issues", String(r.total)),
        tile("Done", String(r.done), "#047857"),
        tile("In progress", String(r.inProgress), "#1d4ed8"),
        tile("To do", String(r.todo)),
      ];

  const shown = ranked.slice(0, MAX_INLINE_ITEMS);
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
      const link = `${item.jiraBaseUrl.replace(/\/$/, "")}/browse/${item.jiraKey}`;
      const dueColor = risk === "overdue" ? "#b91c1c" : risk === "at_risk" ? "#b45309" : "#6b7280";
      const dueWeight = risk === "overdue" || risk === "at_risk" ? "700" : "400";
      return `<tr style="background:${rowBg};">
        <td style="${cell}white-space:nowrap;border-left:3px solid ${accent};"><a href="${link}" style="color:#0f766e;font-weight:600;text-decoration:none;">${esc(item.jiraKey)}</a></td>
        <td style="${cell}color:#111827;">${esc(item.summary)}${scope}</td>
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
        `${overallPct}% done${clause ? ` · ${clause}` : " · nothing overdue or at risk"} · ${s.startDate} to ${s.endDate}`
      )}
      ${senderLine(phaseBadge(phaseOf(s).label, phaseOf(s).kind), senderName)}
      ${messageBlock(message)}
      ${banner}
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
      <p style="font-size:12px;color:#6b7280;margin-top:16px;">Risk is judged against IST. The attached Excel report has the complete breakdown — every item with dates, risk, scope changes, and removals. Or <a href="${sprintUrl}" style="color:#0f766e;">open the live sprint in Flux</a>.</p>`
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

function aggregate(sprints: SprintWithItems[]): Agg {
  const out: Agg = { committed: 0, committedDone: 0, done: 0, total: 0, addedAfterStart: 0, active: 0, planned: 0, completed: 0 };
  for (const s of sprints) {
    out.committed += s.rollup.committed;
    out.committedDone += s.rollup.committedDone;
    out.done += s.rollup.done;
    out.total += s.rollup.total;
    out.addedAfterStart += s.rollup.addedAfterStart;
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
  const agg = aggregate(sprints);
  const committedPct = agg.committed > 0 ? Math.round((agg.committedDone / agg.committed) * 100) : 0;
  const overallPct = agg.total > 0 ? Math.round((agg.done / agg.total) * 100) : 0;
  const minStart = sprints.reduce<string | null>((m, s) => (m === null || s.startDate < m ? s.startDate : m), null);
  const maxEnd = sprints.reduce<string | null>((m, s) => (m === null || s.endDate > m ? s.endDate : m), null);

  const perSprint = sprints.map((s) => ({ sprint: s, counts: summarizeRisk(s.items, nowStr) }));
  const counts = summarizeRisk(
    sprints.flatMap((s) => s.items),
    nowStr
  );
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

  // Sprints carrying overdue work first, so the breakdown leads with trouble.
  const rankedSprints = [...perSprint].sort(
    (a, b) =>
      b.counts.overdue - a.counts.overdue ||
      b.counts.at_risk - a.counts.at_risk ||
      a.sprint.startDate.localeCompare(b.sprint.startDate)
  );

  const sprintRows = rankedSprints
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
        <td style="${cell}white-space:nowrap;color:#6b7280;">${r.done} done · ${r.inProgress} in progress · ${r.todo} to do</td>
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
      <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">Sprints, most overdue work first</div>
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
      <p style="font-size:12px;color:#6b7280;margin-top:16px;">Risk is judged against IST. The attached Excel report has the complete breakdown of every sprint — all items with dates, risk, scope changes, and removals. Or <a href="${workstreamUrl}" style="color:#0f766e;">open the live workstream in Flux</a>.</p>`
  );

  return { subject, html };
}
