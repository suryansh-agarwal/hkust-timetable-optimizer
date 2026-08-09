"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const OPTIONS = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The server cannot know the resolved theme, so rendering the active state
  // before mount would produce a hydration mismatch. Render the frame at the
  // right size and fill it in after.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- documented mount-detection exception; this is the only way to know the client has hydrated.
  useEffect(() => setMounted(true), []);

  return (
    <div
      role="group"
      aria-label="Colour theme"
      className="inline-flex overflow-hidden rounded-lg border border-border bg-card"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = mounted && theme === value;
        return (
          <Button
            key={value}
            type="button"
            variant={active ? "default" : "ghost"}
            size="sm"
            onClick={() => setTheme(value)}
            aria-pressed={active}
            title={label}
            className="rounded-none"
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </Button>
        );
      })}
    </div>
  );
}
