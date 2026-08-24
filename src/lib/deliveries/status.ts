/** Values persisted by the delivery_status database enum. */
export const DELIVERY_STATUS_VALUES = [
  "pending",
  "delivered",
  "partially_delivered",
  "not_delivered",
] as const;

export type DeliveryStatusValue = (typeof DELIVERY_STATUS_VALUES)[number];

const DELIVERY_STATUS_LABELS = {
  pending: "Pending",
  delivered: "Delivered",
  partially_delivered: "Partially Delivered",
  not_delivered: "Not Delivered",
} satisfies Record<DeliveryStatusValue, string>;

/** Labels for the fixed set of delivery outcomes. */
export const DELIVERY_STATUSES = DELIVERY_STATUS_VALUES.map((value) => ({
  value,
  label: DELIVERY_STATUS_LABELS[value],
}));

const DELIVERY_STATUS_VALUE_SET = new Set<string>(DELIVERY_STATUS_VALUES);

/** The single check every delivery route uses to reject an unknown status value from a request body. */
export function isDeliveryStatus(value: unknown): value is DeliveryStatusValue {
  return typeof value === "string" && DELIVERY_STATUS_VALUE_SET.has(value);
}

export function deliveryStatusLabel(value: string): string {
  return Object.prototype.hasOwnProperty.call(DELIVERY_STATUS_LABELS, value)
    ? DELIVERY_STATUS_LABELS[value as DeliveryStatusValue]
    : value;
}

/**
 * Single source of truth for delivery-status color — the badge, the tab's
 * table, and the item panel all import this instead of hardcoding a class
 * name, so "delivered is always green" holds everywhere by construction.
 */
const DELIVERY_STATUS_STYLES = {
  pending: {
    badge: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
    dot: "bg-zinc-400",
  },
  delivered: {
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  partially_delivered: {
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  not_delivered: {
    badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    dot: "bg-red-500",
  },
} satisfies Record<DeliveryStatusValue, { badge: string; dot: string }>;

// Same amber the app already uses for "at risk"/overdue-while-pending
// (nearestDeliveryColorClass below) and for partially_delivered — "delivered,
// but late" reads as a caution, not the hard failure not_delivered's red is.
const DELIVERED_LATE_STYLE = {
  badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  dot: "bg-amber-500",
};

export function deliveryStatusStyles(value: string, isLate = false): { badge: string; dot: string } {
  if (value === "delivered" && isLate) return DELIVERED_LATE_STYLE;
  return Object.prototype.hasOwnProperty.call(DELIVERY_STATUS_STYLES, value)
    ? DELIVERY_STATUS_STYLES[value as DeliveryStatusValue]
    : DELIVERY_STATUS_STYLES.pending;
}

/**
 * True when an item was marked "delivered" only after its delivery's target
 * date had already passed — i.e. delivered, but late. `statusSetAt` is the
 * timestamp the outcome was actually recorded; comparing it to `deliveryDate`
 * (not today's date) is what distinguishes "was late when delivered" from
 * "is currently overdue," which only makes sense for a still-pending item.
 */
export function isDeliveredLate(
  status: string,
  deliveryDate: string,
  statusSetAt: string | null | undefined
): boolean {
  if (status !== "delivered" || !statusSetAt) return false;
  return statusSetAt.slice(0, 10) > deliveryDate;
}

/**
 * Text color for a single "nearest delivery" date/status pair — used
 * anywhere a delivery is shown as plain colored text rather than a filled
 * badge (the cross-surface icon, the Delivery table column). Same source of
 * truth as deliveryStatusStyles, just resolved to a text-only class and
 * aware of overdue-while-pending, which deliveryStatusStyles alone can't
 * express since overdue isn't part of the status enum.
 */
export function nearestDeliveryColorClass(value: string, isOverdue: boolean): string {
  if (value === "delivered") return "text-emerald-600 dark:text-emerald-400";
  if (value === "partially_delivered") return "text-amber-600 dark:text-amber-400";
  if (value === "not_delivered") return "text-red-600 dark:text-red-400";
  // Pending + not yet due is routine, not a status outcome — use the app's
  // own brand teal (same hue as the Flux logo/primary token) instead of a
  // generic blue, so it reads as native chrome rather than a random alert.
  return isOverdue ? "text-amber-600 dark:text-amber-400" : "text-primary";
}
