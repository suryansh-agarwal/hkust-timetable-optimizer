"use client";

import { createClient } from "@/lib/supabase/client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

function RequestAccessContent() {
  const supabase = createClient();
  const [email, setEmail] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const searchParams = useSearchParams();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const sessionEmail = data.user?.email ?? "";
      if (sessionEmail) {
        setEmail(sessionEmail);
        return;
      }

      const queryEmail = searchParams.get("email") ?? "";
      if (queryEmail) setEmail(queryEmail);
    });
  }, [supabase, searchParams]);

  async function copyEmail() {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-6 [background:var(--login-canvas)]">
      <Card className="w-full max-w-xl p-5 text-center">
        <div
          className="mx-auto flex size-14 items-center justify-center rounded-xl bg-[var(--login-badge)] text-2xl font-semibold text-primary-foreground"
          aria-hidden
        >
          ✓
        </div>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Access pending</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You’re signed in, but not on the early-access list yet.
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted p-3">
          <div className="text-sm font-semibold text-foreground">
            {email || "your email"}
          </div>
          <Button
            type="button"
            variant="default"
            onClick={copyEmail}
            disabled={!email}
          >
            {copied ? "Copied" : "Copy email"}
          </Button>
        </div>

        <div>
          <p className="text-sm text-foreground">
            Send this email to the admin to request access.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            You’ll be approved quickly once verified.
          </p>
        </div>

        <p className="text-sm text-muted-foreground">
          Need to switch accounts?{" "}
          <a href="/login" className="font-semibold text-primary no-underline">
            Back to login
          </a>
        </p>
      </Card>
    </main>
  );
}

export default function RequestAccessPage() {
  return (
    <Suspense fallback={null}>
      <RequestAccessContent />
    </Suspense>
  );
}
