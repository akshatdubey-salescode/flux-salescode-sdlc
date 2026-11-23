"use client";
"use no memo";

// The landing hero: Flux's Sprint Tracking for a (fictional) project.
// Story: log a delay reason on the overdue issue, copy the sprint update (it
// opens under the button already carrying the reason), then close it and
// undo with Cmd+Z, so the loop returns with a seen cause.
//
// Real strings: the project and sprint, three at-risk issues,
// the delay reasons, the update. Everything else is placeholder lines around
// Flux's own sidebar, which is what makes it recognisably Flux.
//
// All people, projects and keys are invented: this page is public.

import {
  RiBarChart2Line,
  RiBugLine,
  RiCheckLine,
  RiCompass3Line,
  RiFileCopyLine,
  RiFlashlightFill,
  RiFolderLine,
  RiHome3Line,
  RiMedalLine,
  RiSearchLine,
  RiTaskLine,
  RiTeamLine,
  RiTimerLine,
} from "@remixicon/react";
import type { ReactNode } from "react";
// Direct imports, not the kit's barrel: the barrel pulls in phone and
// message styles this page never draws.
import { Stage } from "./kit/stage";
import { Window, Bar, Text } from "./kit/window";
import { Avatar, Menu } from "./kit/parts";
import { Badge, Button, Segmented } from "./kit/controls";
import { Popover, States } from "./kit/motion";
import type { Act } from "./kit/act";
import type { Layout } from "./kit/looks";
import type { Rect } from "./kit/measure";
import "./hero-demo.css";

type S = {
  menu: boolean;
  hoverReason: number;
  reason: boolean;
  copied: boolean;
  update: boolean;
};

const initial: S = { menu: false, hoverReason: -1, reason: false, copied: false, update: false };

type Risk = "overdue" | "risk" | "track" | "done";
type Row = {
  risk: Risk;
  key?: string;
  title?: string;
  who: string;
  due?: string;
  bars: [number, number, number];
};

const ROWS: Row[] = [
  { risk: "done", who: "Ira", bars: [44, 210, 34] },
  { risk: "overdue", key: "NWR-142", title: "Retry payments on gateway timeout", who: "Dev Rao", due: "2d late", bars: [0, 0, 0] },
  { risk: "track", who: "Lena", bars: [44, 168, 38] },
  { risk: "risk", key: "NWR-157", title: "Bundle discount missing in cart", who: "Sam Ortiz", due: "Tomorrow", bars: [0, 0, 0] },
  { risk: "track", who: "Ira", bars: [44, 236, 30] },
  { risk: "risk", key: "NWR-163", title: "Autocomplete for new pincodes", who: "Mei Lin", due: "Thu", bars: [0, 0, 0] },
  { risk: "done", who: "Lena", bars: [44, 150, 36] },
  { risk: "track", who: "Sam Ortiz", bars: [44, 192, 32] },
  { risk: "done", who: "Mei Lin", bars: [44, 128, 34] },
];

const REASONS = ["Dev Delay", "QA Delay", "3rd party dependency", "Env unavailability", "Estimate low"];
const PICK = 2;

async function script(a: Act<S>) {
  const compact = a.layout === "compact";
  await a.wait(900);
  if (compact) {
    // The phone column has no delay column: the story is the update alone
    await a.move({ at: "copy", x: 0.8, y: 0.62 });
    await a.wait(200);
    await a.click();
    await a.set({ copied: true, update: true });
    await a.move({ at: "rest", x: 0.5, y: 0.5 });
    await a.wait(2800);
    await a.set({ update: false, copied: false });
    await a.wait(1400);
    return;
  }

  // 1. Log why the overdue issue slipped
  a.mark("delay");
  await a.move({ at: "log-delay", x: 0.78, y: 0.62 });
  await a.wait(200);
  await a.click();
  await a.set({ menu: true });
  await a.wait(650);
  await a.move({ at: `reason-${PICK}`, x: 0.86, y: 0.55 });
  await a.set({ hoverReason: PICK });
  await a.wait(300);
  await a.click();
  await a.set({ menu: false });
  await a.wait(160);
  await a.set({ reason: true });
  await a.move({ at: "rest", x: 0.5, y: 0.5 });
  await a.wait(900);

  // 2. Share it: the update comes forward already carrying the reason
  a.mark("copy");
  await a.move({ at: "copy", x: 0.8, y: 0.62 });
  await a.wait(200);
  await a.click();
  await a.set({ copied: true, update: true });
  await a.move({ at: "rest", x: 0.5, y: 0.5 });
  a.mark("payoff");
  await a.wait(2600);

  // 3. Close the update, undo the reason: the sprint as it was
  a.mark("reset");
  await a.set({ update: false, copied: false });
  await a.wait(500);
  await a.key("cmd+z");
  await a.set({ reason: false, hoverReason: -1 });
  await a.wait(1200);
}

const POSTER: S = { menu: false, hoverReason: -1, reason: true, copied: true, update: true };

function riskBadge(risk: Risk) {
  if (risk === "overdue") return <Badge tone="danger" dot>Overdue</Badge>;
  if (risk === "risk") return <Badge tone="warning" dot>At risk</Badge>;
  return null;
}

function StatusIcon({ risk }: { risk: Risk }) {
  return (
    <svg className="fx-status" data-risk={risk} width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      {risk === "done" ? (
        <>
          <circle cx="7" cy="7" r="6.25" />
          <path d="M4.4 7.2 6.2 9l3.4-3.6" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <circle className="fx-status__ring" cx="7" cy="7" r="5.5" fill="none" strokeWidth="1.5" />
          <circle className="fx-status__pie" cx="7" cy="7" r="1.75" fill="none" strokeWidth="3.5" pathLength={100} transform="rotate(-90 7 7)" />
        </>
      )}
    </svg>
  );
}

function IssueRow({ r, i, s, compact }: { r: Row; i: number; s: S; compact: boolean }) {
  const real = !!r.key;
  const focal = i === 1;
  return (
      <div className="fx-row" data-target={focal ? "row" : undefined}>
        <StatusIcon risk={r.risk} />
        <span className="fx-key">{real ? <Text>{r.key!}</Text> : <Bar w={r.bars[0]} h={5} tone={2} />}</span>
        <span className="fx-title">
          {real ? <Text className="fx-title__text">{r.title!}</Text> : <Bar w={compact ? Math.min(r.bars[1], 140) : r.bars[1]} h={6} tone={3} />}
        </span>
        {!compact && (
          <span className="fx-delay">
            {focal && (
              <Button
                size="small"
                variant={s.reason ? "secondary" : "ghost"}
                icon={<RiTimerLine size={12} />}
                className="fx-delay__btn"
                data-target="log-delay"
                data-open={s.menu || undefined}
                data-logged={s.reason || undefined}
              >
                {s.reason ? REASONS[PICK] : "Log delay"}
              </Button>
            )}
          </span>
        )}
        <span className="fx-risk">{riskBadge(r.risk)}</span>
        {!compact && <Avatar name={r.who} size={20} plain={!real} className="fx-avatar" />}
        {!compact && (
          <span className="fx-due" data-late={r.risk === "overdue" || undefined}>
            {real ? <Text>{r.due!}</Text> : <Bar w={r.bars[2]} h={5} tone={2} />}
          </span>
        )}
      </div>
  );
}

function Nav({ icon, label, active, kbd }: { icon: ReactNode; label: string; active?: boolean; kbd?: string }) {
  return (
    <div className="fx-nav" data-active={active || undefined}>
      {icon}
      <Text className="fx-nav__label">{label}</Text>
      {kbd && <span className="fx-nav__kbd">{kbd}</span>}
    </div>
  );
}

function Sidebar() {
  const i = { size: 15, className: "fx-icon" };
  return (
    <div className="fx-side">
      <div className="fx-brand">
        <span className="fx-brand__mark">
          <RiFlashlightFill size={12} />
        </span>
        <Text className="fx-brand__name">Flux</Text>
      </div>
      <div className="fx-group">
        <Nav icon={<RiHome3Line {...i} />} label="Dashboard" />
        <Nav icon={<RiSearchLine {...i} />} label="Search" kbd="⌘K" />
        <Nav icon={<RiCompass3Line {...i} />} label="Discover" />
      </div>
      <div className="fx-group">
        <div className="fx-section">My work</div>
        <Nav icon={<RiTaskLine {...i} />} label="My Tasks" />
      </div>
      <div className="fx-group">
        <div className="fx-section">Teams</div>
        <Nav icon={<RiTeamLine {...i} />} label="Team Pulse" />
        <Nav icon={<RiBarChart2Line {...i} />} label="Workload" />
      </div>
      <div className="fx-group">
        <div className="fx-section">Analytics</div>
        <Nav icon={<RiBugLine {...i} />} label="Bug Board" />
        <Nav icon={<RiMedalLine {...i} />} label="Performance Review" />
      </div>
      <div className="fx-group">
        <div className="fx-section">Projects</div>
        <Nav icon={<RiFolderLine {...i} />} label="Northwind Retail" active />
        <div className="fx-nav">
          <RiFolderLine {...i} />
          <Bar w={74} h={5} tone={3} />
        </div>
      </div>
    </div>
  );
}

function Scene({ s, layout, rect }: { s: S; layout: Layout; rect: (name: string) => Rect }) {
  const compact = layout === "compact";
  const lead = (
    <div className="fx-crumbs">
      {!compact && <Text className="fx-crumbs__project">Northwind Retail</Text>}
      {!compact && <span className="fx-crumbs__sep">/</span>}
      <Text className="fx-crumbs__sprint">Sprint 24</Text>
      <Badge tone="accent" className="fx-crumbs__phase">
        Active
      </Badge>
    </div>
  );
  const toolbar = (
    <Button
      size="small"
      variant="primary"
      icon={<States value={s.copied ? "check" : "copy"} states={{ copy: <RiFileCopyLine size={12} />, check: <RiCheckLine size={12} /> }} />}
      className="fx-copy"
      data-target="copy"
    >
      {s.copied ? "Copied" : "Copy update"}
    </Button>
  );
  const body = (
    <div className="fx-body">
      <div className="fx-tools">
        <Segmented items={["List", "Board"]} value={0} className="fx-seg" />
        {!compact && (
          <div className="fx-stats">
            <span className="fx-stat">
              <Text className="fx-stat__label">Committed</Text>
              <span className="fx-stat__value">18</span>
            </span>
            <span className="fx-stat">
              <Text className="fx-stat__label">Done</Text>
              <span className="fx-stat__value">9</span>
            </span>
            <span className="fx-stat">
              <Text className="fx-stat__label">At risk</Text>
              <span className="fx-stat__value" data-tone="risk">3</span>
            </span>
          </div>
        )}
      </div>
      <div className="fx-list">
        {ROWS.map((r, i) => (
          <IssueRow key={i} r={r} i={i} s={s} compact={compact} />
        ))}
      </div>
      <span className="fx-rest" data-target="rest" />
      {/* A fixed point for the update card: the Copy button changes width */}
      <span className="fx-anchor" data-target="update-anchor" />
    </div>
  );
  const props = { lead, toolbar, className: "fx-window", body: { className: "fx-main", "data-crop": true } };
  return (
    <>
      {compact ? (
        <Window {...props}>{body}</Window>
      ) : (
        <Window {...props} sidebar={<Sidebar />} sidebarWidth={200}>
          {body}
        </Window>
      )}

      {!compact && (
        <Popover show={s.menu} origin="top left" className="fx-menu" style={{ left: rect("log-delay").x, top: rect("log-delay").y + rect("log-delay").height + 6 }}>
          <div className="fx-menu__head">Delay reason</div>
          <Menu items={REASONS} value={s.hoverReason < 0 ? undefined : s.hoverReason} targets={REASONS.map((_, i) => `reason-${i}`)} />
        </Popover>
      )}

      {
        <Popover show={s.update} origin="top right" className="fx-update" style={{ left: rect("update-anchor").x - (compact ? 280 : 368), top: rect("update-anchor").y + 2 }}>
          <div className="fx-update__head">
            <Text className="fx-update__title">Sprint 24 update</Text>
            {!compact && <Text className="fx-update__meta">Northwind Retail</Text>}
          </div>
          <div className="fx-update__line">
            <span className="fx-update__num">9 of 18</span>
            <Text className="fx-update__dim">issues done</Text>
          </div>
          <div className="fx-update__line">
            <span className="fx-update__num" data-tone="risk">3</span>
            <Text className="fx-update__dim">at risk</Text>
          </div>
          <div className="fx-update__issue">
            <Text className="fx-update__key">NWR-142</Text>
            <Text className="fx-update__why">2d late · 3rd party dependency</Text>
          </div>
        </Popover>
      }
    </>
  );
}

export function HeroDemo() {
  return (
    <Stage
      width={1040}
      height={540}
      compact={{ below: 900, width: 358, height: 340 }}
      fill
      accent="#0aa392"
      fidelity="realistic"
      initial={initial}
      poster={POSTER}
      script={script}
      cursor={{ at: { at: "rest", x: 0.5, y: 0.5 } }}
      keys="bottom-right"
      className="fx-hero"
    >
      {(s, rect, layout) => <Scene s={s} layout={layout} rect={rect} />}
    </Stage>
  );
}
