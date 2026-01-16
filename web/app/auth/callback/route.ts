import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

function getKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  // Create redirect response FIRST (we'll attach cookies onto it)
  const redirectUrl = new URL(next, url.origin);
  let response = NextResponse.redirect(redirectUrl);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    getKey(),
    {
      cookies: {
        // read cookies from the incoming request
        getAll() {
          return request.cookies.getAll();
        },
        // write cookies onto the outgoing redirect response
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  // If exchange fails, send them back to login (optional: include error)
  if (error) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  return response;
}
