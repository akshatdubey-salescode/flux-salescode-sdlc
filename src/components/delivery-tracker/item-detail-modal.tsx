"use client";

// "Full detail" here means every column the items table has, all in one
// place — not a Jira description/status-timeline deep dive. Everything
// shown is already on the row (DeliveryItemRow), so no fetch at all.
import { BugModal } from "@/components/bugs/bug-modal";
import { Badge } from "@/components/ui/badge";
import { deliveryStatusStyles, deliveryStatusLabel } from "@/lib/deliveries/status";
import { cn } from "@/lib/utils";
import type { DeliveryItemRow } from "@/lib/deliveries/entries";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-medium uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="text-sm text-zinc-700 dark:text-zinc-300">{children}</div>
    </div>
  );
}

export function ItemDetailModal({
  item,
  open,
  onOpenChange,
}: {
  item: DeliveryItemRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const statusStyles = deliveryStatusStyles(item.status);

  return (
    <BugModal open={open} onOpenChange={onOpenChange} title={item.jiraKey}>
      <div className="grid grid-cols-2 gap-4 py-4">
        <Field label="Summary">{item.summary}</Field>
        <Field label="Jira status">
          <Badge variant="outline">{item.jiraStatus}</Badge>
        </Field>
        <Field label="Priority">{item.priority ?? "—"}</Field>
        <Field label="Assignee">{item.assigneeName ?? "—"}</Field>
        <Field label="Delivery status">
          <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold", statusStyles.badge)}>
            {deliveryStatusLabel(item.status)}
          </span>
        </Field>
        <Field label="Comment">
          {item.statusComment ? (
            <span className="whitespace-pre-wrap">{item.statusComment}</span>
          ) : (
            "—"
          )}
        </Field>
        <Field label="Start date">{formatDate(item.startDate)}</Field>
        <Field label="End date">{formatDate(item.dueDate)}</Field>
        <Field label="Added by">
          {item.addedByName ?? "—"}
          {item.addedAt ? ` · ${formatDateTime(item.addedAt)}` : ""}
        </Field>
        <Field label="Status set by">
          {item.statusSetByName ?? "—"}
          {item.statusSetAt ? ` · ${formatDateTime(item.statusSetAt)}` : ""}
        </Field>
      </div>
    </BugModal>
  );
}
