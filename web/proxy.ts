import { type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// Start broad; tighten later
export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
