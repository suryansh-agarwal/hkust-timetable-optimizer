import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

function getKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

function isPublicPath(pathname: string) {
  if (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    /\.(svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$/.test(pathname)
  ) return true;

  return (
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth/callback") ||
    pathname.startsWith("/request-access")
  );
}

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = getKey();

  if (!url || !key) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // update request cookies
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));

        // recreate response with updated request
        response = NextResponse.next({ request });

        // set cookies on response
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // DEBUG HEADER (remove later)
  response.headers.set("x-hkust-gate", "middleware-hit");

  const pathname = request.nextUrl.pathname;

  if (isPublicPath(pathname)) return response;

  const { data: { user } } = await supabase.auth.getUser();

  // not logged in
  if (!user?.email) {
    const loginUrl = new URL("/login", request.nextUrl.origin);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // allowlist check
  const email = user.email.toLowerCase();

  const { data: allowRow } = await supabase
    .from("access_allowlist")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  if (!allowRow) {
    return NextResponse.redirect(new URL("/request-access", request.nextUrl.origin));
  }

  response.headers.set("x-hkust-email-domain", email.split("@")[1] ?? "none");
  response.headers.set("x-hkust-allowed", allowRow ? "yes" : "no");


  return response;
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
