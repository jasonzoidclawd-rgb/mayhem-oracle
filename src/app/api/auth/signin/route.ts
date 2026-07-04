import { canonicalRedirectWithError, safeNextPath } from "@/lib/auth/redirects";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const next = safeNextPath(searchParams.get("next"));

  return NextResponse.redirect(canonicalRedirectWithError(next, "google_identity_required"));
}
