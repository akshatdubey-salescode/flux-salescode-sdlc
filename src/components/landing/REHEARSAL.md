# Landing demos: rehearsal notes

Two Stageshow stages on `/`; everything else on the page is plain HTML and CSS.

## Hero (`hero-demo.tsx`)

- **Gold copied:** `examples/linear` (wide hero, sidebar window, issue list).
  The popover recipe follows `examples/hero-demo`.
- **What changed:** the product is Flux's Sprint Tracking, with Flux's real
  sidebar labels and Remix icons. The window is centred on a teal-to-blue
  ground and runs off the bottom.
- **The story:** log a delay reason on the overdue issue, then copy the sprint
  update. The update opens under its button and carries the reason. The loop
  resets with a seen cause: the card closes, then Cmd+Z.
- **Compact (358 wide):** the window shows no sidebar and no delay column, so
  the story is the update alone.
- **Data:** all names, projects and issue keys are invented, because the page
  is public.

## Scorecard (`scorecard-demo.tsx`)

- **Gold copied:** `examples/static-card` (pinned, bottom bleed).
- **The story:** plays once on scroll-in. The score rolls to 86 while the five
  weighted metrics fill.
- **Weights:** Flux's real rubric (`key-decisions.md`).
- **Compact:** the avatar is dropped and the ring carries a caption.
- **Number:** the score uses `Roll`, not `Count`, so the ring stays centred
  when the score goes from one digit to two.

## Rendering

Both stages are client-only (`demos.tsx`, `next/dynamic` with `ssr: false`).
They render behind placeholders of the same shape. Server-rendered, a phone
got the wide design for a frame and then swapped to compact.

## Captured

- **Hero:** full loop with `--gate` at 1280 and 390, on the production build
  (`pnpm build && pnpm start`).
- **Scorecard:** its once-play with `--gate` at 1280.
- **Whole page:** screenshots at 1440 and 390, and at 1440 with a dark OS
  colour scheme. That render is identical, because the light tokens are pinned
  on `.landing`.

## Gate lines left, and why

- **`kit override` (6 lines):** a false positive in this host.
  - Film exempts kit CSS by stylesheet URL (`/kit/`), but Next bundles all
    CSS into `/_next/static/chunks/*.css`, so it flags the kit's own rules.
  - `grep` confirms none of our CSS touches a guarded `.ss-*` part.
- **`steps in its box` on the sidebar and the List/Board toggle:** this fires
  at load, before any beat. The web fonts swapping in above the stage nudge it
  once.
- **`handoff shift` of 0.3 to 0.5px:** inside the kit `Button`'s own label
  crossfade (Copy update to Copied).

## Not checked

- Touch devices.
- Safari and Firefox (only headless Chrome).
- A slow network's font swap.
- The scorecard at 390 in motion (checked as a still only).
