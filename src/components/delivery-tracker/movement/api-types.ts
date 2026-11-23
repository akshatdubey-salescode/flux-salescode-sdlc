/**
 * Response shapes of /api/deliveries/[id]/movements/**, derived from the service functions so a
 * contract change on the server is a compile error here. `import type` only: nothing from the
 * server modules (db, crypto) reaches the client bundle.
 */
import type {
  confirmStatuses,
  getChangesSinceSigned,
  getItemDetail,
  getMovementView,
  listAffectedRepos,
  listEvents,
  proposeStatuses,
  MovementListItem,
} from "@/lib/movement/service/service";
import type { RefreshResult } from "@/lib/movement/service/refresh";
import type { Checklist, ChecklistItem, ChecklistSection, Conflict } from "@/lib/movement/checklist/types";

export type { Checklist, ChecklistItem, ChecklistSection, MovementListItem, RefreshResult };
export type { JiraService, JiraServices } from "@/lib/movement/checklist/services";
export type { CommentView, SummaryView, SummaryStatus } from "@/lib/movement/service/types";
export type { Badge, Glance, Rollup, RollupEntry, RollupSection, RollupHeadline } from "@/lib/movement/checklist/rollup";
export type { MergedSummary } from "@/lib/movement/checklist/summary-ai";
export type ChecklistConflict = Conflict;
export type { ItemNote, RecordRef } from "@/lib/movement/service/types";
export type { MovementEnvironment, MovementSlot, MovementStatus, MovementResult, MovementReadiness } from "@/lib/movement/values";

export type MovementView = Awaited<ReturnType<typeof getMovementView>>;
export type MovementPermissions = MovementView["permissions"];
/** The viewer as the server sees them (slots held, manager / admin): the only source for "Your turn" and "You". */
export type MovementMe = MovementView["me"];
/** One Jira of the view: stored tick (`ticked`) vs effective (`included`), blockers, soft warnings, sign-offs. */
export type ItemView = MovementView["items"][number];
/** Detail of one Jira, read lazily (GET items/[issueId]). */
export type ItemDetail = Awaited<ReturnType<typeof getItemDetail>>;
export type ItemPrDetail = ItemDetail["prs"][number];
/** One page of the history (GET events), newest first; `nextBefore` is an opaque cursor. */
export type EventsPage = Awaited<ReturnType<typeof listEvents>>;
export type MovementEventRow = EventsPage["events"][number];
export type MovementSigner = MovementView["signers"][number];
export type ChangesResponse = Awaited<ReturnType<typeof getChangesSinceSigned>>;
export type RepoList = Awaited<ReturnType<typeof listAffectedRepos>>;
export type StatusProposals = Awaited<ReturnType<typeof proposeStatuses>>;
export type ConfirmOutcome = Pick<Awaited<ReturnType<typeof confirmStatuses>>, "results" | "counts">;

export interface BranchSearchResponse {
  repo: string;
  branches: string[];
  /** false: the repo is not tracked, so it cannot be searched (type the name instead). */
  searched: boolean;
  truncated?: boolean;
}

/** GET items/<issueId>/comment. */
export interface CommentsResponse {
  comments: import("@/lib/movement/service/types").CommentView[];
  jiraAvailable: boolean;
  more: number;
}

/** POST items/<issueId>/comment/preview: what the checklist would get from a text, saved nowhere. */
export interface CommentPreview {
  status: string | null;
  covers: number;
  rows: Record<string, number>;
  unknowns: number;
  warnings: string[];
}
