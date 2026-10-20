import Link from "next/link";
import { RiArrowLeftLine } from "@remixicon/react";

/** The way back from a TC page: to where the user came from, else a sensible default. */
export function BackLink({ href, label = "Back" }: { href: string; label?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
      <RiArrowLeftLine className="size-3.5" />
      {label}
    </Link>
  );
}
