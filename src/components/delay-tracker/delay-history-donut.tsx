"use client";

import { useMemo } from "react";
import { categoryLabel } from "./categories";
import { CategoryDonut } from "./category-donut";

type Props = { history: { category: string }[] };

/**
 * Small donut of this issue's delay entries by category — derived client-side
 * from the already-fetched history, no extra API call. Shows even a single
 * entry as a full ring (still communicates "this delay was type X"); only
 * hidden with zero entries, since there's nothing to chart.
 */
export function DelayHistoryDonut({ history }: Props) {
  const slices = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of history) counts.set(h.category, (counts.get(h.category) ?? 0) + 1);
    return [...counts.entries()].map(([category, value]) => ({
      category,
      label: categoryLabel(category),
      value,
    }));
  }, [history]);

  return <CategoryDonut slices={slices} />;
}
