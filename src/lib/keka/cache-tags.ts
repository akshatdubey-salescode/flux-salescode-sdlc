// Cache tag for the synced Keka employee directory. Any "use cache" reader of
// keka_employees should tag itself with this; the sync (cron / superuser button)
// revalidates it so directory-derived surfaces refresh after a pull. Mirrors
// GITHUB_STATS_TAG.
export const KEKA_DIRECTORY_TAG = "keka-directory";

// Cache tag for synced Keka attendance. Readers of keka_attendance tag with
// this; the attendance sync revalidates it.
export const KEKA_ATTENDANCE_TAG = "keka-attendance";

// Cache tag for synced Keka leave. This is the authoritative "on leave" source
// (approved leave requests w/ type) — absence overlays, availability and SLA
// pausing read it; the leave sync revalidates it.
export const KEKA_LEAVE_TAG = "keka-leave";
