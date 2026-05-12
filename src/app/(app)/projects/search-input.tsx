"use client";

import { Input } from "@/components/ui/input";
import { RiSearchLine } from "@remixicon/react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition, useState, useEffect } from "react";

export function SearchInput() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentQuery = searchParams.get("q") || "";
  const [value, setValue] = useState(currentQuery);

  useEffect(() => {
    setValue(currentQuery);
  }, [currentQuery]);

  const handleSearch = (term: string) => {
    setValue(term);
    
    startTransition(() => {
      const params = new URLSearchParams(searchParams);
      if (term) {
        params.set("q", term);
      } else {
        params.delete("q");
      }
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <div className="relative max-w-[300px] w-full">
      <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
      <Input
        placeholder="Search projects..."
        className="pl-9 bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800"
        value={value}
        onChange={(e) => handleSearch(e.target.value)}
      />
      {isPending && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent" />
      )}
    </div>
  );
}
