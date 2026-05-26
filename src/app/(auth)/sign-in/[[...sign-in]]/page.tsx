"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2 } from "lucide-react";

function SignInForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/home";
  const error = searchParams.get("error");
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleSignIn = () => {
    setIsLoading(true);
    signIn("google", { callbackUrl });
  };

  return (
    <main className="relative min-h-screen w-full flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4 py-12 overflow-hidden select-none">
      {/* Background radial glowing blobs */}
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-gradient-to-br from-primary/15 to-secondary/10 blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-gradient-to-br from-secondary/15 to-primary/10 blur-[130px] pointer-events-none" />

      {/* Grid Pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none" />

      {/* Main card */}
      <div className="w-full max-w-[440px] z-10 transition-all duration-300">
        <div className="bg-white/70 dark:bg-zinc-900/40 backdrop-blur-xl border border-zinc-200/50 dark:border-zinc-800/40 shadow-2xl shadow-zinc-200/30 dark:shadow-black/70 rounded-3xl p-8 sm:p-10 space-y-8">

          {/* Logo */}
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="relative flex items-center justify-center">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-primary to-secondary opacity-25 blur-md animate-pulse duration-[3000ms]" />
              <div className="relative flex aspect-square size-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-primary to-secondary text-white shadow-lg shadow-primary/25 ring-1 ring-white/20 transition-transform duration-500 hover:rotate-6">
                <span className="text-2xl font-bold tracking-tighter">F</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
                Welcome to Flux
              </h1>
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                SDLC Insights for Salescode.ai
              </p>
            </div>
          </div>

          {/* Error alert */}
          {error && (
            <div className="flex gap-3 rounded-xl border border-red-200/60 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/20 p-4 text-sm text-red-600 dark:text-red-400 animate-in fade-in slide-in-from-top-2 duration-300">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-red-500" />
              <div className="space-y-1">
                <h5 className="font-semibold leading-none">Authentication Failed</h5>
                <p className="text-xs text-red-600/90 dark:text-red-400/90 leading-relaxed">
                  Make sure you are using your official @salescode.ai Google account to log in.
                </p>
              </div>
            </div>
          )}

          {/* Sign-in button */}
          <div className="space-y-4">
            <Button
              className="relative w-full h-12 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-50 dark:hover:bg-zinc-100 text-white dark:text-zinc-950 shadow-md hover:shadow-lg dark:shadow-none dark:hover:shadow-none transition-all duration-300 hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center font-semibold text-sm group cursor-pointer disabled:cursor-not-allowed"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin text-current" />
              ) : (
                <svg className="mr-2 h-4 w-4 shrink-0 transition-transform group-hover:scale-110 duration-300" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
                </svg>
              )}
              {isLoading ? "Signing in…" : "Continue with Google"}
            </Button>

            <p className="text-center text-xs text-zinc-400 dark:text-zinc-500 leading-relaxed">
              Access is restricted to{" "}
              <span className="font-semibold text-zinc-500 dark:text-zinc-400">@salescode.ai</span>{" "}
              accounts only.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
