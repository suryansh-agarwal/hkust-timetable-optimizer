"use client";

import { MessageSquare } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

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
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>HKUST Timetable Optimizer</h1>
        <div style={{ marginTop: 4, fontSize: 13, color: "var(--text-muted)" }}>
          Build a schedule with soft and hard preferences
        </div>
        <div><b>Logged in as:</b> {email}</div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ThemeToggle />
        <a
          href="https://docs.google.com/forms/d/e/1FAIpQLSdUPWeLVqBYbBbZunz-tPnI3mvgGDgKN2onmYPKlZ13OcwNUA/viewform?usp=publish-editor"
          target="_blank"
          rel="noreferrer"
          aria-label="Leave feedback"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <MessageSquare className="size-4" aria-hidden />
          Feedback
        </a>
        <Button variant="outline" size="sm" onClick={onShowHelp}>
          How to use?
        </Button>
        <Button
          size="sm"
          onClick={onOptimize}
          disabled={optimizeDisabled}
        >
          {loading ? "Optimizing..." : "Optimize"}
        </Button>
      </div>
    </div>
  );
}
