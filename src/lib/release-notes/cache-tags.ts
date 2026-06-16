// Cache tag for the published "What's New" release notes feed. Revalidated
// (with the "max" profile) whenever a superuser creates, edits, publishes, or
// deletes a note so the bell reflects changes without waiting for the TTL.

export const RELEASE_NOTES_TAG = "release-notes";
