"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

function LoginContent() {
  const supabase = createClient();
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => searchParams.get("next") ?? "/", [searchParams]);

  async function continueWithGoogle() {
    setErr(null);
    setNotice(null);
    setLoadingGoogle(true);

    const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;

    await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
            redirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(nextPath)}`,
            queryParams: { prompt: "select_account" },
        },
    });
  }

  async function continueWithEmail(event: React.FormEvent) {
    event.preventDefault();
    setErr(null);
    setNotice(null);

    const email = emailInput.trim().toLowerCase();
    if (!email) {
      setErr("Enter a valid email address.");
      return;
    }

    setLoadingEmail(true);

    try {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;

      // signInWithOtp resolves with an error rather than throwing, so without
      // this check a rejected request - rate limit, blocked address, provider
      // outage - still told the student their link was on its way.
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        },
      });

      if (error) {
        setErr(error.message);
        return;
      }

      setNotice("Magic link sent. Check your email to continue.");
    } catch {
      setErr("Could not send the magic link. Try again in a moment.");
    } finally {
      setLoadingEmail(false);
    }
  }



  return (
    <main className="grid min-h-screen place-items-center p-6 [background:var(--login-canvas)]">
      <Card className="w-full max-w-lg p-5">
        <div className="flex items-center gap-4">
          <div
            className="flex size-11 items-center justify-center rounded-xl bg-[var(--login-badge)] text-primary-foreground"
            aria-hidden
          >
            <img
              src="/login/calendar-icon.png"
              alt="Calendar icon"
              className="block size-6"
            />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in to build your best timetable
            </p>
          </div>
        </div>

        <div className="grid gap-4">
          <Button
            onClick={continueWithGoogle}
            disabled={loadingGoogle}
            className="h-11 w-full"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="currentColor"
                d="M21.35 11.1h-9.17v2.96h5.3c-.23 1.5-1.78 4.4-5.3 4.4-3.19 0-5.8-2.64-5.8-5.9 0-3.26 2.61-5.9 5.8-5.9 1.82 0 3.04.78 3.74 1.45l2.55-2.46C16.91 4.2 14.83 3.2 12.18 3.2c-4.91 0-8.9 3.99-8.9 8.9 0 4.91 3.99 8.9 8.9 8.9 5.14 0 8.55-3.62 8.55-8.71 0-.59-.06-1.03-.14-1.49Z"
              />
            </svg>
            {loadingGoogle ? "Redirecting..." : "Continue with Google"}
          </Button>
          <div className="flex items-center gap-2" aria-hidden>
            <Separator className="flex-1" />
            <span className="text-xs font-semibold text-muted-foreground">--- Or ---</span>
            <Separator className="flex-1" />
          </div>
          <form onSubmit={continueWithEmail} className="grid gap-2">
            <Input
              type="email"
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              placeholder="Email address"
              aria-label="Email address"
              required
              className="h-11 w-full"
            />
            <Button
              type="submit"
              variant="outline"
              disabled={loadingEmail}
              className="h-11 w-full"
            >
              {loadingEmail ? "Sending..." : "Continue with email"}
            </Button>
          </form>
          {err && (
            <div className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]">
              Error: {err}
            </div>
          )}
          {notice && (
            <div className="rounded-xl border border-[var(--success-border)] bg-[var(--success-bg)] p-3 text-sm text-[var(--pin-text)]">
              {notice}
            </div>
          )}
        </div>

      </Card>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
