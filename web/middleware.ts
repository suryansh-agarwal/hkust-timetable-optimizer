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

function withDebugHeaders(
  res: NextResponse,
  info: { decision: string; hasUser: boolean; allowed: boolean; domain: string }
) {
  res.headers.set("x-hkust-gate", "middleware-hit");
  res.headers.set("x-hkust-decision", info.decision);
  res.headers.set("x-hkust-has-user", info.hasUser ? "yes" : "no");
  res.headers.set("x-hkust-allowed", info.allowed ? "yes" : "no");
  // domain only, no PII
  res.headers.set("x-hkust-domain", info.domain || "none");
  return res;
}

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = getKey();

  // If env missing, don't brick the site (but this should not happen on Vercel)
  if (!url || !key) return NextResponse.next();

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

  const pathname = request.nextUrl.pathname;

  // Don't gate public routes
  if (isPublicPath(pathname)) {
    return withDebugHeaders(response, {
      decision: "public",
      hasUser: false,
      allowed: false,
      domain: "",
    });
  }

  // Get user (validates session)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const domain = user?.email?.split("@")[1] ?? "";

  if (!user?.email) {
    const loginUrl = new URL("/login", request.nextUrl.origin);
    loginUrl.searchParams.set("next", pathname);
    const res = NextResponse.redirect(loginUrl);
    return withDebugHeaders(res, {
      decision: "redirect-login",
      hasUser: false,
      allowed: false,
      domain: "",
    });
  }

  const email = user.email.toLowerCase();

  // STRICT allowlist check (avoid maybeSingle edge cases)
  const { data, error } = await supabase
    .from("access_allowlist")
    .select("email")
    .eq("email", email)
    .limit(1);

  const allowed = !error && Array.isArray(data) && data.length === 1;

  if (!allowed) {
    const res = NextResponse.redirect(new URL("/request-access", request.nextUrl.origin));
    return withDebugHeaders(res, {
      decision: "redirect-request-access",
      hasUser: true,
      allowed: false,
      domain,
    });
  }

  return withDebugHeaders(response, {
    decision: "allowed",
    hasUser: true,
    allowed: true,
    domain,
  });
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
