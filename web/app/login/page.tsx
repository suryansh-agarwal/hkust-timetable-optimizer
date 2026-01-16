"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadingGoogle, setLoadingGoogle] = useState(false);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSent(false);

    const origin = window.location.origin;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=/`,
      },
    });

    if (error) setErr(error.message);
    else setSent(true);
  }

  async function continueWithGoogle() {
    setErr(null);
    setLoadingGoogle(true);

    const origin = window.location.origin;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback?next=/`,
      },
    });

    // Usually Supabase redirects away immediately; error only if blocked/misconfigured
    if (error) {
      setErr(error.message);
      setLoadingGoogle(false);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 420 }}>
      <h1>Login</h1>

      <button
        onClick={continueWithGoogle}
        disabled={loadingGoogle}
        style={{ padding: 10, width: "100%", marginTop: 12 }}
      >
        {loadingGoogle ? "Redirecting..." : "Continue with Google"}
      </button>

      <hr style={{ margin: "20px 0" }} />

      <p>Or sign in with an email link:</p>
      <form onSubmit={sendMagicLink} style={{ display: "grid", gap: 12 }}>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@connect.ust.hk"
          type="email"
          required
          style={{ padding: 10 }}
        />
        <button type="submit" style={{ padding: 10 }}>
          Send magic link
        </button>
      </form>

      {sent && <p style={{ marginTop: 12 }}>Check your email for the sign-in link.</p>}
      {err && <p style={{ marginTop: 12 }}>Error: {err}</p>}
    </main>
  );
}
