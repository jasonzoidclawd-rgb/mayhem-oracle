import { createClient } from "@/lib/supabase/server";
import {
  canonicalRedirect,
  canonicalRedirectWithError,
  safeNextPath,
} from "@/lib/auth/redirects";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.redirect(canonicalRedirect(next));
  }

  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(canonicalRedirect(next));
      }
    } catch {
      // fall through to error redirect
    }
  }

  return NextResponse.redirect(canonicalRedirectWithError(next, "auth_callback"));
}
