import { Suspense } from "react";
import Link from "next/link";
import { RiArrowLeftLine, RiFlashlightFill } from "@remixicon/react";
import { SignInForm } from "@/components/landing/sign-in-form";
import { FeatureRotator } from "@/components/landing/demos";
import { LandingMotion } from "@/components/landing/landing-motion";
import { displaySerif } from "@/components/landing/fonts";
import "@/components/landing/landing.css";
import "@/components/landing/sign-in.css";

// The sign-in page in the landing page's language: the form on the left, a
// brand panel on the right (wide screens only) rotating through Flux's
// features, each with a small live demo. Light only, like the landing page.

export default function SignInPage() {
  return (
    <div className={`landing si ${displaySerif.variable}`}>
      <LandingMotion />
      <div className="si-glow" aria-hidden />

      <section className="si-left">
        <header className="si-top">
          <Link href="/" className="lp-logo" aria-label="Flux home">
            <span className="lp-logo__mark">
              <RiFlashlightFill size={15} aria-hidden />
            </span>
            <span className="lp-logo__name">Flux</span>
          </Link>
        </header>

        <main className="si-main">
          <h1 className="si-title lp-rise" style={{ ["--i" as string]: 0 }}>
            Welcome <em className="lp-serif">back.</em>
          </h1>
          <p className="si-lede lp-rise" style={{ ["--i" as string]: 1 }}>
            Sign in to see your sprints, bugs and deliveries, all in one place.
          </p>
          <div className="lp-rise" style={{ ["--i" as string]: 2 }}>
            <Suspense fallback={<div className="si-form-slot" aria-hidden />}>
              <SignInForm />
            </Suspense>
          </div>
        </main>

        <footer className="si-foot">
          <Link href="/" className="si-back">
            <RiArrowLeftLine aria-hidden />
            Back to home
          </Link>
          <nav className="si-legal" aria-label="Legal">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </nav>
        </footer>
      </section>

      <aside className="si-panel" aria-label="What Flux does">
        <div className="si-panel__glow" aria-hidden />
        <FeatureRotator />
      </aside>
    </div>
  );
}
