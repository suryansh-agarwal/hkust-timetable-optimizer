"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function RequestAccessPage() {
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
        background: "linear-gradient(135deg, #f7f9fc 0%, #eef2f8 100%)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          background: "white",
          borderRadius: 16,
          padding: 28,
          boxShadow: "0 20px 40px rgba(15, 23, 42, 0.12)",
          border: "1px solid #e5e7eb",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: "#0f172a",
            display: "grid",
            placeItems: "center",
            color: "white",
            fontWeight: 800,
            fontSize: 22,
            margin: "0 auto",
          }}
          aria-hidden
        >
          ✓
        </div>
        <h1 style={{ margin: "16px 0 6px", fontSize: 26, fontWeight: 800 }}>Access pending</h1>
        <div style={{ color: "#6b7280", fontSize: 14 }}>
          You’re signed in, but not on the early-access list yet.
        </div>

        <div
          style={{
            marginTop: 18,
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 14,
            background: "#f9fafb",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ fontWeight: 700, color: "#111827", fontSize: 14 }}>
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
              border: "1px solid #0f172a",
              background: hoverPrimary ? "#0f172a" : "white",
              color: hoverPrimary ? "white" : "#0f172a",
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
              transition: "transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease, color 0.15s ease",
              transform: hoverPrimary ? "translateY(-1px)" : "translateY(0)",
              boxShadow: hoverPrimary ? "0 8px 16px rgba(15, 23, 42, 0.12)" : "none",
              opacity: email ? 1 : 0.5,
            }}
          >
            {copied ? "Copied" : "Copy email"}
          </button>
        </div>

        <div style={{ marginTop: 18, fontSize: 14, color: "#374151" }}>
          Send this email to the admin to request access.
        </div>
        <div style={{ marginTop: 6, fontSize: 13, color: "#6b7280" }}>
          You’ll be approved quickly once verified.
        </div>

        <div style={{ marginTop: 18, fontSize: 13, color: "#6b7280" }}>
          Need to switch accounts?{" "}
          <a href="/login" style={{ color: "#0f172a", fontWeight: 700, textDecoration: "none" }}>
            Back to login
          </a>
        </div>
      </div>
    </main>
  );
}
