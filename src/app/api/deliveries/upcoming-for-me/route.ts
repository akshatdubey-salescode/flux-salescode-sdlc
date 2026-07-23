import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/server";
import { fetchUpcomingDeliveriesForUser, type UpcomingDelivery } from "@/lib/deliveries/entries";

export type UpcomingForMeResponse = { deliveries: UpcomingDelivery[] };

/** Feeds the bottom reminder banner — every active delivery the current user is responsible for or assigned within, inside its notify window. */
export async function GET() {
  const user = await requireAuth();
  const deliveries = await fetchUpcomingDeliveriesForUser(user.email);
  return NextResponse.json({ deliveries } satisfies UpcomingForMeResponse);
}
