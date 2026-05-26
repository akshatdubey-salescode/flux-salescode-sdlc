import { Webhook } from "svix";
import { headers } from "next/headers";
import type { WebhookEvent } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { syncClerkUser } from "@/lib/auth/server";

const ALLOWED_DOMAIN = "@salescode.ai";
const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

export async function POST(req: Request) {
  if (!WEBHOOK_SECRET) {
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const headerPayload = await headers();
  const svixId = headerPayload.get("svix-id");
  const svixTimestamp = headerPayload.get("svix-timestamp");
  const svixSignature = headerPayload.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("Missing svix headers", { status: 400 });
  }

  const payload = await req.json();
  const body = JSON.stringify(payload);

  const wh = new Webhook(WEBHOOK_SECRET);
  let event: WebhookEvent;

  try {
    event = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as WebhookEvent;
  } catch {
    return new Response("Invalid webhook signature", { status: 400 });
  }

  if (event.type === "user.created") {
    const { id, email_addresses } = event.data;
    const primaryEmail = email_addresses?.[0]?.email_address ?? "";

    if (!primaryEmail.endsWith(ALLOWED_DOMAIN)) {
      // Delete the Clerk user — domain not allowed
      const client = await clerkClient();
      await client.users.deleteUser(id);
      return new Response("Domain not allowed", { status: 403 });
    }

    await syncClerkUser({ clerkId: id, email: primaryEmail });
  }

  return new Response("OK", { status: 200 });
}
