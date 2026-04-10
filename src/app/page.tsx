import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function LandingPage() {
  const { userId } = await auth();
  if (userId) redirect("/home");

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-white dark:bg-zinc-950 px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Flux
        </h1>
        <p className="text-zinc-500 dark:text-zinc-400 text-base">
          Software development lifecycle tracker for salescode.ai
        </p>
        <Link
          href="/sign-in"
          className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-900 px-6 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
