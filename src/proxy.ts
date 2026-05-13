import { createServerClient } from "@supabase/ssr";
import createIntlMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

export default async function proxy(request: NextRequest) {
  // Run intl middleware first to get locale cookies / redirects.
  const intlResponse = intlMiddleware(request);
  const response = intlResponse ?? NextResponse.next({ request });

  // Attach Supabase session-refresh cookies on top.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  // Refresh session so server components can read the current user.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next|_vercel|.*\\..*|manifest\\.json|sw\\.js).*)",
  ],
};
