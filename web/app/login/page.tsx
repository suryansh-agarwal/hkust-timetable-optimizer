"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = createClient();
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hoverPrimary, setHoverPrimary] = useState(false);

  async function continueWithGoogle() {
    setLoadingGoogle(true);

    const origin = globalThis.location.origin;

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
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "linear-gradient(135deg, #f7f9fc 0%, #eef2f8 100%)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: "white",
          borderRadius: 16,
          padding: 28,
          boxShadow: "0 20px 40px rgba(15, 23, 42, 0.12)",
          border: "1px solid #e5e7eb",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "#0f172a",
              display: "grid",
              placeItems: "center",
              color: "white",
              fontWeight: 800,
              fontSize: 18,
            }}
            aria-hidden
          >
            T
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>Welcome back</h1>
            <div style={{ color: "#6b7280", marginTop: 4, fontSize: 14 }}>
              Sign in to build your best timetable
            </div>
          </div>
        </div>

        <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
          <button
            onClick={continueWithGoogle}
            disabled={loadingGoogle}
            onMouseEnter={() => setHoverPrimary(true)}
            onMouseLeave={() => setHoverPrimary(false)}
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: hoverPrimary ? "#111827" : "#0f172a",
              color: "white",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              transition: "transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease",
              transform: hoverPrimary ? "translateY(-1px)" : "translateY(0)",
              boxShadow: hoverPrimary ? "0 10px 20px rgba(15, 23, 42, 0.2)" : "none",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="currentColor"
                d="M21.35 11.1h-9.17v2.96h5.3c-.23 1.5-1.78 4.4-5.3 4.4-3.19 0-5.8-2.64-5.8-5.9 0-3.26 2.61-5.9 5.8-5.9 1.82 0 3.04.78 3.74 1.45l2.55-2.46C16.91 4.2 14.83 3.2 12.18 3.2c-4.91 0-8.9 3.99-8.9 8.9 0 4.91 3.99 8.9 8.9 8.9 5.14 0 8.55-3.62 8.55-8.71 0-.59-.06-1.03-.14-1.49Z"
              />
            </svg>
            {loadingGoogle ? "Redirecting..." : "Continue with Google"}
          </button>
          {err && <div style={{ marginTop: 6, color: "#b91c1c", fontWeight: 600 }}>Error: {err}</div>}
        </div>

      </div>
    </main>
  );
}
