/**
 * Merge the deploy order of every record into ONE sequence.
 *
 * Nodes are `repo#PR` (global: two Jiras that share a PR share the node) or free-text steps
 * (scoped to their Jira: steps of different Jiras are independent unless they share a PR).
 * Edges come from each record's `order.edges` plus the step chain when the steps are an explicit
 * sequence. The sequence is a topological sort (Kahn) where ties go to the node seen first, so
 * the output is deterministic and one Jira's chain stays together. A cycle is never broken
 * silently: the nodes on it are reported (Tarjan SCC) and listed flagged at the end.
 * O((n + e) log n); all maps, no pairwise scans.
 */
import type { OrderEdge, OrderStep } from "../record";
import type { ItemSource } from "./types";
import { cap, resolveRepo, stepSig, tidy } from "./normalize";

export interface OrderRecord {
  jira: string;
  /** `repo#n` of the PR the record describes. */
  pr: string;
  steps: OrderStep[];
  edges: OrderEdge[];
  /** The step list is an explicit sequence: chain it even when edges exist. */
  structured: boolean;
}

export interface MergedStep {
  key: string;
  label: string;
  /** Jiras whose records name this step. */
  jiras: string[];
  /** 1-based position in the merged order. */
  seq: number;
  isPr: boolean;
  /** Up to MAX_ORDER_SOURCES; the caller caps for display. */
  sources: ItemSource[];
  /** On a cycle (or fed by one): its position is not reliable. */
  cycle?: true;
}

export interface OrderCycle {
  keys: string[];
  labels: string[];
  sources: ItemSource[];
}

export interface MergedOrder {
  steps: MergedStep[];
  cycles: OrderCycle[];
  /** `repo#pr` nodes the order names that have no record in the movement (a held Jira's PR, an unknown repo). */
  unlisted: Array<{ pr: string; sources: ItemSource[] }>;
  /** Edges from a step to itself (ignored, reported). */
  selfLoops: Array<{ label: string; sources: ItemSource[] }>;
  /** The node cap was reached; later steps were not merged. */
  truncated: boolean;
}

export const MAX_ORDER_NODES = 3000;
export const MAX_ORDER_EDGES = 12000;
const MAX_ORDER_SOURCES = 200;

const PR_RE = /^\s*([A-Za-z0-9_.\-/]{1,100})\s*#\s*(\d{1,7})\s*$/;
/** An edge endpoint that starts with a PR and carries a trailing note: "channelkart#1184 (property off)". */
const PR_PREFIX_RE = /^\s*([A-Za-z0-9_.\-/]{1,100})\s*#\s*(\d{1,7})(?=$|[\s(,;:])/;

interface Node {
  key: string;
  labels: Set<string>;
  isPr: boolean;
  sources: Map<string, ItemSource>;
}

const MAX_LABELS = 6;

/** The shortest human label that names the PR (a bare `repo#n` only when nothing else exists); free text: the longest. */
function pickLabel(n: Node): string {
  const labels = [...n.labels];
  if (!n.isPr) return labels.reduce((a, b) => (b.length > a.length ? b : a), labels[0]);
  const m = /^pr:(.*)#(\d+)$/.exec(n.key);
  const bare = m ? `${m[1]}#${m[2]}` : "";
  const named = labels.filter((l) => l.replace(/\s+/g, "") !== bare);
  const pool = named.length ? named : labels;
  return pool.reduce((a, b) => (b.length < a.length ? b : a), pool[0]);
}

class MinHeap {
  private a: number[] = [];
  get size() {
    return this.a.length;
  }
  push(v: number) {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p] <= a[i]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0];
    const last = a.pop() as number;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l] < a[m]) m = l;
        if (r < a.length && a[r] < a[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export function mergeOrder(records: OrderRecord[], knownRepos: ReadonlySet<string>, recordPrs: ReadonlySet<string> = new Set()): MergedOrder {
  const nodes: Node[] = [];
  const index = new Map<string, number>();
  const edgeSet = new Set<string>();
  const edges: Array<[number, number]> = [];
  const edgeSrc = new Map<string, ItemSource>();
  const selfLoops = new Map<string, { label: string; sources: Map<string, ItemSource> }>();
  let truncated = false;

  const touch = (key: string, label: string, isPr: boolean, src: ItemSource): number => {
    let id = index.get(key);
    if (id === undefined) {
      if (nodes.length >= MAX_ORDER_NODES) {
        truncated = true;
        return -1;
      }
      id = nodes.length;
      index.set(key, id);
      nodes.push({ key, labels: new Set(), isPr, sources: new Map() });
    }
    const n = nodes[id];
    if (n.labels.size < MAX_LABELS) n.labels.add(label);
    const sk = `${src.jira}|${src.pr}`;
    if (!n.sources.has(sk)) n.sources.set(sk, src);
    return id;
  };

  const addEdge = (a: number, b: number, src: ItemSource) => {
    if (a < 0 || b < 0) return;
    if (a === b) {
      const sl = selfLoops.get(nodes[a].key) ?? { label: [...nodes[a].labels][0], sources: new Map() };
      sl.sources.set(`${src.jira}|${src.pr}`, src);
      selfLoops.set(nodes[a].key, sl);
      return;
    }
    const k = `${a}>${b}`;
    if (edgeSet.has(k)) return;
    if (edges.length >= MAX_ORDER_EDGES) {
      truncated = true;
      return;
    }
    edgeSet.add(k);
    edges.push([a, b]);
    edgeSrc.set(k, src);
  };

  for (const rec of records) {
    const src: ItemSource = { jira: rec.jira, pr: rec.pr, section: 11 };
    const byText = new Map<string, number>();
    const chain: number[] = [];

    for (const step of rec.steps) {
      const text = cap(tidy(step.text, 1200), 700);
      if (!text) continue;
      let id: number;
      if (step.refs.length) {
        const ref = step.refs[0];
        const repo = resolveRepo(ref.repo, knownRepos);
        id = touch(`pr:${repo}#${Number(ref.pr)}`, text, true, src);
      } else {
        id = touch(`t:${rec.jira}|${stepSig(text)}`, text, false, src);
      }
      byText.set(stepSig(text), id);
      chain.push(id);
    }

    const resolveEnd = (raw: string): number => {
      const text = cap(tidy(raw, 1200), 700);
      const m = PR_RE.exec(text);
      if (m) {
        const repo = resolveRepo(m[1], knownRepos);
        return touch(`pr:${repo}#${Number(m[2])}`, `${repo}#${Number(m[2])}`, true, src);
      }
      const hit = byText.get(stepSig(text));
      if (hit !== undefined) return hit;
      // "channelkart#1184 (property off)": the PR with a trailing note.
      const pm = PR_PREFIX_RE.exec(text);
      if (pm) {
        const repo = resolveRepo(pm[1], knownRepos);
        return touch(`pr:${repo}#${Number(pm[2])}`, text, true, src);
      }
      if (!text) return -1;
      return touch(`t:${rec.jira}|${stepSig(text)}`, text, false, src);
    };

    for (const e of rec.edges) {
      addEdge(resolveEnd(e.before), resolveEnd(e.after), src);
    }
    if (rec.structured || rec.edges.length === 0) {
      for (let i = 1; i < chain.length; i++) addEdge(chain[i - 1], chain[i], src);
    }
  }

  const n = nodes.length;
  const out: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Array<number>(n).fill(0);
  for (const [a, b] of edges) {
    out[a].push(b);
    indeg[b]++;
  }

  // Kahn with a min-heap on first-appearance rank: deterministic, keeps a Jira's chain together.
  const heap = new MinHeap();
  for (let i = 0; i < n; i++) if (indeg[i] === 0) heap.push(i);
  const orderIds: number[] = [];
  const placed = new Array<boolean>(n).fill(false);
  while (heap.size) {
    const v = heap.pop();
    placed[v] = true;
    orderIds.push(v);
    for (const w of out[v]) if (--indeg[w] === 0) heap.push(w);
  }

  const cycles: OrderCycle[] = [];
  const flagged = new Set<number>();
  if (orderIds.length < n) {
    const rest: number[] = [];
    for (let i = 0; i < n; i++) if (!placed[i]) rest.push(i);
    for (const comp of sccs(rest, out, placed)) {
      if (comp.length < 2) continue;
      comp.sort((a, b) => a - b);
      const inComp = new Set(comp);
      const sources = new Map<string, ItemSource>();
      for (const a of comp) for (const b of out[a]) if (inComp.has(b)) {
        const s = edgeSrc.get(`${a}>${b}`);
        if (s) sources.set(`${s.jira}|${s.pr}`, s);
      }
      cycles.push({
        keys: comp.map((i) => nodes[i].key),
        labels: comp.map((i) => pickLabel(nodes[i])),
        sources: [...sources.values()].slice(0, 16),
      });
    }
    cycles.sort((a, b) => (a.keys[0] < b.keys[0] ? -1 : a.keys[0] > b.keys[0] ? 1 : 0));
    // Not placed by the sort: listed after the ordered part, in first-seen order, flagged.
    for (const i of rest) {
      flagged.add(i);
      orderIds.push(i);
    }
  }

  const steps: MergedStep[] = orderIds.map((id, i) => {
    const node = nodes[id];
    const all = [...node.sources.values()];
    const step: MergedStep = {
      key: node.key,
      label: cap(pickLabel(node), 700),
      jiras: [...new Set(all.map((x) => x.jira))],
      seq: i + 1,
      isPr: node.isPr,
      sources: all.slice(0, MAX_ORDER_SOURCES),
    };
    if (flagged.has(id)) step.cycle = true;
    return step;
  });
  const unlisted: MergedOrder["unlisted"] = [];
  for (const node of nodes) {
    if (!node.isPr) continue;
    const pr = node.key.slice(3);
    if (!recordPrs.has(pr)) unlisted.push({ pr, sources: [...node.sources.values()].slice(0, 8) });
  }
  const loops = [...selfLoops.values()].map((l) => ({ label: cap(l.label, 200), sources: [...l.sources.values()].slice(0, 8) }));
  return { steps, cycles, unlisted, selfLoops: loops, truncated };
}

/** Strongly connected components of the subgraph induced by `ids` (iterative Tarjan: no recursion limit). */
function sccs(ids: number[], out: number[][], placed: boolean[]): number[][] {
  const idx = new Map<number, number>();
  const low = new Map<number, number>();
  const onStack = new Set<number>();
  const stack: number[] = [];
  const result: number[][] = [];
  let counter = 0;

  for (const root of ids) {
    if (idx.has(root)) continue;
    const work: Array<{ v: number; i: number }> = [{ v: root, i: 0 }];
    idx.set(root, counter);
    low.set(root, counter);
    counter++;
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const frame = work[work.length - 1];
      const nbrs = out[frame.v];
      if (frame.i < nbrs.length) {
        const w = nbrs[frame.i++];
        if (placed[w]) continue;
        if (!idx.has(w)) {
          idx.set(w, counter);
          low.set(w, counter);
          counter++;
          stack.push(w);
          onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.v, Math.min(low.get(frame.v) as number, idx.get(w) as number));
        }
      } else {
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1].v;
          low.set(parent, Math.min(low.get(parent) as number, low.get(frame.v) as number));
        }
        if (low.get(frame.v) === idx.get(frame.v)) {
          const comp: number[] = [];
          let w: number;
          do {
            w = stack.pop() as number;
            onStack.delete(w);
            comp.push(w);
          } while (w !== frame.v);
          result.push(comp);
        }
      }
    }
  }
  return result;
}
