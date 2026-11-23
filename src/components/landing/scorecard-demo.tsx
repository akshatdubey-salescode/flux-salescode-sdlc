"use client";
"use no memo";

// Bento hero tile: a Performance Review scorecard. Plays once as it scrolls
// in: the score rolls (Roll, so the ring stays centred on its digits) while the five weighted metrics fill in reading
// order. The weights are Flux's real rubric; the person is invented.

import { Stage } from "./kit/stage";
import { Text } from "./kit/window";
import { Avatar, Meter } from "./kit/parts";
import { Roll } from "./kit/motion";
import type { Act } from "./kit/act";
import "./scorecard-demo.css";

type S = { shown: boolean };

const METRICS: { label: string; weight: string; value: number }[] = [
  { label: "Bug Quality", weight: "30%", value: 0.92 },
  { label: "Sprint Commitment", weight: "25%", value: 0.84 },
  { label: "Complex Tasks", weight: "23%", value: 0.78 },
  { label: "MTTR", weight: "15%", value: 0.88 },
  { label: "AI Tasks", weight: "7%", value: 0.7 },
];
const SCORE = 86;
const R = 34;
const C = 2 * Math.PI * R;

async function script(a: Act<S>) {
  await a.wait(350);
  await a.set({ shown: true });
  await a.wait(1800);
}

export function ScorecardDemo() {
  return (
    <Stage
      width={700}
      height={290}
      compact={{ below: 560, width: 340, height: 360 }}
      accent="#0aa392"
      initial={{ shown: false }}
      poster={{ shown: true }}
      script={script}
      play="once"
      className="fx-score"
    >
      {(s, _rect, layout) => {
        const compact = layout === "compact";
        return (
          <div className="fx-score__card">
            <div className="fx-score__head">
              {!compact && <Avatar name="Priya Nair" size={34} tone="accent" />}
              <div className="fx-score__who">
                <Text className="fx-score__name">Priya Nair</Text>
                <Text className="fx-score__role">Backend · Q2 FY27</Text>
              </div>
            </div>
            <div className="fx-score__body">
              <div className="fx-score__ring" data-shown={s.shown || undefined}>
                <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden>
                  <circle cx="42" cy="42" r={R} className="fx-score__track" />
                  <circle
                    cx="42"
                    cy="42"
                    r={R}
                    className="fx-score__arc"
                    strokeDasharray={C}
                    strokeDashoffset={s.shown ? C * (1 - SCORE / 100) : C}
                    transform="rotate(-90 42 42)"
                  />
                </svg>
                <span className="fx-score__value">
                  <Roll>{String(s.shown ? SCORE : 0)}</Roll>
                </span>
                {compact && (
                  <span className="fx-score__caption">
                    <Text className="fx-score__label">Final score</Text>
                    <Text wrap className="fx-score__role">out of 100, from five weighted metrics</Text>
                  </span>
                )}
              </div>
              <div className="fx-score__metrics">
                {METRICS.map((m, i) => (
                  <div className="fx-score__metric" key={m.label} style={{ transitionDelay: `${i * 90}ms` }}>
                    <Text className="fx-score__label">{m.label}</Text>
                    <span className="fx-score__weight">{m.weight}</span>
                    <Meter value={s.shown ? m.value : 0} className="fx-score__meter" style={{ ["--d" as string]: `${120 + i * 90}ms` }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      }}
    </Stage>
  );
}
