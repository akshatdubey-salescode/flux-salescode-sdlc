// ---------------------------------------------------------------------------
// "Is there anything left to report?" — the one definition of finished.
//
// A standing email schedule needs this in two places that must agree: the
// route that refuses to create a schedule which would send once and retire,
// and the handler that decides tonight's send is the final wrap-up. Sprints
// answered it inline in both; workstreams need the same answer across a set,
// so both rules live here instead of being written twice more.
//
// Inputs are structural (the risk.ts idiom) so this module pulls in no
// server-only code and stays safe to import from a client component.
// ---------------------------------------------------------------------------

export type SprintLifecycle = {
  /**
   * Set when the sprint was closed; null while it's planned or active. Either
   * shape of the same column — the ISO string a fetched sprint carries, or the
   * Date a raw drizzle select returns — since only "set or not" is read.
   */
  completedAt: string | Date | null;
  /** YYYY-MM-DD, compared as a calendar day against the IST run date. */
  endDate: string;
};

/**
 * Closed by hand, or simply past its end date. The second half matters: an
 * un-closed sprint whose dates have gone by produces an unchanging report, so
 * for scheduling purposes it is every bit as finished as a closed one.
 */
export function sprintHasFinished(sprint: SprintLifecycle, today: string): boolean {
  return sprint.completedAt !== null || sprint.endDate < today;
}

/**
 * A workstream has no completed_at of its own — it's finished when every
 * sprint in it is.
 *
 * An empty workstream is NOT finished: it has nothing to report yet, which is
 * a reason to skip a send, not to retire the schedule (sprints get moved into
 * a workstream after the fact all the time).
 */
export function workstreamHasFinished(sprints: SprintLifecycle[], today: string): boolean {
  return sprints.length > 0 && sprints.every((sprint) => sprintHasFinished(sprint, today));
}
