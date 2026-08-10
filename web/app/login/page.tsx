"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

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
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "var(--login-canvas)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: "var(--surface)",
          borderRadius: 16,
          padding: 28,
          boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "var(--login-badge)",
              display: "grid",
              placeItems: "center",
              color: "var(--primary-foreground)",
              fontWeight: 800,
              fontSize: 18,
            }}
            aria-hidden
          >
            <img
              src="/login/calendar-icon.png"
              alt="Calendar icon"
              style={{ width: 24, height: 24, display: "block" }}
            />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>Welcome back</h1>
            <div style={{ color: "var(--text-muted)", marginTop: 4, fontSize: 14 }}>
              Sign in to build your best timetable
            </div>
          </div>
        </div>

        <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
          <Button
            onClick={continueWithGoogle}
            disabled={loadingGoogle}
            className="w-full"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="currentColor"
                d="M21.35 11.1h-9.17v2.96h5.3c-.23 1.5-1.78 4.4-5.3 4.4-3.19 0-5.8-2.64-5.8-5.9 0-3.26 2.61-5.9 5.8-5.9 1.82 0 3.04.78 3.74 1.45l2.55-2.46C16.91 4.2 14.83 3.2 12.18 3.2c-4.91 0-8.9 3.99-8.9 8.9 0 4.91 3.99 8.9 8.9 8.9 5.14 0 8.55-3.62 8.55-8.71 0-.59-.06-1.03-.14-1.49Z"
              />
            </svg>
            {loadingGoogle ? "Redirecting..." : "Continue with Google"}
          </Button>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              color: "var(--text-muted)",
              fontSize: 12,
              fontWeight: 700,
            }}
            aria-hidden
          >
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            <span>--- Or ---</span>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>
          <form onSubmit={continueWithEmail} style={{ display: "grid", gap: 10 }}>
            <input
              type="email"
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              placeholder="Email address"
              required
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid var(--border)",
                fontSize: 14,
                fontWeight: 500,
                outline: "none",
              }}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={loadingEmail}
              className="w-full"
            >
              {loadingEmail ? "Sending..." : "Continue with email"}
            </Button>
          </form>
          {err && <div style={{ marginTop: 6, color: "var(--danger)", fontWeight: 600 }}>Error: {err}</div>}
          {notice && <div style={{ marginTop: 6, color: "var(--pin-text)", fontWeight: 600 }}>{notice}</div>}
        </div>

      </div>
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
