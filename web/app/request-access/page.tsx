"use client";

import { createClient } from "@/lib/supabase/client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function RequestAccessContent() {
  const supabase = createClient();
  const [email, setEmail] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [hoverPrimary, setHoverPrimary] = useState(false);
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
          maxWidth: 560,
          background: "var(--surface)",
          borderRadius: 16,
          padding: 28,
          boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--border)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: "var(--login-badge)",
            display: "grid",
            placeItems: "center",
            color: "var(--primary-foreground)",
            fontWeight: 800,
            fontSize: 22,
            margin: "0 auto",
          }}
          aria-hidden
        >
          ✓
        </div>
        <h1 style={{ margin: "16px 0 6px", fontSize: 26, fontWeight: 800 }}>Access pending</h1>
        <div style={{ color: "var(--text-muted)", fontSize: 14 }}>
          You’re signed in, but not on the early-access list yet.
        </div>

        <div
          style={{
            marginTop: 18,
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 14,
            background: "var(--surface-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ fontWeight: 700, color: "var(--text-strong)", fontSize: 14 }}>
            {email || "your email"}
          </div>
          <button
            type="button"
            onClick={copyEmail}
            onMouseEnter={() => setHoverPrimary(true)}
            onMouseLeave={() => setHoverPrimary(false)}
            disabled={!email}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid var(--primary)",
              background: hoverPrimary ? "var(--primary)" : "var(--surface)",
              color: hoverPrimary ? "var(--primary-foreground)" : "var(--primary)",
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
              transition: "transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease, color 0.15s ease",
              transform: hoverPrimary ? "translateY(-1px)" : "translateY(0)",
              boxShadow: hoverPrimary ? "var(--shadow-md)" : "none",
              opacity: email ? 1 : 0.5,
            }}
          >
            {copied ? "Copied" : "Copy email"}
          </button>
        </div>

        <div style={{ marginTop: 18, fontSize: 14, color: "var(--text-body)" }}>
          Send this email to the admin to request access.
        </div>
        <div style={{ marginTop: 6, fontSize: 13, color: "var(--text-muted)" }}>
          You’ll be approved quickly once verified.
        </div>

        <div style={{ marginTop: 18, fontSize: 13, color: "var(--text-muted)" }}>
          Need to switch accounts?{" "}
          <a href="/login" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
            Back to login
          </a>
        </div>
      </div>
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
