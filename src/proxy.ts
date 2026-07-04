import { createServerClient } from "@supabase/ssr";
import createIntlMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";
import { SITE_URL } from "./lib/site";

const intlMiddleware = createIntlMiddleware(routing);
const canonicalSite = new URL(SITE_URL);
const AUTH_CALLBACK_PATH = "/auth/callback";

function canonicalEntryRedirectUrl(request: NextRequest): URL | null {
  const url = request.nextUrl.clone();
  let changed = false;

  if (url.hostname === `www.${canonicalSite.hostname}`) {
    url.protocol = canonicalSite.protocol;
    url.hostname = canonicalSite.hostname;
    url.port = canonicalSite.port;
    changed = true;
  }

  if (url.pathname === "/" && url.searchParams.has("code")) {
    url.protocol = canonicalSite.protocol;
    url.hostname = canonicalSite.hostname;
    url.port = canonicalSite.port;
    url.pathname = "/auth/callback";
    changed = true;
  }

  return changed ? url : null;
}

export default async function proxy(request: NextRequest) {
  const canonicalRedirect = canonicalEntryRedirectUrl(request);
  if (canonicalRedirect) {
    return NextResponse.redirect(canonicalRedirect);
  }

  // Run intl middleware first to get locale cookies / redirects.
  const intlResponse = request.nextUrl.pathname === AUTH_CALLBACK_PATH
    ? undefined
    : intlMiddleware(request);
  const response = intlResponse ?? NextResponse.next({ request });

  // Refresh session so server components can read the current user.
  // Skip when Supabase env vars are not yet configured (dev without .env.local).
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
          },
        },
      },
    );
    await supabase.auth.getUser();
  }

  return response;
}

export const config = {
  matcher: [
    "/patch-notes/:path*",
    "/((?!api|_next|_vercel|.*\\..*|manifest\\.json|sw\\.js).*)",
  ],
};
