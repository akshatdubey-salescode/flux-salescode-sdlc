import Image from "next/image";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import {
  RiArrowRightLine,
  RiArrowRightUpLine,
  RiFlashlightFill,
  RiLink,
  RiLoopRightLine,
  RiTeamLine,
} from "@remixicon/react";
import { authOptions } from "@/lib/auth/nextauth-options";
import { Button } from "@/components/ui/button";
import { HeroDemo, ScorecardDemo } from "@/components/landing/demos";
import { LandingMotion } from "@/components/landing/landing-motion";
import { Upvote } from "@/components/landing/upvote";
import githubMark from "@/components/landing/kit/brands/github.svg";
import calendarMark from "@/components/landing/kit/brands/google-calendar.svg";
import { displaySerif } from "@/components/landing/fonts";
import "@/components/landing/landing.css";


// Everything named on this page (people, projects, issue keys) is invented:
// the page is public.

const WORKLOAD = [
  { name: "Aarav", load: 0.92, tone: "hot" },
  { name: "Lena", load: 0.64, tone: "ok" },
  { name: "Sam", load: 0.38, tone: "ok" },
  { name: "Mei", load: 0.71, tone: "ok" },
] as const;

const BUGS = [
  { name: "Payments", p: [3, 5, 2, 1] },
  { name: "Checkout", p: [1, 4, 6, 2] },
  { name: "Catalog", p: [0, 2, 3, 5] },
];

// Fourteen working days: busy with Jira work, on leave in Keka, or free
const DAYS = "bbbblbbffffffb".split("");

const SHOWCASES = [
  { title: "Jira Digest Bot", tagline: "A morning summary of everything that moved in your projects overnight.", who: "Lena Fischer", tags: ["slack", "jira"], votes: 48 },
  { title: "Release Notes Drafter", tagline: "Turns a sprint's closed issues into release notes you can edit and send.", who: "Aarav Shah", tags: ["ai", "docs"], votes: 36 },
  { title: "Standup Timer", tagline: "Keeps standups to fifteen minutes, with a nudge for whoever runs long.", who: "Mei Lin", tags: ["web"], votes: 21 },
];

export default async function LandingPage() {
  const session = await getServerSession(authOptions);
  if (session?.user?.email) redirect("/home");

  return (
    <div className={`landing ${displaySerif.variable}`}>
      <LandingMotion />

      <header className="lp-nav">
        <div className="lp-nav__inner">
          <Link href="/" className="lp-logo" aria-label="Flux home">
            <span className="lp-logo__mark">
              <RiFlashlightFill size={15} aria-hidden />
            </span>
            <span className="lp-logo__name">Flux</span>
          </Link>
          <nav className="lp-nav__links" aria-label="Sections">
            <a href="#features">Product</a>
            <a href="#how">How it works</a>
            <a href="#discover">Discover</a>
          </nav>
          <div className="lp-nav__actions">
            <Button asChild variant="ghost" className="lp-btn lp-btn--ghost">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild className="lp-btn lp-btn--primary lp-btn--sm">
              <Link href="/sign-in">
                Get started
                <RiArrowRightLine className="lp-btn__arrow" aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* ---------------------------------------------------------- Hero */}
        <section className="lp-hero">
          <div className="lp-hero__glow" aria-hidden />
          <div className="lp-hero__grid" aria-hidden />
          <div className="lp-container lp-hero__copy">
            <p className="lp-eyebrow lp-rise" style={{ ["--i" as string]: 0 }}>
              <span className="lp-live" aria-hidden />
              Synced with Jira, GitHub, Keka and Freshdesk
            </p>
            <h1 className="lp-hero__title">
              <span className="lp-rise" style={{ ["--i" as string]: 1 }}>See every sprint</span>{" "}
              <span className="lp-rise" style={{ ["--i" as string]: 2 }}>
                <em className="lp-serif">before</em> it slips.
              </span>
            </h1>
            <p className="lp-hero__lede lp-rise" style={{ ["--i" as string]: 3 }}>
              Flux is Salescode&rsquo;s delivery workspace. It turns the tools your teams already use into one live picture of
              sprints, bugs, deliveries and people, so you can spot what&rsquo;s at risk, say why, and tell everyone in a click.
            </p>
            <div className="lp-hero__ctas lp-rise" style={{ ["--i" as string]: 4 }}>
              <Button asChild className="lp-btn lp-btn--primary lp-btn--lg">
                <Link href="/sign-in">
                  Get started
                  <RiArrowRightLine className="lp-btn__arrow" aria-hidden />
                </Link>
              </Button>
              <Button asChild variant="ghost" className="lp-btn lp-btn--quiet lp-btn--lg">
                <a href="#features">
                  See what&rsquo;s inside
                  <RiArrowRightLine className="lp-btn__arrow" aria-hidden />
                </a>
              </Button>
            </div>
            <p className="lp-hero__note lp-rise" style={{ ["--i" as string]: 5 }}>
              Sign in with your @salescode.ai Google account.
            </p>
          </div>

          <div className="lp-container lp-hero__shot">
            <div id="hero-demo" className="lp-shot" role="img" aria-label="Flux Sprint Tracking: a delay reason is logged on an overdue issue, then the sprint update is copied">
              <HeroDemo />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------- Sources */}
        <section className="lp-sources" aria-label="Integrations">
          <div className="lp-container lp-sources__inner" data-reveal>
            <p className="lp-sources__label">Built on the data you already have</p>
            <ul className="lp-sources__list">
              <li>
                <Image src="/jira-icon.png" alt="" width={20} height={20} />
                Jira
              </li>
              <li>
                <Image src={githubMark} alt="" width={20} height={20} />
                GitHub
              </li>
              <li>
                <span className="lp-wordmark">Keka</span>
              </li>
              <li>
                <span className="lp-wordmark">Freshdesk</span>
              </li>
              <li>
                <Image src={calendarMark} alt="" width={20} height={20} />
                Google Calendar
              </li>
            </ul>
          </div>
        </section>

        {/* --------------------------------------------------- Features */}
        <section id="features" className="lp-section">
          <div className="lp-container">
            <div className="lp-heading" data-reveal>
              <p className="lp-kicker">The product</p>
              <h2 className="lp-h2">
                One place for every question <em className="lp-serif">about delivery.</em>
              </h2>
              <p className="lp-sub">
                Who is overloaded, what is overdue, which bugs matter, how a quarter went. Flux answers from the work itself,
                not from status meetings.
              </p>
            </div>

            <div className="lp-bento">
              {/* Hero tile: the scorecard */}
              <article className="lp-tile lp-tile--wide lp-tile--score" data-reveal style={{ ["--i" as string]: 0 }}>
                <div className="lp-tile__copy">
                  <h3>
                    <strong>Performance Review.</strong> Quarterly scorecards built from shipped work, with every metric
                    weighted and explained.
                  </h3>
                </div>
                <div className="lp-tile__art lp-tile__art--stage" id="scorecard-demo" role="img" aria-label="A Performance Review scorecard: a score of 86 from five weighted metrics">
                  <ScorecardDemo />
                </div>
              </article>

              {/* Statement: search */}
              <article className="lp-tile lp-tile--search" data-reveal style={{ ["--i" as string]: 1 }}>
                <div className="lp-tile__art lp-keys" aria-hidden>
                  <kbd>⌘</kbd>
                  <kbd>K</kbd>
                </div>
                <div className="lp-tile__copy">
                  <h3>
                    <strong>Find anything.</strong> Pages, projects, teams and Jira issues from one box.
                  </h3>
                </div>
              </article>

              {/* Component: workload */}
              <article className="lp-tile" data-reveal style={{ ["--i" as string]: 2 }}>
                <div className="lp-tile__art lp-load" aria-hidden>
                  {WORKLOAD.map((w, i) => (
                    <div className="lp-load__row" key={w.name}>
                      <span className="lp-load__name">{w.name}</span>
                      <span className="lp-load__track">
                        <span
                          className="lp-load__fill"
                          data-tone={w.tone}
                          style={{ ["--w" as string]: w.load, ["--d" as string]: `${i * 90}ms` }}
                        />
                      </span>
                    </div>
                  ))}
                </div>
                <div className="lp-tile__copy">
                  <h3>
                    <strong>Team Pulse.</strong> See who is stretched and who has room, team by team.
                  </h3>
                </div>
              </article>

              {/* Component: bug board */}
              <article className="lp-tile" data-reveal style={{ ["--i" as string]: 3 }}>
                <div className="lp-tile__art lp-bugs" aria-hidden>
                  <div className="lp-bugs__row lp-bugs__row--head">
                    <span />
                    <span>P1</span>
                    <span>P2</span>
                    <span>P3</span>
                    <span>P4</span>
                  </div>
                  {BUGS.map((b, r) => (
                    <div className="lp-bugs__row" key={b.name}>
                      <span className="lp-bugs__name">{b.name}</span>
                      {b.p.map((n, c) => (
                        <span
                          key={c}
                          className="lp-bugs__cell"
                          style={{ ["--a" as string]: Math.min(1, n / 6), ["--d" as string]: `${(r * 4 + c) * 40}ms` }}
                          data-hot={c === 0 && n > 0 ? "" : undefined}
                        >
                          {n}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="lp-tile__copy">
                  <h3>
                    <strong>Bug Board.</strong> Open bugs by priority, project and owner, with missing RCAs flagged.
                  </h3>
                </div>
              </article>

              {/* Diagram: availability */}
              <article className="lp-tile" data-reveal style={{ ["--i" as string]: 4 }}>
                <div className="lp-tile__art lp-avail" aria-hidden>
                  <div className="lp-avail__days">
                    {DAYS.map((d, i) => (
                      <span key={i} className="lp-avail__day" data-kind={d} style={{ ["--d" as string]: `${i * 45}ms` }} />
                    ))}
                  </div>
                  <span className="lp-avail__pill">
                    <span className="lp-avail__dot" />6 days free from Mon
                  </span>
                </div>
                <div className="lp-tile__copy">
                  <h3>
                    <strong>Availability.</strong> Find a free run of days across Jira work and Keka leave.
                  </h3>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------ How it works */}
        <section id="how" className="lp-section lp-how">
          <div className="lp-container">
            <div className="lp-heading" data-reveal>
              <p className="lp-kicker">How it works</p>
              <h2 className="lp-h2">
                Connect once. <em className="lp-serif">Stay in sync.</em>
              </h2>
            </div>
            <ol className="lp-steps" data-reveal>
              <li className="lp-step" style={{ ["--i" as string]: 0 }}>
                <span className="lp-step__icon">
                  <RiLink size={18} aria-hidden />
                </span>
                <h3>Add a project</h3>
                <p>Point Flux at a Jira base URL and project key. History syncs in, and webhooks keep it live.</p>
              </li>
              <li className="lp-step" style={{ ["--i" as string]: 1 }}>
                <span className="lp-step__icon">
                  <RiLoopRightLine size={18} aria-hidden />
                </span>
                <h3>Flux joins the dots</h3>
                <p>Commits from GitHub, leave from Keka, meetings from Google Calendar and client tickets from Freshdesk join the people and projects they belong to.</p>
              </li>
              <li className="lp-step" style={{ ["--i" as string]: 2 }}>
                <span className="lp-step__icon">
                  <RiTeamLine size={18} aria-hidden />
                </span>
                <h3>Everyone sees the same thing</h3>
                <p>Dashboards for leads, My Tasks for everyone, and sprint reports emailed on the schedule you set.</p>
              </li>
            </ol>
          </div>
        </section>

        {/* ---------------------------------------------------- Discover */}
        <section id="discover" className="lp-section lp-discover">
          <div className="lp-container lp-discover__inner">
            <div className="lp-heading lp-heading--left" data-reveal>
              <p className="lp-kicker">Discover</p>
              <h2 className="lp-h2">
                Built by us, <em className="lp-serif">for us.</em>
              </h2>
              <p className="lp-sub">
                Discover is where colleagues share the internal tools they build. Find something useful, upvote it, or show what
                you&rsquo;ve made.
              </p>
            </div>
            <div className="lp-cards">
              {SHOWCASES.map((sc, i) => (
                <article className="lp-card" key={sc.title} data-reveal style={{ ["--i" as string]: i }}>
                  <h3 className="lp-card__title">{sc.title}</h3>
                  <p className="lp-card__tagline">{sc.tagline}</p>
                  <div className="lp-card__tags">
                    {sc.tags.map((t) => (
                      <span className="lp-card__tag" key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="lp-card__foot">
                    <p className="lp-card__who">
                      {sc.who}
                    </p>
                    <Upvote count={sc.votes} />
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- CTA */}
        <section className="lp-cta-wrap">
          <div className="lp-container">
            <div className="lp-cta" data-reveal>
              <div className="lp-cta__glow" aria-hidden />
              <h2 className="lp-cta__title">
                Your sprint, <em className="lp-serif">in focus.</em>
              </h2>
              <p className="lp-cta__sub">Open Flux with your Salescode Google account. Nothing to install.</p>
              <Button asChild className="lp-btn lp-btn--light lp-btn--lg">
                <Link href="/sign-in">
                  Open Flux
                  <RiArrowRightUpLine className="lp-btn__arrow lp-btn__arrow--up" aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer__inner">
          <span className="lp-logo lp-logo--small">
            <span className="lp-logo__mark">
              <RiFlashlightFill size={12} aria-hidden />
            </span>
            <span className="lp-logo__name">Flux</span>
          </span>
          <span className="lp-footer__copy">An internal tool by Salescode.ai</span>
          <nav className="lp-footer__links" aria-label="Legal">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
