import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { extractStartDate, extractDueDate, extractActualStart, extractActualEnd } from "@/lib/jira/dates";

// ---------------------------------------------------------------------------
// Sprint read layer — mirrors lib/deliveries/entries.ts (header + items join,
// rollup computed in JS) but with standard Scrum semantics:
//
//   lifecycle  planned → active → closed. A sprint is active because someone
//              STARTED it (started_at), not because its start date arrived.
//   commitment stamped at start: items in the sprint at that moment have
//              committed = true (Jira Sprint Report's "committed" set).
//   scope      items added after start stay committed = false ("added after
//              start", the report's asterisk set); items removed from an
//              active sprint are soft-removed and reported, not erased.
//   progress   derived from the issue's synced Jira status category, bucketed
//              the same way statusCategoryStyles does in the UI — never set
//              by hand.
// ---------------------------------------------------------------------------

export type SprintItemProgress = "todo" | "in_progress" | "done";

/** Same category → bucket mapping as statusCategoryStyles / the /api/search filters. */
export function bucketStatusCategory(category: string | null): SprintItemProgress {
  const key = (category ?? "").trim().toLowerCase();
  if (key === "done" || key === "complete") return "done";
  if (key === "in progress" || key === "indeterminate") return "in_progress";
  return "todo";
}

export type SprintItemRow = {
  id: string;
  issueId: string;
  jiraKey: string;
  jiraBaseUrl: string;
  summary: string;
  jiraStatus: string;
  statusCategory: string | null;
  progress: SprintItemProgress;
  issueType: string | null;
  priority: string | null;
  assigneeEmail: string | null;
  assigneeName: string | null;
  addedBy: string;
  addedByName: string | null;
  addedAt: string;
  // Planned Start/Due and Actual Start/End — same extraction (and same
  // per-project custom-field config, dev-window fallbacks included) the
  // delivery items table uses; see lib/deliveries/entries.ts.
  startDate: string | null;
  dueDate: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  /** In the commitment snapshot taken when the sprint was started. */
  committed: boolean;
  /** Required reason when the item was added to an already-started sprint. */
  addedComment: string | null;
  carriedFromSprintId: string | null;
  carriedFromSprintName: string | null;
  /** Set only on rows in the removedItems list. */
  removedAt: string | null;
  removedByName: string | null;
  /** Required reason when the item was removed from a started sprint. */
  removedComment: string | null;
};

/** Jira Sprint Report shape, issue-count based (no story-points field is configured for these projects). */
export type SprintRollup = {
  /** Active (non-removed) items. */
  total: number;
  todo: number;
  inProgress: number;
  done: number;
  /** The commitment snapshot (committed = true, not removed). */
  committed: number;
  /** Of the commitment, how many are done — the completion-rate numerator. */
  committedDone: number;
  /** Scope added after the sprint started (committed = false on an active/closed sprint). */
  addedAfterStart: number;
  /** Carried over from an earlier sprint. */
  carriedOver: number;
  /** Removed from the sprint after it started. */
  removed: number;
};

export type SprintWithItems = {
  id: string;
  /** Owner: exactly one of projectId (project sprint) / boardId (Team Pulse board sprint). */
  projectId: string | null;
  boardId: string | null;
  /** Optional workstream ("project inside a project") — project sprints only. */
  workstreamId: string | null;
  workstreamName: string | null;
  name: string;
  goal: string | null;
  startDate: string;
  endDate: string;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  startedByName: string | null;
  completedAt: string | null;
  completedByName: string | null;
  items: SprintItemRow[];
  /** Items soft-removed after the sprint started — the report's "removed from sprint" set. */
  removedItems: SprintItemRow[];
  rollup: SprintRollup;
};

export type SprintOption = { id: string; name: string; startDate: string; endDate: string };

function emptyRollup(): SprintRollup {
  return {
    total: 0,
    todo: 0,
    inProgress: 0,
    done: 0,
    committed: 0,
    committedDone: 0,
    addedAfterStart: 0,
    carriedOver: 0,
    removed: 0,
  };
}

type SprintHeaderRow = {
  id: string;
  project_id: string | null;
  board_id: string | null;
  workstream_id: string | null;
  workstream_name: string | null;
  name: string;
  goal: string | null;
  start_date: string;
  end_date: string;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  started_by_name: string | null;
  completed_at: string | null;
  completed_by_name: string | null;
};

type SprintItemJoinRow = {
  id: string;
  sprint_id: string;
  issue_id: string;
  jira_key: string;
  jira_base_url: string;
  summary: string;
  jira_status: string;
  status_category: string | null;
  issue_type: string | null;
  priority: string | null;
  assignee_email: string | null;
  assignee_name: string | null;
  added_by: string;
  added_by_name: string | null;
  added_at: string;
  custom_fields: Record<string, unknown> | null;
  start_date_field_ids: string[] | null;
  end_date_field_ids: string[] | null;
  actual_start_field_ids: string[] | null;
  actual_end_field_ids: string[] | null;
  committed: boolean;
  added_comment: string | null;
  carried_from_sprint_id: string | null;
  carried_from_sprint_name: string | null;
  removed_at: string | null;
  removed_by_name: string | null;
  removed_comment: string | null;
};

/** ISO string for whichever of a Date/timestamp-string/null we got back — raw db.execute rows aren't guaranteed the query builder's driver-level type mapping (same helper as lib/deliveries/entries.ts). */
function toIso(val: string | Date | null): string | null {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function mapItemRow(r: SprintItemJoinRow): SprintItemRow {
  const cf = r.custom_fields ?? {};
  return {
    id: r.id,
    issueId: r.issue_id,
    jiraKey: r.jira_key,
    jiraBaseUrl: r.jira_base_url,
    summary: r.summary,
    jiraStatus: r.jira_status,
    statusCategory: r.status_category,
    progress: bucketStatusCategory(r.status_category),
    issueType: r.issue_type,
    priority: r.priority,
    assigneeEmail: r.assignee_email,
    assigneeName: r.assignee_name,
    addedBy: r.added_by,
    addedByName: r.added_by_name,
    addedAt: r.added_at,
    startDate: extractStartDate(cf, r.start_date_field_ids),
    dueDate: extractDueDate(cf, r.end_date_field_ids),
    // Actual Start/End come ONLY from the project's configured Jira
    // custom fields (jira_projects.actual_start/end_field_ids) — no
    // changelog/dev-window or created/completed fallbacks, so the column
    // shows exactly what's recorded in Jira and stays blank otherwise.
    // (The delivery items table keeps its own fallback chain.)
    actualStart: toIso(extractActualStart(cf, r.actual_start_field_ids)),
    actualEnd: toIso(extractActualEnd(cf, r.actual_end_field_ids)),
    committed: r.committed,
    addedComment: r.added_comment,
    carriedFromSprintId: r.carried_from_sprint_id,
    carriedFromSprintName: r.carried_from_sprint_name,
    removedAt: r.removed_at,
    removedByName: r.removed_by_name,
    removedComment: r.removed_comment,
  };
}

/** Both active and removed items in one query, split in JS — removed rows are few and only shown in the report's "removed" section. */
async function fetchItemsForSprints(
  sprintIds: string[]
): Promise<Map<string, { items: SprintItemRow[]; removed: SprintItemRow[] }>> {
  const bySprint = new Map<string, { items: SprintItemRow[]; removed: SprintItemRow[] }>();
  if (sprintIds.length === 0) return bySprint;

  const rows = (
    await db.execute(sql`
      SELECT
        si.id, si.sprint_id, si.issue_id, si.added_by, si.added_by_name, si.added_at,
        si.committed, si.added_comment, si.carried_from_sprint_id, si.carried_from_sprint_name,
        si.removed_at, si.removed_by_name, si.removed_comment,
        ji.jira_key, ji.summary, ji.status AS jira_status, ji.status_category,
        ji.issue_type, ji.priority, ji.assignee_email, ji.assignee_name,
        ji.custom_fields,
        jp.jira_base_url AS jira_base_url,
        jp.start_date_field_ids, jp.end_date_field_ids,
        jp.actual_start_field_ids, jp.actual_end_field_ids
      FROM sprint_items si
      JOIN jira_issues ji ON ji.id = si.issue_id
      JOIN jira_projects jp ON jp.id = ji.project_id
      WHERE si.sprint_id IN (${sql.join(sprintIds.map((id) => sql`${id}`), sql`, `)})
      ORDER BY ji.jira_key ASC
    `)
  ).rows as unknown as SprintItemJoinRow[];

  for (const r of rows) {
    const entry = bySprint.get(r.sprint_id) ?? { items: [], removed: [] };
    (r.removed_at ? entry.removed : entry.items).push(mapItemRow(r));
    bySprint.set(r.sprint_id, entry);
  }
  return bySprint;
}

function headerToSprint(
  h: SprintHeaderRow,
  items: SprintItemRow[],
  removedItems: SprintItemRow[]
): SprintWithItems {
  const rollup = emptyRollup();
  for (const item of items) {
    rollup.total += 1;
    if (item.progress === "done") rollup.done += 1;
    else if (item.progress === "in_progress") rollup.inProgress += 1;
    else rollup.todo += 1;
    if (item.committed) {
      rollup.committed += 1;
      if (item.progress === "done") rollup.committedDone += 1;
    } else if (h.started_at) {
      // Before the sprint starts nothing is "scope change" — everything is
      // just planning. The bucket only exists once a commitment exists.
      rollup.addedAfterStart += 1;
    }
    if (item.carriedFromSprintId || item.carriedFromSprintName) rollup.carriedOver += 1;
  }
  rollup.removed = removedItems.length;
  return {
    id: h.id,
    projectId: h.project_id,
    boardId: h.board_id,
    workstreamId: h.workstream_id,
    workstreamName: h.workstream_name,
    name: h.name,
    goal: h.goal,
    startDate: h.start_date,
    endDate: h.end_date,
    createdBy: h.created_by,
    createdByName: h.created_by_name,
    createdAt: h.created_at,
    updatedAt: h.updated_at,
    startedAt: h.started_at,
    startedByName: h.started_by_name,
    completedAt: h.completed_at,
    completedByName: h.completed_by_name,
    items,
    removedItems,
    rollup,
  };
}

const SPRINT_HEADER_COLUMNS = sql`
  id, project_id, board_id, workstream_id, name, goal, start_date, end_date,
  created_by, created_by_name, created_at, updated_at,
  started_at, started_by_name, completed_at, completed_by_name,
  (SELECT w.name FROM sprint_workstreams w WHERE w.id = sprints.workstream_id) AS workstream_name
`;

/** Every active sprint for a project with items + rollup, newest start first (current sprint on top). Completed sprints are included — the client default-hides them behind a toggle, matching the deliveries tab. */
export async function fetchProjectSprints(projectId: string): Promise<SprintWithItems[]> {
  const headers = (
    await db.execute(sql`
      SELECT ${SPRINT_HEADER_COLUMNS}
      FROM sprints
      WHERE project_id = ${projectId} AND deleted_at IS NULL
      ORDER BY start_date DESC, created_at DESC
    `)
  ).rows as unknown as SprintHeaderRow[];

  const itemsBySprint = await fetchItemsForSprints(headers.map((h) => h.id));
  return headers.map((h) => {
    const entry = itemsBySprint.get(h.id) ?? { items: [], removed: [] };
    return headerToSprint(h, entry.items, entry.removed);
  });
}

/** Every active sprint owned by a Team Pulse board, items + rollup — the board-sprint mirror of fetchProjectSprints. */
export async function fetchBoardSprints(boardId: string): Promise<SprintWithItems[]> {
  const headers = (
    await db.execute(sql`
      SELECT ${SPRINT_HEADER_COLUMNS}
      FROM sprints
      WHERE board_id = ${boardId} AND deleted_at IS NULL
      ORDER BY start_date DESC, created_at DESC
    `)
  ).rows as unknown as SprintHeaderRow[];

  const itemsBySprint = await fetchItemsForSprints(headers.map((h) => h.id));
  return headers.map((h) => {
    const entry = itemsBySprint.get(h.id) ?? { items: [], removed: [] };
    return headerToSprint(h, entry.items, entry.removed);
  });
}

/** Open board sprints as spillover targets — the board mirror of fetchProjectSprintOptions. */
export async function fetchBoardSprintOptions(boardId: string): Promise<SprintOption[]> {
  const rows = (
    await db.execute(sql`
      SELECT id, name, start_date, end_date
      FROM sprints
      WHERE board_id = ${boardId} AND deleted_at IS NULL AND completed_at IS NULL
      ORDER BY start_date ASC
    `)
  ).rows as unknown as { id: string; name: string; start_date: string; end_date: string }[];
  return rows.map((r) => ({ id: r.id, name: r.name, startDate: r.start_date, endDate: r.end_date }));
}

/** Light {id, name, dates} list of OPEN sprints — backs the spillover target picker in the close flow. Excludes completed sprints: work carries forward into an open iteration, never a closed one. */
export async function fetchProjectSprintOptions(projectId: string): Promise<SprintOption[]> {
  const rows = (
    await db.execute(sql`
      SELECT id, name, start_date, end_date
      FROM sprints
      WHERE project_id = ${projectId} AND deleted_at IS NULL AND completed_at IS NULL
      ORDER BY start_date ASC
    `)
  ).rows as unknown as { id: string; name: string; start_date: string; end_date: string }[];
  return rows.map((r) => ({ id: r.id, name: r.name, startDate: r.start_date, endDate: r.end_date }));
}

export type SprintWorkstream = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  createdByName: string | null;
  createdAt: string;
  /** Non-deleted sprints currently in the workstream. */
  sprintCount: number;
};

type WorkstreamRow = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  created_by_name: string | null;
  created_at: string;
  sprint_count: number;
};

function mapWorkstream(r: WorkstreamRow): SprintWorkstream {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    description: r.description,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    sprintCount: r.sprint_count,
  };
}

/** All workstreams of a project with live sprint counts, oldest first (stable section order). */
export async function fetchProjectWorkstreams(projectId: string): Promise<SprintWorkstream[]> {
  const rows = (
    await db.execute(sql`
      SELECT
        w.id, w.project_id, w.name, w.description, w.created_by_name, w.created_at,
        COUNT(s.id) FILTER (WHERE s.deleted_at IS NULL)::int AS sprint_count
      FROM sprint_workstreams w
      LEFT JOIN sprints s ON s.workstream_id = w.id
      WHERE w.project_id = ${projectId}
      GROUP BY w.id
      ORDER BY w.created_at ASC
    `)
  ).rows as unknown as WorkstreamRow[];
  return rows.map(mapWorkstream);
}

/** One workstream plus its sprints (full items + rollups) — backs the /workstreams/[id] page. */
export async function fetchWorkstreamById(
  workstreamId: string
): Promise<{ workstream: SprintWorkstream; sprints: SprintWithItems[] } | null> {
  const rows = (
    await db.execute(sql`
      SELECT
        w.id, w.project_id, w.name, w.description, w.created_by_name, w.created_at,
        COUNT(s.id) FILTER (WHERE s.deleted_at IS NULL)::int AS sprint_count
      FROM sprint_workstreams w
      LEFT JOIN sprints s ON s.workstream_id = w.id
      WHERE w.id = ${workstreamId}
      GROUP BY w.id
      LIMIT 1
    `)
  ).rows as unknown as WorkstreamRow[];
  const row = rows[0];
  if (!row) return null;

  const headers = (
    await db.execute(sql`
      SELECT ${SPRINT_HEADER_COLUMNS}
      FROM sprints
      WHERE workstream_id = ${workstreamId} AND deleted_at IS NULL
      ORDER BY start_date DESC, created_at DESC
    `)
  ).rows as unknown as SprintHeaderRow[];

  const itemsBySprint = await fetchItemsForSprints(headers.map((h) => h.id));
  const sprints = headers.map((h) => {
    const entry = itemsBySprint.get(h.id) ?? { items: [], removed: [] };
    return headerToSprint(h, entry.items, entry.removed);
  });
  return { workstream: mapWorkstream(row), sprints };
}

/** One sprint, fully joined — returned fresh after every mutation. */
export async function fetchSprintById(sprintId: string): Promise<SprintWithItems | null> {
  const headers = (
    await db.execute(sql`
      SELECT ${SPRINT_HEADER_COLUMNS}
      FROM sprints
      WHERE id = ${sprintId} AND deleted_at IS NULL
      LIMIT 1
    `)
  ).rows as unknown as SprintHeaderRow[];
  const header = headers[0];
  if (!header) return null;

  const itemsBySprint = await fetchItemsForSprints([sprintId]);
  const entry = itemsBySprint.get(sprintId) ?? { items: [], removed: [] };
  return headerToSprint(header, entry.items, entry.removed);
}
