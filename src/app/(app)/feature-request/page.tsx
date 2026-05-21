import { requireAuth } from "@/lib/auth/server";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { FeatureRequestForm } from "./form";

export default async function FeatureRequestPage() {
  await requireAuth();

  return (
    <div className="flex flex-col min-h-svh">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <SidebarTrigger />
      </header>

      <main className="flex-1 p-6">
        <div className="mx-auto max-w-lg space-y-6">
          <div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Request a feature
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Have an idea that would make this product better? Tell us about
              it. We review every request and use them to plan what to build
              next.
            </p>
          </div>

          <FeatureRequestForm />
        </div>
      </main>
    </div>
  );
}
