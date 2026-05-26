"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

// React 19 warns when a <script> tag is encountered inside a client component
// because it won't execute it on the client. next-themes injects a script for
// SSR-only theme initialisation (to prevent FOUC) — not executing it on the
// client is correct behaviour. Suppress the specific warning until next-themes
// ships a React 19-compatible release that uses <template> instead.
if (typeof window !== "undefined") {
  const _consoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("Encountered a script tag")) return;
    _consoleError(...args);
  };
}

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
