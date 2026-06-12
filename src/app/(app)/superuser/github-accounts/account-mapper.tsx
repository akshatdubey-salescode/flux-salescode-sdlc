"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RiCheckLine, RiUserAddLine } from "@remixicon/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { assignGithubAccount } from "./actions";

export type UnmappedAccount = {
  login: string;
  name: string | null;
  avatar: string | null;
  net: number;
  commits: number;
};

export type UserOption = { id: string; email: string };

export function AccountMapper({
  accounts,
  users,
}: {
  accounts: UnmappedAccount[];
  users: UserOption[];
}) {
  if (accounts.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        <RiCheckLine className="size-4 text-emerald-500" />
        Every non-bot GitHub account is mapped to a person.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
      {accounts.map((account) => (
        <AccountRow key={account.login} account={account} users={users} />
      ))}
    </div>
  );
}

function AccountRow({
  account,
  users,
}: {
  account: UnmappedAccount;
  users: UserOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function assign(userId: string) {
    setOpen(false);
    startTransition(async () => {
      await assignGithubAccount(account.login, userId);
      router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-5 py-3",
        isPending && "opacity-50"
      )}
    >
      <Avatar className="size-8 shrink-0">
        {account.avatar && <AvatarImage src={account.avatar} alt={account.login} />}
        <AvatarFallback>{account.login.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {account.name ?? account.login}
        </span>
        <span className="block truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
          @{account.login}
        </span>
      </div>

      <div className="shrink-0 text-right text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
        <span className={account.net < 0 ? "text-red-500" : ""}>
          {account.net.toLocaleString()} net
        </span>
        <span className="block">{account.commits.toLocaleString()} commits</span>
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 shrink-0" disabled={isPending}>
            <RiUserAddLine className="size-4" />
            Map to…
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-0">
          <Command>
            <CommandInput placeholder="Search people…" />
            <CommandList>
              <CommandEmpty>No matching user.</CommandEmpty>
              <CommandGroup>
                {users.map((u) => (
                  <CommandItem key={u.id} value={u.email} onSelect={() => assign(u.id)}>
                    {u.email}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
