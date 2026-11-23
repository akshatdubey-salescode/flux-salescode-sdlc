"use client";
"use no memo";

// Sign-in panel: Flux's Delivery Tracking, as a system story with no cursor.
// A delivery's issues roll from Pending to Delivered one by one, the meter
// fills, the delivery itself turns Delivered; then it lifts away and the next
// delivery in the stack comes forward. Three deliveries rotate (front, back,
// hidden), each reset while hidden, so after three turns the scene is exactly
// where it began and nothing ever rewinds in view.
//
// Delivery statuses are Flux's own (Pending, Delivered). Projects, keys and
// titles are invented: the page is public.

import { Stage } from "./kit/stage";
import { Text } from "./kit/window";
import { Meter } from "./kit/parts";
import { Badge } from "./kit/controls";
import { Count, Roll } from "./kit/motion";
import type { Act } from "./kit/act";
import "./delivery-demo.css";

type Slot = "front" | "back" | "hidden" | "out";
type S = { slot: [Slot, Slot, Slot]; done: [number, number, number] };

const BATCHES = [
  {
    name: "Checkout 2.4",
    project: "Northwind Retail",
    due: "Due Fri",
    rows: [
      ["NWR-142", "Retry payments on timeout"],
      ["NWR-157", "Bundle discount in cart"],
      ["NWR-163", "Pincode autocomplete"],
      ["NWR-170", "Saved cards on mobile"],
    ],
  },
  {
    name: "Partner Portal 1.8",
    project: "Northwind Partners",
    due: "Due Mon",
    rows: [
      ["PPT-31", "Bulk invite partners"],
      ["PPT-34", "Invoice export to CSV"],
      ["PPT-38", "SSO login for admins"],
      ["PPT-40", "Audit log filters"],
    ],
  },
  {
    name: "Catalog 3.1",
    project: "Northwind Catalog",
    due: "Due Wed",
    rows: [
      ["CAT-88", "Faster search index"],
      ["CAT-91", "Images per variant"],
      ["CAT-95", "Price rules editor"],
      ["CAT-97", "Low stock alerts"],
    ],
  },
] as const;

const initial: S = { slot: ["front", "back", "hidden"], done: [0, 0, 0] };

const next: Record<Slot, Slot> = { front: "out", back: "front", hidden: "back", out: "hidden" };

// The rotation is fixed, so on turn t the card in front is card t
async function turn(a: Act<S>, front: number) {
  // Each issue lands, in reading order
  for (let i = 1; i <= 4; i++) {
    await a.set((p) => {
      const done = [...p.done] as S["done"];
      done[front] = i;
      return { done };
    });
    await a.wait(i === 4 ? 500 : 650);
  }
  // The delivery is complete: hold it
  await a.wait(1900);
  // Lift it away; the stack moves up one
  await a.set((p) => ({ slot: p.slot.map((x) => next[x]) as S["slot"] }));
  await a.wait(1100);
  // Out of view, the lifted card resets and goes to the back of the stack
  await a.snap((p) => {
    const done = [...p.done] as S["done"];
    done[front] = 0;
    return { slot: p.slot.map((x) => (x === "out" ? "hidden" : x)) as S["slot"], done };
  });
  await a.wait(500);
}

async function script(a: Act<S>) {
  await a.wait(700);
  for (let t = 0; t < 3; t++) await turn(a, t);
}

// In the sign-in rotation the slide only needs one delivery landing
async function once(a: Act<S>) {
  await a.wait(500);
  for (let i = 1; i <= 4; i++) {
    await a.set((p) => ({ done: [i, p.done[1], p.done[2]] as S["done"] }));
    await a.wait(600);
  }
}

export function DeliveryDemo({ mode = "loop" }: { mode?: "loop" | "once" }) {
  return (
    <Stage
      width={520}
      height={430}
      accent="#0aa392"
      fidelity="realistic"
      initial={initial}
      poster={{ slot: ["front", "back", "hidden"], done: [4, 0, 0] }}
      script={mode === "once" ? once : script}
      play={mode === "once" ? "once" : "loop"}
      className="fx-deliv"
    >
      {(s) => (
        <div className="fx-deliv__stack">
          {BATCHES.map((b, c) => {
            const done = s.done[c];
            const complete = done === 4;
            return (
              <div className="fx-deliv__card" data-slot={s.slot[c]} key={b.name} aria-hidden={s.slot[c] !== "front"}>
                <div className="fx-deliv__head">
                  <div className="fx-deliv__titles">
                    <Text className="fx-deliv__name">{b.name}</Text>
                    <Text className="fx-deliv__meta">{`${b.project} · ${b.due}`}</Text>
                  </div>
                  <Badge tone={complete ? "success" : "neutral"} dot className="fx-deliv__badge">
                    <Roll variant="fade" align="end">{complete ? "Delivered" : "Pending"}</Roll>
                  </Badge>
                </div>
                <div className="fx-deliv__progress">
                  <Meter value={done / 4} className="fx-deliv__meter" />
                  <span className="fx-deliv__count">
                    <Count value={done} /> of 4 delivered
                  </span>
                </div>
                <div className="fx-deliv__rows">
                  {b.rows.map(([key, title], i) => {
                    const landed = i < done;
                    return (
                      <div className="fx-deliv__row" key={key}>
                        <Text className="fx-deliv__key">{key}</Text>
                        <Text className="fx-deliv__title">{title}</Text>
                        <Badge tone={landed ? "success" : "neutral"} className="fx-deliv__status">
                          <Roll variant="fade" align="end">{landed ? "Delivered" : "Pending"}</Roll>
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Stage>
  );
}
