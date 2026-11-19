// Size limits of the AI review's guidelines library. Kept apart from knowledge.ts (database code) so screens can show them.

/** The most guideline text one review carries (all pages together). */
export const MAX_KNOWLEDGE_TOTAL_CHARS = 200_000;
/** The most pages the library holds. */
export const MAX_LIBRARY_PAGES = 50;
