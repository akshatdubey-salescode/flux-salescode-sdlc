"use client";

import { useEffect } from "react";

/**
 * The page's micro-motion, in one observer: anything marked `data-reveal`
 * gets `data-in` the first time it is a little way into the viewport, and
 * the nav gets `data-scrolled` once the page moves. The CSS does the rest
 * (and stands down under prefers-reduced-motion).
 */
export function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".landing");
    if (!root) return;
    root.dataset.motion = "on";

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.in = "";
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12 },
    );
    root.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));

    const nav = root.querySelector<HTMLElement>(".lp-nav");
    const onScroll = () => {
      if (nav) nav.toggleAttribute("data-scrolled", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
  return null;
}
