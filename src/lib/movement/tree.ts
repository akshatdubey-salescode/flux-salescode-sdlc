/**
 * Resolve the Jira tree of each root: sub-tasks, epic/parent children (BFS by level, batched
 * JQL) and linked issues (one hop, leaves).
 *
 * Cost model: 1 call per 50 roots for their own fields, then 1 call (plus paging) per 50 frontier
 * keys per level. Linked issues cost NOTHING: Jira embeds their summary/status/type in the
 * `issuelinks` field of the node, and linked nodes are leaves so nothing else is needed. The
 * `subtasks` field of a node is read as well (it covers sub-tasks the JQL missed).
 *
 * Bounds: depth <= 5, <= 60 nodes per root (hierarchy first, then linked), <= 200 roots, 50 keys
 * per JQL, <= 400 issues read per JQL batch. Keys shared between roots are read once.
 */
import { chunk, isJiraKey, type JiraSource } from "./jira-source";

export type NodeKind = "root" | "subtask" | "child" | "linked";

export interface TreeNode {
  key: string;
  kind: NodeKind;
  /** Hierarchy parent; for a linked node the issue it is linked from; null for the root. */
  parentKey: string | null;
  issueType: string;
  statusName: string;
  /** Trimmed to 200 characters. */
  summary: string;
  /** Link type name ("Blocks", "Relates") for linked nodes. */
  linkType?: string;
}

export interface RootTree {
  root: string;
  /** Root first, then hierarchy in BFS order, then linked nodes. */
  nodes: TreeNode[];
  /** A cap (depth, 60 nodes, paging) cut the sub-task/child HIERARCHY: readiness fails closed. */
  truncated: boolean;
  warnings: string[];
  /** Only the linked issues were cut by the node cap. Linked issues never block, so this is a warning. */
  linkedTruncated: boolean;
  /** Jira could not be read (root missing/invisible, or a batch failed). The tree is incomplete. */
  errors: string[];
}

export interface TreeOptions {
  maxDepth?: number;
  maxNodes?: number;
  maxRoots?: number;
  batchSize?: number;
  /** Issues per search page (default 100); a small value lets tests exercise nextPageToken paging. */
  pageSize?: number;
}

export interface TreeResult {
  trees: Map<string, RootTree>;
  /** Number of Jira requests made (every page of every search counts). */
  jiraCalls: number;
  warnings: string[];
}

/** Fields requested: nothing else is read. */
export const TREE_FIELDS = ["summary", "status", "issuetype", "parent", "subtasks", "issuelinks"];

const MAX_ISSUES_PER_BATCH = 400;
const PAGE = 100;

interface Brief {
  key: string;
  issueType: string;
  isSubtask: boolean;
  statusName: string;
  summary: string;
}
interface LinkRef extends Brief {
  linkType: string;
}
interface Detail extends Brief {
  subtasks: Brief[];
  links: LinkRef[];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function briefOf(key: string, fields: unknown): Brief {
  const f = obj(fields) ?? {};
  const it = obj(f.issuetype);
  return {
    key,
    issueType: str(it?.name),
    isSubtask: it?.subtask === true || /sub-?task/i.test(str(it?.name)),
    statusName: str(obj(f.status)?.name),
    summary: str(f.summary).slice(0, 200),
  };
}

function detailOf(issue: { key: string; fields: Record<string, unknown> }): Detail {
  const f = issue.fields ?? {};
  const subtasks: Brief[] = [];
  if (Array.isArray(f.subtasks)) {
    for (const s of f.subtasks) {
      const o = obj(s);
      if (o && isJiraKey(o.key)) subtasks.push(briefOf(o.key, o.fields));
    }
  }
  const links: LinkRef[] = [];
  if (Array.isArray(f.issuelinks)) {
    for (const l of f.issuelinks) {
      const lo = obj(l);
      if (!lo) continue;
      const other = obj(lo.outwardIssue) ?? obj(lo.inwardIssue);
      if (!other || !isJiraKey(other.key)) continue;
      links.push({ ...briefOf(other.key, other.fields), linkType: str(obj(lo.type)?.name) });
    }
  }
  return { ...briefOf(issue.key, f), subtasks, links };
}

export async function resolveTrees(jira: JiraSource, rootKeys: readonly string[], opts: TreeOptions = {}): Promise<TreeResult> {
  const maxDepth = opts.maxDepth ?? 5;
  const maxNodes = opts.maxNodes ?? 60;
  const maxRoots = opts.maxRoots ?? 200;
  const batch = opts.batchSize ?? 50;
  const page_ = opts.pageSize ?? PAGE;
  const result: TreeResult = { trees: new Map(), jiraCalls: 0, warnings: [] };

  const roots: string[] = [];
  for (const raw of rootKeys) {
    const k = typeof raw === "string" ? raw.trim().toUpperCase() : "";
    if (!isJiraKey(k)) {
      result.warnings.push(`Ignored invalid Jira key "${String(raw).slice(0, 40)}"`);
    } else if (!roots.includes(k)) roots.push(k);
  }
  if (roots.length > maxRoots) {
    result.warnings.push(`Only the first ${maxRoots} of ${roots.length} Jiras were resolved`);
    roots.length = maxRoots;
  }

  const details = new Map<string, Detail>();
  /** Hierarchy children (JQL `parent in`) per expanded parent, capped at maxNodes. */
  const childrenOf = new Map<string, Brief[]>();
  const childrenCut = new Set<string>();
  const expanded = new Set<string>();
  const failed = new Map<string, string>(); // key -> error, for keys whose expansion/details failed

  const search = async (jql: string, nextPageToken?: string) => {
    result.jiraCalls++;
    return jira.searchByJql(jql, { fields: TREE_FIELDS, nextPageToken, maxResults: page_ });
  };

  /** Fields of the named keys (one JQL per 50). Missing keys stay absent from `details`. */
  const fetchDetails = async (keys: string[]) => {
    for (const part of chunk(keys, batch)) {
      try {
        let token: string | undefined;
        let read = 0;
        do {
          const page = await search(`key in (${part.join(",")})`, token);
          for (const i of page.issues) details.set(i.key, detailOf(i));
          read += page.issues.length;
          token = page.issues.length ? page.nextPageToken : undefined;
        } while (token && read < MAX_ISSUES_PER_BATCH);
      } catch (e) {
        for (const k of part) failed.set(k, e instanceof Error ? e.message : String(e));
      }
    }
  };

  /** Children of the named parents (one JQL per 50 parents, paged, bounded). */
  const fetchChildren = async (parents: string[]) => {
    for (const part of chunk(parents, batch)) {
      for (const p of part) childrenOf.set(p, []);
      try {
        let token: string | undefined;
        let read = 0;
        do {
          const page = await search(`parent in (${part.join(",")}) ORDER BY key ASC`, token);
          for (const i of page.issues) {
            const pk = str(obj(i.fields?.parent)?.key);
            const list = childrenOf.get(pk);
            if (!list) continue;
            if (list.length >= maxNodes) {
              childrenCut.add(pk);
              continue;
            }
            const d = detailOf(i);
            details.set(i.key, d);
            list.push(d);
          }
          read += page.issues.length;
          token = page.issues.length ? page.nextPageToken : undefined;
        } while (token && read < MAX_ISSUES_PER_BATCH);
        if (token) for (const p of part) childrenCut.add(p);
        for (const p of part) expanded.add(p);
      } catch (e) {
        for (const p of part) {
          failed.set(p, e instanceof Error ? e.message : String(e));
          childrenOf.delete(p);
        }
      }
    }
  };

  // ---- roots
  await fetchDetails(roots);

  interface State {
    nodes: Map<string, TreeNode>;
    frontier: string[];
    truncated: boolean;
    linkedTruncated: boolean;
    warnings: string[];
    errors: string[];
  }
  const states = new Map<string, State>();
  for (const r of roots) {
    const d = details.get(r);
    const st: State = { nodes: new Map(), frontier: [], truncated: false, linkedTruncated: false, warnings: [], errors: [] };
    states.set(r, st);
    if (!d) {
      const why = failed.get(r);
      st.errors.push(why ? `Could not read ${r}: ${why}` : `${r} was not found in Jira (or is not visible)`);
      st.nodes.set(r, { key: r, kind: "root", parentKey: null, issueType: "", statusName: "", summary: "" });
      continue;
    }
    st.nodes.set(r, { key: r, kind: "root", parentKey: null, issueType: d.issueType, statusName: d.statusName, summary: d.summary });
    st.frontier = [r];
  }

  const cut = (st: State, msg: string) => {
    st.truncated = true;
    if (!st.warnings.includes(msg)) st.warnings.push(msg);
  };

  // ---- hierarchy, level by level
  for (let depth = 0; depth < maxDepth; depth++) {
    const live = [...states.values()].filter((s) => s.frontier.length > 0);
    if (live.length === 0) break;

    const need = new Set<string>();
    for (const s of live) for (const k of s.frontier) if (!expanded.has(k) && !failed.has(k)) need.add(k);
    await fetchChildren([...need]);

    // Sub-tasks named by the `subtasks` field that the JQL did not return: read their fields.
    const missing = new Set<string>();
    for (const s of live) {
      for (const k of s.frontier) {
        for (const sub of details.get(k)?.subtasks ?? []) if (!details.has(sub.key) && !failed.has(sub.key)) missing.add(sub.key);
      }
    }
    if (missing.size) await fetchDetails([...missing]);

    for (const [root, s] of states) {
      const next: string[] = [];
      for (const key of s.frontier) {
        const err = failed.get(key);
        if (err) {
          s.errors.push(`Could not read the children of ${key}: ${err}`);
          continue;
        }
        const kids = new Map<string, Brief>();
        for (const c of childrenOf.get(key) ?? []) kids.set(c.key, c);
        for (const c of details.get(key)?.subtasks ?? []) {
          if (!kids.has(c.key)) kids.set(c.key, details.get(c.key) ?? c);
          // The sub-task is listed (from its parent's brief) but its own fields could not be read, so its
          // links are lost: the tree is DEGRADED (an error, not a silent gap).
          const why = failed.get(c.key);
          if (why) {
            const msg = `Could not read ${c.key}: ${why}`;
            if (!s.errors.includes(msg)) s.errors.push(msg);
          }
        }
        if (childrenCut.has(key)) cut(s, `${key} has more children than the ${maxNodes} read`);
        for (const c of kids.values()) {
          if (s.nodes.has(c.key)) continue; // cycle or shared node
          if (s.nodes.size >= maxNodes) {
            cut(s, `${root}: tree capped at ${maxNodes} Jiras`);
            break;
          }
          s.nodes.set(c.key, {
            key: c.key,
            kind: c.isSubtask ? "subtask" : "child",
            parentKey: key,
            issueType: c.issueType,
            statusName: c.statusName,
            summary: c.summary,
          });
          // A sub-task is a leaf in Jira: no query needed to look for its children.
          if (!c.isSubtask) next.push(c.key);
        }
      }
      s.frontier = next;
    }
  }
  // Nodes left at the depth limit: only a problem when one of them really has children, so ask
  // once (one JQL per 50 nodes, and only in this rare case). A failed check counts as truncated.
  const atLimit = new Set<string>();
  for (const s of states.values()) for (const k of s.frontier) if (!expanded.has(k)) atLimit.add(k);
  if (atLimit.size) await fetchChildren([...atLimit]);
  for (const s of states.values()) {
    for (const k of s.frontier) {
      const err = failed.get(k);
      if (err) {
        // A failed check is an ERROR as well as a cut: the caller must see the tree as degraded (unreadable),
        // not merely "incomplete", so an item that was ready before is not flipped by a passing outage.
        cut(s, `Depth limit ${maxDepth} reached and ${k} could not be checked for children: ${err}`);
        const msg = `Could not check the children of ${k} at the depth limit: ${err}`;
        if (!s.errors.includes(msg)) s.errors.push(msg);
      }
      else if ((childrenOf.get(k)?.length ?? 0) > 0 || (details.get(k)?.subtasks.length ?? 0) > 0) {
        cut(s, `Depth limit ${maxDepth} reached; deeper Jiras were not read`);
      }
    }
  }

  // ---- linked issues: one hop from each hierarchy node, leaves, added after the hierarchy so
  // they can never crowd out a sub-task of the same root.
  for (const s of states.values()) {
    const hierarchy = [...s.nodes.values()];
    for (const n of hierarchy) {
      for (const l of details.get(n.key)?.links ?? []) {
        if (s.nodes.has(l.key)) continue;
        if (s.nodes.size >= maxNodes) {
          s.linkedTruncated = true; // not `truncated`: a linked issue never creates a requirement
          break;
        }
        s.nodes.set(l.key, {
          key: l.key,
          kind: "linked",
          parentKey: n.key,
          issueType: l.issueType,
          statusName: l.statusName,
          summary: l.summary,
          linkType: l.linkType || undefined,
        });
      }
    }
  }

  for (const [root, s] of states) {
    result.trees.set(root, {
      root,
      nodes: [...s.nodes.values()],
      truncated: s.truncated,
      linkedTruncated: s.linkedTruncated,
      warnings: s.warnings,
      errors: s.errors,
    });
  }
  return result;
}

/** Every distinct node key of the given trees (for the record loader). */
export function allKeys(trees: Iterable<RootTree>): string[] {
  const out = new Set<string>();
  for (const t of trees) for (const n of t.nodes) out.add(n.key);
  return [...out];
}
