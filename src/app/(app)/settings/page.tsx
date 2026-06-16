import Link from "next/link";
import { RiLayoutLeftLine, RiArrowRightSLine } from "@remixicon/react";
import { requireAuth } from "@/lib/auth/server";
import { AtlassianIntegrationCard } from "./atlassian-integration-card";
import { GoogleCalendarCard } from "./google-calendar-card";

export default async function SettingsPage() {
  await requireAuth();

  return (
    <div className="max-w-2xl mx-auto space-y-8 py-8 px-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your account integrations and preferences.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-400">
          Preferences
        </h2>
        <Link
          href="/settings/customise-sidebar"
          className="group flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent"
        >
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <RiLayoutLeftLine className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              Customise Sidebar
            </p>
            <p className="text-xs text-muted-foreground">
              Choose which menu items appear in your sidebar.
            </p>
          </div>
          <RiArrowRightSLine className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-400">
          Integrations
        </h2>
        <AtlassianIntegrationCard />
        <GoogleCalendarCard />
      </section>
    </div>
  );
}
