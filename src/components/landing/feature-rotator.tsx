"use client";

// The sign-in brand panel: Flux's features in rotation. It starts on a
// random feature and moves to a random different one each time. Timing lives
// in CSS: the active tab's progress bar is an animation, and its end advances
// the slide, so hovering the panel pauses it (animation-play-state) and
// reduced motion stops it (no animation, no end). The tabs also jump directly.
//
// Each slide's demo mounts only while it is showing (and while it fades
// out), so coming back to a feature replays it from the start.

import { useEffect, useState, type ReactNode } from "react";
import { DeliveryDemo } from "./delivery-demo";
import { BugBoardDemo, ReviewDemo, TeamPulseDemo } from "./panel-demos";

type Feature = { id: string; tab: string; kicker: string; title: ReactNode; demo: () => ReactNode };

const FEATURES: Feature[] = [
  {
    id: "delivery",
    tab: "Deliveries",
    kicker: "Delivery Tracking",
    title: (
      <>
        Know what shipped, <em className="lp-serif">the moment it ships.</em>
      </>
    ),
    demo: () => <DeliveryDemo mode="once" />,
  },
  {
    id: "bugs",
    tab: "Bugs",
    kicker: "Bug Board",
    title: (
      <>
        Every open bug, <em className="lp-serif">owned by someone.</em>
      </>
    ),
    demo: () => <BugBoardDemo />,
  },
  {
    id: "team",
    tab: "Teams",
    kicker: "Team Pulse",
    title: (
      <>
        Spot overload <em className="lp-serif">before it&rsquo;s overdue.</em>
      </>
    ),
    demo: () => <TeamPulseDemo />,
  },
  {
    id: "review",
    tab: "Reviews",
    kicker: "Performance Review",
    title: (
      <>
        Reviews built on <em className="lp-serif">the work itself.</em>
      </>
    ),
    demo: () => <ReviewDemo />,
  },
];

const SLIDE_MS = 7000;
const FADE_MS = 700;

function randomOther(current: number) {
  const pick = Math.floor(Math.random() * (FEATURES.length - 1));
  return pick >= current ? pick + 1 : pick;
}

export function FeatureRotator() {
  // Client-only (see demos.tsx), so a random start can't mismatch the server
  const [active, setActive] = useState(() => Math.floor(Math.random() * FEATURES.length));
  const [leaving, setLeaving] = useState<number | null>(null);

  // The outgoing demo stays mounted until its fade has finished
  useEffect(() => {
    if (leaving === null) return;
    const id = setTimeout(() => setLeaving(null), FADE_MS);
    return () => clearTimeout(id);
  }, [leaving]);

  const go = (next: number) => {
    if (next === active) return;
    setLeaving(active);
    setActive(next);
  };

  return (
    <div className="si-rot">
      <div className="si-rot__copy">
        {FEATURES.map((f, i) => (
          <div className="si-rot__slide" data-active={i === active || undefined} aria-hidden={i !== active} key={f.id}>
            <p className="si-panel__kicker">{f.kicker}</p>
            <p className="si-panel__title">{f.title}</p>
          </div>
        ))}
      </div>

      <div className="si-rot__demos" role="img" aria-label={`${FEATURES[active].kicker} in Flux`}>
        {FEATURES.map((f, i) =>
          i === active || i === leaving ? (
            <div className="si-rot__demo" data-active={i === active || undefined} key={f.id}>
              {f.demo()}
            </div>
          ) : null,
        )}
      </div>

      <div className="si-rot__tabs" role="tablist" aria-label="Flux features">
        {FEATURES.map((f, i) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={i === active}
            className="si-rot__tab"
            data-active={i === active || undefined}
            onClick={() => go(i)}
          >
            {f.tab}
            <span className="si-rot__bar" aria-hidden>
              {i === active && (
                <span
                  className="si-rot__fill"
                  style={{ animationDuration: `${SLIDE_MS}ms` }}
                  onAnimationEnd={() => go(randomOther(active))}
                />
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
