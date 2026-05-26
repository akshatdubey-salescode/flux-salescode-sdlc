"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export default function UnauthorizedPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-white dark:bg-zinc-950 px-4">
      <div className="max-w-sm w-full text-center space-y-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Access denied
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Flux is restricted to @salescode.ai accounts. Sign in with your
          company Google account.
        </p>
        <Button
          variant="outline"
          onClick={() => signOut({ callbackUrl: "/sign-in" })}
        >
          Sign out
        </Button>
      </div>
    </main>
  );
}
