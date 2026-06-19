import { NextResponse } from "next/server";
import {
  PUBLIC_RESOURCES,
  ATTRIBUTION,
  CORS_HEADERS,
  CACHE_HEADERS,
} from "@/lib/api/public-catalog";
import { SITE_URL } from "@/lib/site";

/**
 * Self-documenting index for the public Data API. Lists every endpoint so
 * third-party developers can discover the surface without separate docs.
 */
export async function GET(): Promise<Response> {
  const endpoints = Object.fromEntries(
    Object.keys(PUBLIC_RESOURCES).map((resource) => [
      resource,
      `${SITE_URL}/api/v1/${resource}`,
    ]),
  );

  return NextResponse.json(
    {
      ...ATTRIBUTION,
      version: "v1",
      description:
        "Free, CORS-enabled, read-only JSON for League of Legends ARAM Mayhem: " +
        "champion tiers, augments, an S-tier combo teaser, items, and patch notes. " +
        "Member-only telemetry (win-rates, oracle scores, full combo set) is not exposed.",
      endpoints,
      attributionExample: `Data by Mayhem Oracle (${SITE_URL})`,
    },
    { headers: { ...CORS_HEADERS, ...CACHE_HEADERS } },
  );
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
