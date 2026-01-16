import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr) redirect("/login");
  if (!user?.email) redirect("/login");

  const email = user.email.toLowerCase();

  // CRITICAL: must filter by THIS email
  const { data: allowRow, error: allowErr } = await supabase
    .from("access_allowlist")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  // If no row matches, they are NOT allowed
  if (allowErr || !allowRow) redirect("/request-access");

  return <>{children}</>;
}
