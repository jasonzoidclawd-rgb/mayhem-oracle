import {
  pickActiveOverlayDownloadEntitlement,
  type EntitlementRow,
} from "../entitlements/core";

export type OverlayPlatform = "windows" | "mac";

export interface OverlayDownloadApiDeps {
  getUser(): Promise<{ id: string } | null>;
  listEntitlements(userId: string): Promise<EntitlementRow[]>;
  artifactUrl(platform: OverlayPlatform): string | null;
  now?(): Date;
}

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

function parsePlatform(request: Request): OverlayPlatform | null {
  const platform = new URL(request.url).searchParams.get("platform");
  if (platform === "windows" || platform === "mac") return platform;
  return null;
}

export async function handleOverlayDownload(
  request: Request,
  deps: OverlayDownloadApiDeps,
): Promise<Response> {
  const platform = parsePlatform(request);
  if (!platform) return jsonError("invalid-platform", 400);

  const user = await deps.getUser();
  if (!user) return jsonError("unauthenticated", 401);

  let rows: EntitlementRow[];
  try {
    rows = await deps.listEntitlements(user.id);
  } catch {
    return jsonError("lookup-failed", 403);
  }

  const verdict = pickActiveOverlayDownloadEntitlement(rows, deps.now?.() ?? new Date());
  if (!verdict.active) return jsonError(verdict.reason, 403);

  const artifactUrl = deps.artifactUrl(platform);
  if (!artifactUrl) return jsonError("download-unavailable", 503);

  return Response.redirect(artifactUrl, 302);
}
