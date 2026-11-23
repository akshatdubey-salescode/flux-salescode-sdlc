"use client";

// The stages measure their container to pick the wide or the compact design,
// which the server can't know: rendered there, a phone would get the wide
// design for a frame and then swap. So they render on the client only, behind
// a placeholder of the same shape, and the page doesn't shift when they land.

import dynamic from "next/dynamic";

export const HeroDemo = dynamic(() => import("./hero-demo").then((m) => m.HeroDemo), {
  ssr: false,
  loading: () => <div className="lp-demo-slot lp-demo-slot--hero" aria-hidden />,
});

export const ScorecardDemo = dynamic(() => import("./scorecard-demo").then((m) => m.ScorecardDemo), {
  ssr: false,
  loading: () => <div className="lp-demo-slot lp-demo-slot--score" aria-hidden />,
});
