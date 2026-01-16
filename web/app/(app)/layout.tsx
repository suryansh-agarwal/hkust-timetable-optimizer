import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  // 1) must be logged in
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) redirect("/login");

  const email = user.email.toLowerCase();

  // 2) must be allowlisted (RLS ensures user can only see their own row)
  const { data: allowRow } = await supabase
    .from("access_allowlist")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  if (!allowRow) redirect("/request-access");

  return <>{children}</>;
}
