"use client";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";

export default function RequestAccessPage() {
  const supabase = createClient();
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? "");
    });
  }, [supabase]);

  return (
    <main style={{ padding: 24, maxWidth: 520 }}>
      <h1>Access pending</h1>
      <p>
        You’re signed in as <b>{email || "your email"}</b>, but you’re not on the early-access list yet.
      </p>
      <p>DM me this email and I’ll approve you.</p>
    </main>
  );
}
