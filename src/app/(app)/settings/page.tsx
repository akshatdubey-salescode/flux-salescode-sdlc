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
          Integrations
        </h2>
        <AtlassianIntegrationCard />
        <GoogleCalendarCard />
      </section>
    </div>
  );
}
