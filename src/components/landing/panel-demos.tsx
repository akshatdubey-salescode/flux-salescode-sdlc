"use client";
"use no memo";

// The sign-in panel's other slides, each one card that plays once when its
// slide comes up: Bug Board, Team Pulse and Performance Review. Same stage
// size, card position and shadow as the delivery card, so the rotation reads
// as one object changing, not four layouts. Labels are Flux's own; people
// and teams are invented.

import { Stage } from "./kit/stage";
import { Text } from "./kit/window";
import { Avatar, Meter } from "./kit/parts";
import { Badge } from "./kit/controls";
import { Count, Roll } from "./kit/motion";
import type { Act } from "./kit/act";
import "./panel-demos.css";

type Shown = { shown: boolean; flagged: boolean };
const hidden: Shown = { shown: false, flagged: false };
const done: Shown = { shown: true, flagged: true };

async function reveal(a: Act<Shown>) {
  await a.wait(450);
  await a.set({ shown: true });
  await a.wait(1500);
  await a.set({ flagged: true });
}

function PanelStage({ children, className }: { children: (s: Shown) => React.ReactNode; className: string }) {
  return (
    <Stage
      width={520}
      height={430}
      accent="#0aa392"
      fidelity="realistic"
      initial={hidden}
      poster={done}
      script={reveal}
      play="once"
      className={`fxp ${className}`}
    >
      {(s) => <div className="fxp-card">{children(s)}</div>}
    </Stage>
  );
}

/* ------------------------------------------------------------ Bug Board */

const DEVS = [
  { name: "Dev Rao", p1: 2, p2: 4, open: 9, share: 0.36 },
  { name: "Lena Fischer", p1: 1, p2: 3, open: 7, share: 0.28 },
  { name: "Sam Ortiz", p1: 0, p2: 2, open: 5, share: 0.2 },
  { name: "Mei Lin", p1: 0, p2: 1, open: 4, share: 0.16 },
];

export function BugBoardDemo() {
  return (
    <PanelStage className="fxp-bugs">
      {(s) => (
        <>
          <div className="fxp-head">
            <div className="fxp-titles">
              <Text className="fxp-name">Developer Breakdown</Text>
              <Text className="fxp-meta">Bug Board · Last 7d</Text>
            </div>
            <Badge tone={s.flagged ? "danger" : "neutral"} dot className="fxp-badge">
              <Roll variant="fade" align="end">{s.flagged ? "3 P1 open" : "Last 7d"}</Roll>
            </Badge>
          </div>
          <div className="fxp-bugs__table">
            <div className="fxp-bugs__row fxp-bugs__row--head">
              <span>Name</span>
              <span>P1 Open</span>
              <span>P2 Open</span>
              <span>Total</span>
              <span>% Share</span>
            </div>
            {DEVS.map((d, i) => (
              <div className="fxp-bugs__row" key={d.name}>
                <span className="fxp-person">
                  <Avatar name={d.name} size={22} />
                  <Text className="fxp-person__name">{d.name}</Text>
                </span>
                <span className="fxp-num" data-hot={d.p1 > 0 || undefined}>
                  <Count value={s.shown ? d.p1 : 0} duration={700 + i * 80} />
                </span>
                <span className="fxp-num">
                  <Count value={s.shown ? d.p2 : 0} duration={700 + i * 80} />
                </span>
                <span className="fxp-num fxp-num--strong">
                  <Count value={s.shown ? d.open : 0} duration={700 + i * 80} />
                </span>
                <Meter value={s.shown ? d.share : 0} className="fxp-meter" style={{ ["--d" as string]: `${i * 90}ms` }} />
              </div>
            ))}
          </div>
        </>
      )}
    </PanelStage>
  );
}

/* ----------------------------------------------------------- Team Pulse */

const TEAM = [
  { name: "Aarav Shah", load: 0.94, risk: true },
  { name: "Lena Fischer", load: 0.62, risk: false },
  { name: "Sam Ortiz", load: 0.41, risk: false },
  { name: "Mei Lin", load: 0.7, risk: false },
];

export function TeamPulseDemo() {
  return (
    <PanelStage className="fxp-team">
      {(s) => (
        <>
          <div className="fxp-head">
            <div className="fxp-titles">
              <Text className="fxp-name">Promotions Team</Text>
              <Text className="fxp-meta">Team Pulse · This Week</Text>
            </div>
          </div>
          <div className="fxp-stats">
            <span className="fxp-stat">
              <span className="fxp-stat__value">
                <Count value={s.shown ? 31 : 0} />
              </span>
              <Text className="fxp-stat__label">Open issues</Text>
            </span>
            <span className="fxp-stat">
              <span className="fxp-stat__value">
                <Count value={s.shown ? 12 : 0} />
              </span>
              <Text className="fxp-stat__label">Completed this week</Text>
            </span>
          </div>
          <div className="fxp-team__rows">
            {TEAM.map((m, i) => (
              <div className="fxp-team__row" key={m.name}>
                <span className="fxp-person">
                  <Avatar name={m.name} size={22} />
                  <Text className="fxp-person__name">{m.name}</Text>
                </span>
                <Meter
                  value={s.shown ? m.load : 0}
                  tone={m.risk && s.flagged ? "warning" : "accent"}
                  className="fxp-meter"
                  style={{ ["--d" as string]: `${i * 90}ms` }}
                />
                <Badge tone={m.risk && s.flagged ? "warning" : "success"} className="fxp-status">
                  <Roll variant="fade" align="end">{m.risk && s.flagged ? "At Risk" : "On Track"}</Roll>
                </Badge>
              </div>
            ))}
          </div>
        </>
      )}
    </PanelStage>
  );
}

/* --------------------------------------------------- Performance Review */

const METRICS = [
  { label: "Bug Quality", weight: "30%", value: 0.92 },
  { label: "Sprint Commitment", weight: "25%", value: 0.84 },
  { label: "Complex Tasks", weight: "23%", value: 0.78 },
  { label: "MTTR", weight: "15%", value: 0.88 },
  { label: "AI Tasks", weight: "7%", value: 0.7 },
];
const R = 30;
const C = 2 * Math.PI * R;

export function ReviewDemo() {
  return (
    <PanelStage className="fxp-review">
      {(s) => (
        <>
          <div className="fxp-head">
            <span className="fxp-person">
              <Avatar name="Priya Nair" size={30} tone="accent" />
              <span className="fxp-titles">
                <Text className="fxp-name">Priya Nair</Text>
                <Text className="fxp-meta">Performance Review · Q2 FY27</Text>
              </span>
            </span>
          </div>
          <div className="fxp-review__body">
            <div className="fxp-ring">
              <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden>
                <circle cx="38" cy="38" r={R} className="fxp-ring__track" />
                <circle
                  cx="38"
                  cy="38"
                  r={R}
                  className="fxp-ring__arc"
                  strokeDasharray={C}
                  strokeDashoffset={s.shown ? C * (1 - 0.86) : C}
                  transform="rotate(-90 38 38)"
                />
              </svg>
              <span className="fxp-ring__value">
                <Roll>{s.shown ? "86" : "0"}</Roll>
              </span>
            </div>
            <div className="fxp-metrics">
              {METRICS.map((m, i) => (
                <div className="fxp-metric" key={m.label}>
                  <Text className="fxp-metric__label">{m.label}</Text>
                  <span className="fxp-metric__weight">{m.weight}</span>
                  <Meter value={s.shown ? m.value : 0} className="fxp-meter" style={{ ["--d" as string]: `${120 + i * 90}ms` }} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </PanelStage>
  );
}
