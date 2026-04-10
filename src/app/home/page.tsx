import { requireAuth } from "@/lib/auth/server";
import { SignOutButton } from "@clerk/nextjs";

export default async function HomePage() {
  const user = await requireAuth();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-white dark:bg-zinc-950 px-4">
      <div className="max-w-md w-full space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Welcome to Flux
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Your SDLC tracker
          </p>
        </div>

        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-500">Email</span>
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {user.email}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-500">Role</span>
            <span className="inline-flex items-center rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-800 dark:text-zinc-200">
              {user.role}
            </span>
          </div>
        </div>

        <SignOutButton redirectUrl="/" />

      </div>
    </main>
  );
}
