# ADR-0002: Open publishing with admin take-down

- Status: Accepted (2026-11-20)
- Context: /discover (Tool Showcases)

## Context

The point of /discover is getting every developer to share what they built.
Friction at publish time works against that.

## Decision

Any signed-in user (only @salescode.ai accounts exist) can publish a Showcase
straight away. ADMIN and SUPERUSER can **take down** (unpublish or delete) any
Showcase. There is no approval queue.

Take-down = unpublish with a required reason. The Showcase goes back to Draft,
flagged with the reason, and the Author gets an email (Resend). The Author can
edit and republish. Hard delete is a separate admin action.

## Consequences

- No reviewer role or queue to staff.
- Moderation is reactive. Inappropriate or confidential content stays visible
  until an admin notices it.
- Authors keep their work and learn why it was removed.
- Uses the existing custom RBAC (`requireRole`) from `src/lib/auth/server.ts`.
