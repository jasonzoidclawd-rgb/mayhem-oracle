import { NextResponse } from "next/server";
import { canonicalRedirect, safeNextPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const next = safeNextPath(searchParams.get("next"));

  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    try {
      const supabase = await createClient();
      await supabase.auth.signOut();
    } catch {
      // Still return the user to a safe public page if session clearing fails.
    }
  }

  return NextResponse.redirect(canonicalRedirect(next), { status: 303 });
}
