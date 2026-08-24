import { sql, eq, getTableName, is, Column, type AnyColumn, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { jiraIssues } from "@/lib/db/schema";
import { getStatusRawSets } from "@/lib/jira/sync";
import { localDateStr } from "@/lib/date-utils";
import type { DeliveryStatusValue } from "@/lib/deliveries/status";

export type DeliveryItemRow = {
  id: string;
  issueId: string;
  jiraKey: string;
  jiraBaseUrl: string;
  summary: string;
  jiraStatus: string;
  priority: string | null;
  assigneeEmail: string | null;
  assigneeName: string | null;
  addedBy: string;
  addedByName: string | null;
  addedAt: string;
  status: DeliveryStatusValue;
  statusComment: string | null;
  statusSetBy: string | null;
  statusSetByName: string | null;
  statusSetAt: string | null;
};

export type DeliveryRollup = {
  total: number;
  delivered: number;
  partiallyDelivered: number;
  notDelivered: number;
  pending: number;
};

export type DeliveryWithItems = {
  id: string;
  projectId: string;
  name: string;
  deliveryDate: string;
  notifyDaysBefore: number;
  responsibleEmails: string[];
  responsibleNames: string[];
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  // Set once every item's status is "delivered" AND someone explicitly marks
  // the delivery complete (the gate lives in the PATCH route) — null means
  // still active. Completed deliveries default-hide from the list.
  completedAt: string | null;
  completedByName: string | null;
  items: DeliveryItemRow[];
  rollup: DeliveryRollup;
};

function emptyRollup(): DeliveryRollup {
  return { total: 0, delivered: 0, partiallyDelivered: 0, notDelivered: 0, pending: 0 };
}

function addToRollup(rollup: DeliveryRollup, status: DeliveryStatusValue) {
  rollup.total += 1;
  if (status === "delivered") rollup.delivered += 1;
  else if (status === "partially_delivered") rollup.partiallyDelivered += 1;
  else if (status === "not_delivered") rollup.notDelivered += 1;
  else rollup.pending += 1;
}

type DeliveryHeaderRow = {
  id: string;
  project_id: string;
  name: string;
  delivery_date: string;
  notify_days_before: number;
  responsible_emails: string[];
  responsible_names: string[];
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  completed_by_name: string | null;
};

type DeliveryItemJoinRow = {
  id: string;
  delivery_id: string;
  issue_id: string;
  jira_key: string;
  jira_base_url: string;
  summary: string;
  jira_status: string;
  priority: string | null;
  assignee_email: string | null;
  assignee_name: string | null;
  added_by: string;
  added_by_name: string | null;
  added_at: string;
  status: DeliveryStatusValue;
  status_comment: string | null;
  status_set_by: string | null;
  status_set_by_name: string | null;
  status_set_at: string | null;
};

function mapItemRow(r: DeliveryItemJoinRow): DeliveryItemRow {
  return {
    id: r.id,
    issueId: r.issue_id,
    jiraKey: r.jira_key,
    jiraBaseUrl: r.jira_base_url,
    summary: r.summary,
    jiraStatus: r.jira_status,
    priority: r.priority,
    assigneeEmail: r.assignee_email,
    assigneeName: r.assignee_name,
    addedBy: r.added_by,
    addedByName: r.added_by_name,
    addedAt: r.added_at,
    status: r.status,
    statusComment: r.status_comment,
    statusSetBy: r.status_set_by,
    statusSetByName: r.status_set_by_name,
    statusSetAt: r.status_set_at,
  };
}

async function fetchItemsForDeliveries(deliveryIds: string[]): Promise<Map<string, DeliveryItemRow[]>> {
  const byDelivery = new Map<string, DeliveryItemRow[]>();
  if (deliveryIds.length === 0) return byDelivery;

  const rows = (
    await db.execute(sql`
      SELECT
        di.id, di.delivery_id, di.issue_id, di.added_by, di.added_by_name, di.added_at,
        di.status, di.status_comment, di.status_set_by, di.status_set_by_name, di.status_set_at,
        ji.jira_key, ji.summary, ji.status AS jira_status, ji.priority,
        ji.assignee_email, ji.assignee_name, jp.jira_base_url AS jira_base_url
      FROM delivery_items di
      JOIN jira_issues ji ON ji.id = di.issue_id
      JOIN jira_projects jp ON jp.id = ji.project_id
      WHERE di.delivery_id IN (${sql.join(deliveryIds.map((id) => sql`${id}`), sql`, `)})
      ORDER BY ji.jira_key ASC
    `)
  ).rows as unknown as DeliveryItemJoinRow[];

  for (const r of rows) {
    const list = byDelivery.get(r.delivery_id) ?? [];
    list.push(mapItemRow(r));
    byDelivery.set(r.delivery_id, list);
  }
  return byDelivery;
}

function headerToDelivery(h: DeliveryHeaderRow, items: DeliveryItemRow[]): DeliveryWithItems {
  const rollup = emptyRollup();
  for (const item of items) addToRollup(rollup, item.status);
  return {
    id: h.id,
    projectId: h.project_id,
    name: h.name,
    deliveryDate: h.delivery_date,
    notifyDaysBefore: h.notify_days_before,
    responsibleEmails: h.responsible_emails,
    responsibleNames: h.responsible_names,
    createdBy: h.created_by,
    createdByName: h.created_by_name,
    createdAt: h.created_at,
    updatedAt: h.updated_at,
    completedAt: h.completed_at,
    completedByName: h.completed_by_name,
    items,
    rollup,
  };
}

const DELIVERY_HEADER_COLUMNS = sql`
  id, project_id, name, delivery_date, notify_days_before,
  responsible_emails, responsible_names, created_by, created_by_name, created_at, updated_at,
  completed_at, completed_by_name
`;

/** Every active delivery for a project, with its items and rollup counts, ordered by date ascending ("date-wise" scheduling view). Includes completed deliveries — the client filters those out by default with a "Show completed" toggle. */
export async function fetchProjectDeliveries(projectId: string): Promise<DeliveryWithItems[]> {
  const headers = (
    await db.execute(sql`
      SELECT ${DELIVERY_HEADER_COLUMNS}
      FROM deliveries
      WHERE project_id = ${projectId} AND deleted_at IS NULL
      ORDER BY delivery_date ASC, created_at ASC
    `)
  ).rows as unknown as DeliveryHeaderRow[];

  const itemsByDelivery = await fetchItemsForDeliveries(headers.map((h) => h.id));
  return headers.map((h) => headerToDelivery(h, itemsByDelivery.get(h.id) ?? []));
}

export type DeliveryOption = { id: string; name: string; deliveryDate: string };

/** Light {id, name, deliveryDate} list for a project — backs the "add to existing delivery" / "migrate to" pickers without pulling every item's Jira fields. Excludes completed deliveries: they're done, not a place to keep adding work. */
export async function fetchProjectDeliveryOptions(projectId: string): Promise<DeliveryOption[]> {
  const rows = (
    await db.execute(sql`
      SELECT id, name, delivery_date
      FROM deliveries
      WHERE project_id = ${projectId} AND deleted_at IS NULL AND completed_at IS NULL
      ORDER BY delivery_date ASC
    `)
  ).rows as unknown as { id: string; name: string; delivery_date: string }[];
  return rows.map((r) => ({ id: r.id, name: r.name, deliveryDate: r.delivery_date }));
}

/** One delivery, fully joined — used to return a fresh view right after create/edit/add/remove/status-set. */
export async function fetchDeliveryById(deliveryId: string): Promise<DeliveryWithItems | null> {
  const headers = (
    await db.execute(sql`
      SELECT ${DELIVERY_HEADER_COLUMNS}
      FROM deliveries
      WHERE id = ${deliveryId} AND deleted_at IS NULL
      LIMIT 1
    `)
  ).rows as unknown as DeliveryHeaderRow[];
  const header = headers[0];
  if (!header) return null;

  const itemsByDelivery = await fetchItemsForDeliveries([deliveryId]);
  return headerToDelivery(header, itemsByDelivery.get(deliveryId) ?? []);
}

// ---------------------------------------------------------------------------
// SQL-embeddable "nearest delivery" — for listing queries (My Tasks, Project
// Tracking) that want a sortable/filterable Delivery column without a
// separate schema column or a batch round-trip. Same resolution rule as
// fetchDeliverySummaries below (soonest upcoming, else most recently
// overdue), expressed once as a correlated scalar subquery so every caller
// computes "nearest delivery" identically — no denormalized column to drift
// out of sync, no extra table needed. Embed directly into a `.select({...})`,
// `WHERE`, or `ORDER BY` of any query that already has jiraIssues in scope.
// ---------------------------------------------------------------------------

function nearestDeliveryOrderBySql(): SQL {
  return sql`
    ORDER BY (d_pick.delivery_date < CURRENT_DATE) ASC,
             CASE WHEN d_pick.delivery_date >= CURRENT_DATE THEN d_pick.delivery_date END ASC,
             CASE WHEN d_pick.delivery_date < CURRENT_DATE THEN d_pick.delivery_date END DESC
  `;
}

/**
 * Forces full "table"."column" qualification for a column reference,
 * independent of whether the caller's outer query happens to JOIN another
 * table. Drizzle only auto-qualifies a column when its outer query's FROM
 * has 2+ tables in scope — a bare `jiraIssues.id` renders as unqualified
 * "id" in a single-table query (e.g. /api/search, no join), and once that
 * text is spliced into one of these correlated subqueries it resolves
 * against the SUBQUERY's own tables instead (delivery_items also has an
 * "id" column), throwing "column reference is ambiguous" — or worse,
 * silently picking the wrong column if no such collision exists. Always
 * qualifying here removes the dependency on the caller's join shape.
 */
function qualified(ref: AnyColumn | SQL): SQL {
  return is(ref, Column) ? sql.raw(`"${getTableName(ref.table)}"."${ref.name}"`) : ref;
}

/** The nearest active delivery's date for the issue referenced by `issueIdRef` (usually jiraIssues.id), or NULL if it's in no active delivery. */
export function nearestDeliveryDateSql(issueIdRef: AnyColumn | SQL): SQL {
  return sql`(
    SELECT d_pick.delivery_date
    FROM delivery_items di_pick
    JOIN deliveries d_pick ON d_pick.id = di_pick.delivery_id AND d_pick.deleted_at IS NULL
    WHERE di_pick.issue_id = ${qualified(issueIdRef)}
    ${nearestDeliveryOrderBySql()}
    LIMIT 1
  )`;
}

/** The nearest active delivery's item status for the issue referenced by `issueIdRef` — pairs with nearestDeliveryDateSql to color the column the same way the cross-surface badge does. */
export function nearestDeliveryStatusSql(issueIdRef: AnyColumn | SQL): SQL {
  return sql`(
    SELECT di_pick.status
    FROM delivery_items di_pick
    JOIN deliveries d_pick ON d_pick.id = di_pick.delivery_id AND d_pick.deleted_at IS NULL
    WHERE di_pick.issue_id = ${qualified(issueIdRef)}
    ${nearestDeliveryOrderBySql()}
    LIMIT 1
  )`;
}

export type DeliverySummary = {
  deliveryId: string;
  deliveryName: string;
  deliveryDate: string;
  projectId: string;
  status: DeliveryStatusValue;
  isOverdue: boolean;
  /** How many active deliveries this issue belongs to in total — the badge shows "+N more" when > 1. */
  totalDeliveries: number;
};

type DeliverySummaryJoinRow = {
  issue_id: string;
  delivery_id: string;
  delivery_name: string;
  delivery_date: string;
  project_id: string;
  status: DeliveryStatusValue;
};

/**
 * Per-issue "nearest delivery" lookup for a batch of issue ids — backs the
 * cross-surface delivery badge exactly the way fetchDelaySummaries backs the
 * delay icon. An issue can belong to several active deliveries at once; the
 * one surfaced here is whichever is soonest upcoming, or (if none are
 * upcoming) whichever most recently became overdue — matching "the nearest
 * date should be shown when someone views the item."
 */
export async function fetchDeliverySummaries(
  issueIds: string[]
): Promise<Record<string, DeliverySummary>> {
  if (issueIds.length === 0) return {};

  const rows = (
    await db.execute(sql`
      SELECT di.issue_id, d.id AS delivery_id, d.name AS delivery_name,
        d.delivery_date, d.project_id, di.status
      FROM delivery_items di
      JOIN deliveries d ON d.id = di.delivery_id AND d.deleted_at IS NULL
      WHERE di.issue_id IN (${sql.join(issueIds.map((id) => sql`${id}`), sql`, `)})
    `)
  ).rows as unknown as DeliverySummaryJoinRow[];

  const today = localDateStr(new Date());
  const byIssue = new Map<string, DeliverySummaryJoinRow[]>();
  for (const r of rows) {
    const list = byIssue.get(r.issue_id) ?? [];
    list.push(r);
    byIssue.set(r.issue_id, list);
  }

  const result: Record<string, DeliverySummary> = {};
  for (const [issueId, list] of byIssue) {
    const upcoming = list.filter((r) => r.delivery_date >= today).sort((a, b) => a.delivery_date.localeCompare(b.delivery_date));
    const overdue = list.filter((r) => r.delivery_date < today).sort((a, b) => b.delivery_date.localeCompare(a.delivery_date));
    const nearest = upcoming[0] ?? overdue[0];
    if (!nearest) continue;
    result[issueId] = {
      deliveryId: nearest.delivery_id,
      deliveryName: nearest.delivery_name,
      deliveryDate: nearest.delivery_date,
      projectId: nearest.project_id,
      status: nearest.status,
      isOverdue: nearest.delivery_date < today,
      totalDeliveries: list.length,
    };
  }
  return result;
}

export type IssueDeliveryMembership = {
  itemId: string;
  deliveryId: string;
  deliveryName: string;
  deliveryDate: string;
  projectId: string;
  status: DeliveryStatusValue;
  statusComment: string | null;
  statusSetByName: string | null;
  statusSetAt: string | null;
};

export type IssueDeliveriesDetail = {
  issue: {
    id: string;
    jiraKey: string;
    summary: string;
    status: string;
    priority: string | null;
    projectName: string;
    jiraBaseUrl: string;
  };
  memberships: IssueDeliveryMembership[];
};

/**
 * Every active delivery one issue belongs to, ordered by date — backs the
 * item panel opened from the badge. An issue can be in several deliveries
 * at once, so unlike fetchDeliverySummaries (which picks just the nearest
 * one for the badge), this returns the full list for the popup.
 */
export async function fetchIssueDeliveriesDetail(issueId: string): Promise<IssueDeliveriesDetail | null> {
  const [issueRes, membershipRes] = await Promise.all([
    db.execute(sql`
      SELECT ji.id, ji.jira_key, ji.summary, ji.status, ji.priority,
        jp.name AS project_name, jp.jira_base_url
      FROM jira_issues ji
      JOIN jira_projects jp ON jp.id = ji.project_id
      WHERE ji.id = ${issueId}
      LIMIT 1
    `),
    db.execute(sql`
      SELECT di.id AS item_id, d.id AS delivery_id, d.name AS delivery_name,
        d.delivery_date, d.project_id, di.status, di.status_comment,
        di.status_set_by_name, di.status_set_at
      FROM delivery_items di
      JOIN deliveries d ON d.id = di.delivery_id AND d.deleted_at IS NULL
      WHERE di.issue_id = ${issueId}
      ORDER BY d.delivery_date ASC
    `),
  ]);

  const issueRow = issueRes.rows[0] as Record<string, unknown> | undefined;
  if (!issueRow) return null;

  const memberships = (membershipRes.rows as Record<string, unknown>[]).map((r) => ({
    itemId: r.item_id as string,
    deliveryId: r.delivery_id as string,
    deliveryName: r.delivery_name as string,
    deliveryDate: r.delivery_date as string,
    projectId: r.project_id as string,
    status: r.status as DeliveryStatusValue,
    statusComment: (r.status_comment as string | null) ?? null,
    statusSetByName: (r.status_set_by_name as string | null) ?? null,
    statusSetAt: (r.status_set_at as string | null) ?? null,
  }));

  return {
    issue: {
      id: issueRow.id as string,
      jiraKey: issueRow.jira_key as string,
      summary: issueRow.summary as string,
      status: issueRow.status as string,
      priority: (issueRow.priority as string | null) ?? null,
      projectName: issueRow.project_name as string,
      jiraBaseUrl: issueRow.jira_base_url as string,
    },
    memberships,
  };
}

export type DeliveryTransferEntry = {
  id: string;
  fromDeliveryId: string | null;
  fromDeliveryName: string;
  fromDeliveryDate: string;
  toDeliveryId: string | null;
  toDeliveryName: string;
  toDeliveryDate: string;
  movedBy: string;
  movedByName: string | null;
  movedAt: string;
};

/**
 * Every time this issue was migrated between deliveries, most recent first.
 * Unlike fetchIssueDeliveriesDetail's memberships (current-state, excludes
 * soft-deleted deliveries), this keeps showing an entry even if the delivery
 * it names was later soft-deleted — the denormalized name/date on
 * delivery_transfers is exactly what keeps that history readable.
 */
export async function fetchDeliveryTransferHistory(issueId: string): Promise<DeliveryTransferEntry[]> {
  const res = await db.execute(sql`
    SELECT id, from_delivery_id, from_delivery_name, from_delivery_date,
      to_delivery_id, to_delivery_name, to_delivery_date,
      moved_by, moved_by_name, moved_at
    FROM delivery_transfers
    WHERE issue_id = ${issueId}
    ORDER BY moved_at DESC
  `);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    fromDeliveryId: (r.from_delivery_id as string | null) ?? null,
    fromDeliveryName: r.from_delivery_name as string,
    fromDeliveryDate: r.from_delivery_date as string,
    toDeliveryId: (r.to_delivery_id as string | null) ?? null,
    toDeliveryName: r.to_delivery_name as string,
    toDeliveryDate: r.to_delivery_date as string,
    movedBy: r.moved_by as string,
    movedByName: (r.moved_by_name as string | null) ?? null,
    movedAt: r.moved_at as string,
  }));
}

export type DeliveryStatusHistoryEntry = {
  id: string;
  deliveryId: string | null;
  deliveryName: string;
  fromStatus: DeliveryStatusValue | null;
  toStatus: DeliveryStatusValue;
  statusComment: string | null;
  changedBy: string;
  changedByName: string | null;
  changedAt: string;
};

/**
 * Every time this issue's delivery outcome actually changed, most recent
 * first — mirrors fetchDeliveryTransferHistory's shape/reasoning (an
 * append-only event log, readable even after the delivery it happened in is
 * later soft-deleted). Status itself mirrors to every delivery_items row
 * sharing the issue, but each transition is logged once, against whichever
 * delivery the edit was made through.
 */
export async function fetchDeliveryStatusHistory(issueId: string): Promise<DeliveryStatusHistoryEntry[]> {
  const res = await db.execute(sql`
    SELECT id, delivery_id, delivery_name, from_status, to_status,
      status_comment, changed_by, changed_by_name, changed_at
    FROM delivery_status_history
    WHERE issue_id = ${issueId}
    ORDER BY changed_at DESC
  `);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    deliveryId: (r.delivery_id as string | null) ?? null,
    deliveryName: r.delivery_name as string,
    fromStatus: (r.from_status as DeliveryStatusValue | null) ?? null,
    toStatus: r.to_status as DeliveryStatusValue,
    statusComment: (r.status_comment as string | null) ?? null,
    changedBy: r.changed_by as string,
    changedByName: (r.changed_by_name as string | null) ?? null,
    changedAt: r.changed_at as string,
  }));
}

/** One entry in the delivery-status popup's merged "Delivery history" feed. */
export type DeliveryHistoryEvent =
  | ({ type: "transfer" } & DeliveryTransferEntry)
  | ({ type: "status_change" } & DeliveryStatusHistoryEntry);

/**
 * Migrations and status changes merged into one chronological feed for the
 * delivery-status popup — "everything that happened to this item's
 * delivery," not two separate lists the user has to mentally interleave.
 */
export async function fetchDeliveryHistory(issueId: string): Promise<DeliveryHistoryEvent[]> {
  const [transfers, statusChanges] = await Promise.all([
    fetchDeliveryTransferHistory(issueId),
    fetchDeliveryStatusHistory(issueId),
  ]);
  const events: DeliveryHistoryEvent[] = [
    ...transfers.map((t) => ({ type: "transfer" as const, ...t })),
    ...statusChanges.map((s) => ({ type: "status_change" as const, ...s })),
  ];
  events.sort((a, b) => {
    const at = a.type === "transfer" ? a.movedAt : a.changedAt;
    const bt = b.type === "transfer" ? b.movedAt : b.changedAt;
    return bt.localeCompare(at);
  });
  return events;
}

export type UpcomingDelivery = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  deliveryDate: string;
  notifyDaysBefore: number;
  /** Why this delivery is showing for this user — responsible person, an item assignee, or both. */
  reason: "responsible" | "assignee" | "both";
};

/**
 * Every active delivery a user should be reminded about right now — starts
 * showing notifyDaysBefore days before the date, stops once the date has
 * passed (no separate expiry bookkeeping needed: the >= CURRENT_DATE bound
 * does that on its own). Audience is the delivery's named responsible
 * people, plus anyone individually assigned to any item inside it.
 */
export async function fetchUpcomingDeliveriesForUser(email: string): Promise<UpcomingDelivery[]> {
  const rows = (
    await db.execute(sql`
      SELECT DISTINCT
        d.id, d.name, d.project_id, jp.name AS project_name,
        d.delivery_date, d.notify_days_before,
        (${email} = ANY(d.responsible_emails)) AS is_responsible,
        EXISTS (
          SELECT 1 FROM delivery_items di
          JOIN jira_issues ji ON ji.id = di.issue_id
          WHERE di.delivery_id = d.id AND ji.assignee_email = ${email}
        ) AS is_assignee
      FROM deliveries d
      JOIN jira_projects jp ON jp.id = d.project_id
      WHERE d.deleted_at IS NULL
        AND d.delivery_date >= CURRENT_DATE
        AND d.delivery_date <= CURRENT_DATE + d.notify_days_before
        AND (
          ${email} = ANY(d.responsible_emails)
          OR EXISTS (
            SELECT 1 FROM delivery_items di
            JOIN jira_issues ji ON ji.id = di.issue_id
            WHERE di.delivery_id = d.id AND ji.assignee_email = ${email}
          )
        )
      ORDER BY d.delivery_date ASC
    `)
  ).rows as unknown as {
    id: string;
    name: string;
    project_id: string;
    project_name: string;
    delivery_date: string;
    notify_days_before: number;
    is_responsible: boolean;
    is_assignee: boolean;
  }[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    projectId: r.project_id,
    projectName: r.project_name,
    deliveryDate: r.delivery_date,
    notifyDaysBefore: r.notify_days_before,
    reason: r.is_responsible && r.is_assignee ? "both" : r.is_responsible ? "responsible" : "assignee",
  }));
}

/**
 * The delivery-status gate: an issue must be at canonical status DONE
 * before its delivery outcome (delivered/partially delivered/not delivered)
 * can be set. Reuses getStatusRawSets — the same per-project "which raw
 * statuses map to DONE" computation the sync pipeline already relies on —
 * rather than re-deriving canonical-status membership from scratch.
 */
export async function isIssueDone(issueId: string): Promise<boolean> {
  const [issue] = await db
    .select({ projectId: jiraIssues.projectId, status: jiraIssues.status })
    .from(jiraIssues)
    .where(eq(jiraIssues.id, issueId))
    .limit(1);
  if (!issue) return false;

  const { done } = await getStatusRawSets(issue.projectId);
  return done.has(issue.status);
}
