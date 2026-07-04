import { createClient } from "@/lib/supabase/server";
import {
  authCallbackUrl,
  canonicalRedirectWithError,
  safeNextPath,
} from "@/lib/auth/redirects";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const next = safeNextPath(searchParams.get("next"));

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 503 });
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: authCallbackUrl(),
      },
    });

    if (error || !data.url) {
      return NextResponse.redirect(canonicalRedirectWithError(next, "auth_signin"));
    }

    return NextResponse.redirect(data.url);
  } catch {
    return NextResponse.redirect(canonicalRedirectWithError(next, "auth_signin"));
  }
}
