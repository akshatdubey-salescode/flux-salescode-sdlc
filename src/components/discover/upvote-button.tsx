"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { RiArrowUpLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { toggleUpvote } from "@/app/(app)/discover/actions";
import { cn } from "@/lib/utils";

export function UpvoteButton({
  showcaseId,
  upvoted,
  count,
  disabled,
}: {
  showcaseId: string;
  upvoted: boolean;
  count: number;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setOptimistic] = useOptimistic({ upvoted, count });

  function toggle() {
    startTransition(async () => {
      setOptimistic({ upvoted: !state.upvoted, count: state.count + (state.upvoted ? -1 : 1) });
      const res = await toggleUpvote(showcaseId);
      if (res.error) toast.error(res.error);
    });
  }

  return (
    <Button
      type="button"
      variant={state.upvoted ? "default" : "outline"}
      size="lg"
      onClick={toggle}
      disabled={disabled || pending}
      aria-pressed={state.upvoted}
      title={disabled ? "Publish to collect upvotes" : state.upvoted ? "Remove upvote" : "Upvote"}
      className={cn("gap-1.5")}
    >
      <RiArrowUpLine />
      {state.upvoted ? "Upvoted" : "Upvote"} · {state.count}
    </Button>
  );
}
