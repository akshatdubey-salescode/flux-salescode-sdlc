# ADR-0005: Showcase search uses Postgres full-text search

- Status: Accepted (2026-11-20)
- Context: /discover (Tool Showcases)

## Decision

A generated `tsvector` column on showcases combines title (weight A),
tagline (B) and body (C), with a GIN index. Queries use `websearch_to_tsquery`
ranked by `ts_rank`, combined with tag filters and the Newest / Popular sort.
Showcases are **not** added to the app-wide Search or command palette in v1.

## Consequences

No new infrastructure, and it scales comfortably to thousands of Showcases.
Global search integration can be added later without schema changes.
