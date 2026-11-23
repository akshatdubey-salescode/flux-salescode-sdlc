/** Small helpers shared by the movement routes: the actor, the JSON body, the error response. */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { requireAuth } from "@/lib/auth/server";
import { authOptions } from "@/lib/auth/nextauth-options";
import { canManageDeliveries, hasMinRole } from "@/lib/auth/types";
import { isValidUuid } from "@/lib/validation";
import { MovementError, type MovementActor } from "./types";

/** Body size limit: the biggest body is a `done` with 200 per-item results. */
export const MAX_BODY_BYTES = 64 * 1024;

/** Authenticated user as a movement actor. requireAuth redirects when there is no session (so call it outside `run`). */
export async function authActor(): Promise<MovementActor> {
  const user = await requireAuth();
  const session = await getServerSession(authOptions);
  return {
    id: user.id,
    email: user.email,
    name: session?.user?.name?.trim() || null,
    isManager: canManageDeliveries(user),
    isAdmin: hasMinRole(user.role, "ADMIN"),
  };
}

export async function readJson(req: Request, required = true): Promise<Record<string, unknown>> {
  // Refuse by the declared size BEFORE reading the body, and again by the real size in BYTES after.
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new MovementError(413, "Request body is too large", "too_large");
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new MovementError(413, "Request body is too large", "too_large");
  if (!text.trim()) {
    if (required) throw new MovementError(400, "A JSON body is required", "bad_request");
    return {};
  }
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new MovementError(400, "Invalid JSON body", "bad_request");
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new MovementError(400, "The body must be a JSON object", "bad_request");
  return v as Record<string, unknown>;
}

/** 400 for a malformed id, otherwise null. */
export function badIds(ids: Record<string, string>): NextResponse | null {
  for (const [name, v] of Object.entries(ids)) {
    if (!isValidUuid(v)) return NextResponse.json({ error: `${name} must be a valid UUID` }, { status: 400 });
  }
  return null;
}

/** Run a handler; a MovementError becomes its JSON response, anything else (incl. a redirect) propagates. */
export async function run(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof MovementError) {
      return NextResponse.json({ error: e.message, code: e.code, ...(e.extra ?? {}) }, { status: e.status });
    }
    throw e;
  }
}
