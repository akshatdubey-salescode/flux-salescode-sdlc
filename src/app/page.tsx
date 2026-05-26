import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth/nextauth-options";

export default async function LandingPage() {
  const session = await getServerSession(authOptions);
  if (session?.user?.email) redirect("/home");

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-8">
        <div className="flex flex-col items-center gap-4">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <span className="text-3xl font-bold">F</span>
          </div>
          <h1 className="text-5xl font-bold tracking-tight text-foreground">
            Flux
          </h1>
        </div>

        <div className="space-y-2">
          <p className="text-muted-foreground text-lg font-medium">
            SDLC Insights for Salescode.ai
          </p>
          <p className="text-muted-foreground/60 text-sm">
            Intelligent software development lifecycle tracking and analytics.
          </p>
        </div>

        <Link
          href="/sign-in"
          className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-8 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] active:scale-[0.98] hover:bg-primary/90"
        >
          Get Started
        </Link>
      </div>
    </main>
  );
}
