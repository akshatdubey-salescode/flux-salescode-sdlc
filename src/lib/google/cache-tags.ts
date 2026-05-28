/**
 * Cache tag for any data derived from a user's calendar events.
 * Used by /api/observer/boards/[boardId]/meetings (alongside board:*) and
 * /api/my-tasks/meetings. Invalidated by the cron after a successful sync,
 * by OAuth connect/disconnect, and by the refresh-revoked path inside
 * getValidAccessToken.
 *
 * Lives in its own file so oauth.ts can use it without pulling in
 * calendar-sync.ts (which would create a circular import).
 */
export function userMeetingsTag(userId: string): string {
  return `meetings:user:${userId.toLowerCase()}`;
}
