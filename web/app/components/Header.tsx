"use client";

import { MessageSquare } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

export function Header({
  email,
  loading,
  optimizeDisabled,
  onShowHelp,
  onOptimize,
}: Readonly<{
  email: string;
  loading: boolean;
  optimizeDisabled: boolean;
  onShowHelp: () => void;
  onOptimize: () => void;
}>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">HKUST Timetable Optimizer</h1>
        <p className="mt-1 text-sm text-muted-foreground">Build a schedule with soft and hard preferences</p>
        <p className="mt-1 text-sm"><span className="font-semibold">Logged in as:</span> {email}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ThemeToggle />
        <a
          href="https://docs.google.com/forms/d/e/1FAIpQLSdUPWeLVqBYbBbZunz-tPnI3mvgGDgKN2onmYPKlZ13OcwNUA/viewform?usp=publish-editor"
          target="_blank"
          rel="noreferrer"
          aria-label="Leave feedback"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 lg:min-h-0")}
        >
          <MessageSquare className="size-4" aria-hidden />
          Feedback
        </a>
        <Button variant="outline" size="sm" className="min-h-11 lg:min-h-0" onClick={onShowHelp}>
          How to use?
        </Button>
        <Button
          size="sm"
          className="min-h-11 lg:min-h-0"
          onClick={onOptimize}
          disabled={optimizeDisabled}
        >
          {loading ? "Optimizing..." : "Optimize"}
        </Button>
      </div>
    </div>
  );
}
