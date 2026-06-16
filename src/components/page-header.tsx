import { SidebarTrigger } from "@/components/ui/sidebar";
import { WhatsNewBell } from "@/components/whats-new/whats-new-bell";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  /** Left-aligned content — typically a <Breadcrumb>. */
  children?: React.ReactNode;
  /** Right-aligned, page-specific actions, rendered just before the bell. */
  actions?: React.ReactNode;
  /** Extra classes for the <header> (e.g. background variants). */
  className?: string;
};

/**
 * The shared top bar rendered on every (app) page: sidebar toggle, the page's
 * breadcrumb, optional page actions, and the global "What's New" bell. Having
 * one component means the bell lives in exactly one place across the app.
 */
export function PageHeader({ children, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800",
        className
      )}
    >
      <SidebarTrigger />
      {children}
      <div className="ml-auto flex items-center gap-2">
        {actions}
        <WhatsNewBell />
      </div>
    </header>
  );
}
