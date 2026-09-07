/**
 * Shared bits of the sprint note log. Kept free of any server import so the
 * note dialog (a client component) can enforce the same limit the API does.
 */

/**
 * Generous but bounded: notes are a running log, not a spec — anything longer
 * belongs in a Confluence page linked from the note.
 */
export const MAX_SPRINT_NOTE_LENGTH = 4000;
