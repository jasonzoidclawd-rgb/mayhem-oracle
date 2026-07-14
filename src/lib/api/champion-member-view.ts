import type { ChampionMemberViewPayload } from "@/lib/champions/member-view-contract";
import type { RequireEntitlementResult } from "@/lib/entitlements/server";
import { isSupportedLocale, type Locale } from "@/i18n/routing";

export interface ChampionMemberViewDeps {
  championExists(slug: string): Promise<boolean>;
  requireEntitlement(): Promise<RequireEntitlementResult>;
  loadMemberView(slug: string, locale: Locale): Promise<ChampionMemberViewPayload>;
}

function jsonError(error: string, status: number): Response {
  return Response.json(
    { error },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function handleChampionMemberView(
  request: Request,
  championSlug: string,
  deps: ChampionMemberViewDeps,
): Promise<Response> {
  let exists = false;
  try {
    exists = await deps.championExists(championSlug);
  } catch {
    return jsonError("champion-catalog-unavailable", 503);
  }
  if (!exists) return jsonError("unknown-champion", 404);

  const localeValue = new URL(request.url).searchParams.get("locale") ?? "en";
  if (!isSupportedLocale(localeValue)) return jsonError("unsupported-locale", 400);

  let gate: RequireEntitlementResult;
  try {
    gate = await deps.requireEntitlement();
  } catch {
    return jsonError("entitlement-unavailable", 403);
  }
  if (!gate.ok) return jsonError(gate.reason, gate.status);

  try {
    const payload = await deps.loadMemberView(championSlug, localeValue);
    return Response.json(payload, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return jsonError("member-view-unavailable", 503);
  }
}
