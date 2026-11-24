"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

const subscribe = () => () => {};

// Switches between light and dark. Until the viewer picks one, the theme follows their system setting.
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // The stored theme is only known in the browser, so render a placeholder on the server.
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  if (!mounted) return <span aria-hidden className="inline-block size-8" />;

  const dark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="text-muted-foreground hover:text-foreground"
    >
      {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}
