"use client";

import { useMemo, useState } from "react";
import { RiArrowDownSLine, RiArrowRightSLine } from "@remixicon/react";
import { Checkbox } from "@/components/ui/checkbox";
import type { TeamTreeNode } from "@/lib/keka/directory";

type NodeStat = { checkedCount: number; totalCount: number };

/** One O(n) post-order pass per checked-set change — not recomputed per click. */
function computeStats(root: TeamTreeNode, checked: Set<string>): Map<string, NodeStat> {
  const map = new Map<string, NodeStat>();
  function visit(node: TeamTreeNode): NodeStat {
    let stat: NodeStat = { checkedCount: checked.has(node.email) ? 1 : 0, totalCount: 1 };
    for (const child of node.children) {
      const childStat = visit(child);
      stat = {
        checkedCount: stat.checkedCount + childStat.checkedCount,
        totalCount: stat.totalCount + childStat.totalCount,
      };
    }
    map.set(node.email, stat);
    return stat;
  }
  visit(root);
  return map;
}

/** Every email in this node's own subtree, root included. */
export function collectSubtreeEmails(node: TeamTreeNode): string[] {
  const out: string[] = [];
  const stack = [node];
  while (stack.length) {
    const n = stack.pop()!;
    out.push(n.email);
    stack.push(...n.children);
  }
  return out;
}

/**
 * Toggling a node only ever walks that node's OWN subtree (not the whole
 * tree) — cascade on checks/unchecks every descendant along with it; cascade
 * off touches only this one node, leaving children's state exactly as it was.
 */
function toggleNode(
  node: TeamTreeNode,
  nextChecked: boolean,
  cascade: boolean,
  prev: Set<string>
): Set<string> {
  const next = new Set(prev);
  const apply = (email: string) => (nextChecked ? next.add(email) : next.delete(email));
  apply(node.email);
  if (cascade) {
    for (const email of collectSubtreeEmails(node)) apply(email);
  }
  return next;
}

export type TeamTreeSelectProps = {
  root: TeamTreeNode;
  checked: Set<string>;
  onCheckedChange: (next: Set<string>) => void;
  cascade: boolean;
};

export function TeamTreeSelect({ root, checked, onCheckedChange, cascade }: TeamTreeSelectProps) {
  const stats = useMemo(() => computeStats(root, checked), [root, checked]);
  // Only the root + its direct children are expanded by default so a large
  // subtree doesn't dump hundreds of rows on first render.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([root.email, ...root.children.map((c) => c.email)])
  );

  function toggleExpanded(email: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  function renderNode(node: TeamTreeNode, depth: number) {
    const stat = stats.get(node.email)!;
    const ownChecked = checked.has(node.email);
    // Indeterminate reflects present state (some-but-not-all descendants
    // checked right now), independent of the cascade toggle's position —
    // the toggle only governs what a FUTURE click will do, not what's true now.
    const descendantChecked = stat.checkedCount - (ownChecked ? 1 : 0);
    const checkboxState: boolean | "indeterminate" = ownChecked
      ? true
      : descendantChecked > 0
        ? "indeterminate"
        : false;
    const hasChildren = node.children.length > 0;
    const isExpanded = expanded.has(node.email);

    return (
      <div key={node.email}>
        <div className="flex items-center gap-1.5 py-1" style={{ paddingLeft: `${depth * 20}px` }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleExpanded(node.email)}
              className="flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
              aria-label={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? <RiArrowDownSLine size={14} /> : <RiArrowRightSLine size={14} />}
            </button>
          ) : (
            <span className="size-4 shrink-0" />
          )}
          <Checkbox
            checked={checkboxState}
            onCheckedChange={(next) => onCheckedChange(toggleNode(node, next === true, cascade, checked))}
          />
          <span className="truncate text-sm text-foreground">{node.name}</span>
          {node.jobTitle && (
            <span className="truncate text-xs text-muted-foreground">— {node.jobTitle}</span>
          )}
          {hasChildren && (
            <span className="ml-auto shrink-0 pl-2 text-[10px] tabular-nums text-muted-foreground/70">
              {stat.checkedCount}/{stat.totalCount}
            </span>
          )}
        </div>
        {hasChildren && isExpanded && (
          <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  }

  return (
    <div className="max-h-64 overflow-y-auto rounded-md border border-input p-1">
      {renderNode(root, 0)}
    </div>
  );
}
