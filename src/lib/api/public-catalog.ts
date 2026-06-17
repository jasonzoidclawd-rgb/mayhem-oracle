import { readFile } from "node:fs/promises";
import path from "node:path";
import { SITE_URL } from "@/lib/site";

/**
 * Public Data API surface. Each key maps to a sanitized file in public/data,
 * which the export pipeline (export_public_catalog.py) has already stripped of
 * member-only telemetry (augment win-rates, oracle scores, pool rules) and the
 * full combo set — public combos are an S-tier teaser only. Anything served
 * here is safe for third parties to embed.
 */
export const PUBLIC_RESOURCES: Record<string, string> = {
  champions: "champions.json",
  augments: "augments.json",
  combos: "combos.json",
  items: "items.json",
  meta: "meta.json",
  "patch-notes": "patch-notes.json",
};

export const ATTRIBUTION = {
  source: "Mayhem Oracle",
  url: SITE_URL,
  license:
    "Free to use with attribution to Mayhem Oracle. Data derived from public " +
    "League of Legends sources; not endorsed by or affiliated with Riot Games.",
} as const;

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** CDN-friendly: cache an hour at the edge, serve stale for a week while revalidating. */
export const CACHE_HEADERS: Record<string, string> = {
  "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
};

export async function readPublicResource(resource: string): Promise<Record<string, unknown> | null> {
  const file = PUBLIC_RESOURCES[resource];
  if (!file) return null;
  const raw = await readFile(path.join(process.cwd(), "public", "data", file), "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}
