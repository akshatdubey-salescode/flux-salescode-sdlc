"use client";

import { useMemo } from "react";
import {
  RiArrowLeftLine,
  RiArrowRightLine,
  RiRefreshLine,
  RiLayoutLeftLine,
} from "@remixicon/react";
import { NAV_SECTIONS } from "@/components/app-sidebar";
import { useSidebarPreferences } from "@/components/use-sidebar-preferences";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  isSuperuser: boolean;
  requirementBuilderEnabled: boolean;
};

type CatalogItem = {
  label: string;
  href: string;
  icon: (typeof NAV_SECTIONS)[number]["items"][number]["icon"];
  section: string;
};

export function CustomiseSidebarClient({
  isSuperuser,
  requirementBuilderEnabled,
}: Props) {
  const { visibleHrefs, knownHrefs, saveVisibleHrefs, hydrated } = useSidebarPreferences();

  // The set of items the user could put in their sidebar, respecting the same
  // role / feature-flag gating the live sidebar applies.
  const catalog = useMemo<CatalogItem[]>(() => {
    const items: CatalogItem[] = [];
    for (const section of NAV_SECTIONS) {
      if (section.superuserOnly && !isSuperuser) continue;
      for (const item of section.items) {
        if (item.href === "/requirements" && !requirementBuilderEnabled) {
          continue;
        }
        items.push({
          label: item.label,
          href: item.href,
          icon: item.icon,
          section: section.label ?? "General",
        });
      }
    }
    return items;
  }, [isSuperuser, requirementBuilderEnabled]);

  const allHrefs = useMemo(() => catalog.map((c) => c.href), [catalog]);

  // Effective visible set. `null` (no saved preference) means "show everything".
  // Items shipped after the last save (absent from the known set) count as
  // visible, matching the live sidebar's isVisible().
  const visibleSet = useMemo(() => {
    if (visibleHrefs === null) return new Set(allHrefs);
    const set = new Set(visibleHrefs.filter((h) => allHrefs.includes(h)));
    if (knownHrefs !== null) {
      for (const h of allHrefs) if (!knownHrefs.includes(h)) set.add(h);
    }
    return set;
  }, [visibleHrefs, knownHrefs, allHrefs]);

  // Persist the new set, always in catalog order so storage stays tidy. The
  // full catalog is stored alongside as the known set, so anything shipped
  // after this save defaults to visible instead of silently disappearing.
  function commit(next: Set<string>) {
    saveVisibleHrefs(
      allHrefs.filter((h) => next.has(h)),
      allHrefs
    );
  }

  function setItemVisible(href: string, visible: boolean) {
    const next = new Set(visibleSet);
    if (visible) next.add(href);
    else next.delete(href);
    commit(next);
  }

  const available = catalog.filter((c) => !visibleSet.has(c.href));
  const selected = catalog.filter((c) => visibleSet.has(c.href));

  const isDefault = visibleHrefs === null;

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted/30" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
          <RiLayoutLeftLine className="size-5 text-primary" />
          Customise Sidebar
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose which menu items appear in your sidebar. Move the items you
          want into <span className="font-medium text-foreground">My Sidebar</span>{" "}
          — changes apply instantly and are saved to this browser.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel
          title="Available items"
          count={available.length}
          emptyText="Everything is in your sidebar."
          items={available}
          direction="add"
          onMove={(href) => setItemVisible(href, true)}
          headerAction={
            available.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => commit(new Set(allHrefs))}
              >
                Add all
              </Button>
            ) : null
          }
        />

        <Panel
          title="My Sidebar"
          count={selected.length}
          emptyText="No items selected — your sidebar will be empty."
          items={selected}
          direction="remove"
          onMove={(href) => setItemVisible(href, false)}
          headerAction={
            selected.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => commit(new Set())}
              >
                Remove all
              </Button>
            ) : null
          }
        />
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          {isDefault
            ? "Showing the default set (all items)."
            : `${selected.length} of ${catalog.length} items shown.`}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => saveVisibleHrefs(null)}
          disabled={isDefault}
        >
          <RiRefreshLine />
          Reset to default
        </Button>
      </div>
    </div>
  );
}

function Panel({
  title,
  count,
  items,
  emptyText,
  direction,
  onMove,
  headerAction,
}: {
  title: string;
  count: number;
  items: CatalogItem[];
  emptyText: string;
  direction: "add" | "remove";
  onMove: (href: string) => void;
  headerAction: React.ReactNode;
}) {
  // Group items by their section so the panels mirror the sidebar's structure.
  const groups = useMemo(() => {
    const order: string[] = [];
    const bySection = new Map<string, CatalogItem[]>();
    for (const item of items) {
      if (!bySection.has(item.section)) {
        bySection.set(item.section, []);
        order.push(item.section);
      }
      bySection.get(item.section)!.push(item);
    }
    return order.map((section) => ({ section, items: bySection.get(section)! }));
  }, [items]);

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {count}
          </span>
        </div>
        {headerAction}
      </div>

      <div className="min-h-[18rem] flex-1 space-y-3 overflow-y-auto p-2">
        {items.length === 0 ? (
          <div className="flex h-[16rem] items-center justify-center px-4 text-center text-xs text-muted-foreground/70">
            {emptyText}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.section} className="space-y-0.5">
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                {group.section}
              </div>
              {group.items.map(({ label, href, icon: Icon }) => (
                <button
                  key={href}
                  type="button"
                  onClick={() => onMove(href)}
                  className={cn(
                    "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    "hover:bg-accent"
                  )}
                  title={
                    direction === "add"
                      ? `Add "${label}" to your sidebar`
                      : `Remove "${label}" from your sidebar`
                  }
                >
                  {direction === "remove" && (
                    <RiArrowLeftLine className="size-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
                  )}
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate font-medium">{label}</span>
                  {direction === "add" && (
                    <RiArrowRightLine className="size-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
                  )}
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
