import type { RequireEntitlementResult } from "../entitlements/server";

export interface ModelReleaseRow {
  model_version: string;
  engine_version: string;
  data_version: string;
  config_sha256: string;
  signature: string;
  package_url: string;
}

export interface TrialLease {
  gameHash: string;
  expiresAt: string;
}

export interface OverlayApiDeps {
  requireEntitlement(): Promise<RequireEntitlementResult>;
  getActiveRelease(): Promise<ModelReleaseRow | null>;
  /** Active (unexpired) trial reservation for this user, if any. */
  findActiveLease(userId: string): Promise<TrialLease | null>;
  /** Reserve one trial credit; null when no credit is available. */
  reserveTrialCredit(userId: string, gameHash: string): Promise<TrialLease | null>;
  getUserId(): Promise<string | null>;
  now?(): Date;
}

const LEASE_MINUTES = 40;

export function leaseExpiry(now: Date): string {
  return new Date(now.getTime() + LEASE_MINUTES * 60_000).toISOString();
}

/**
 * GET /api/overlay/bootstrap — members (or trial users holding an active
 * game lease) receive the active signed model manifest.
 */
export async function handleOverlayBootstrap(
  _request: Request,
  deps: OverlayApiDeps,
): Promise<Response> {
  const gate = await deps.requireEntitlement();
  let leased: TrialLease | null = null;

  if (!gate.ok) {
    if (gate.status === 401) {
      return Response.json({ error: gate.reason }, { status: 401 });
    }
    const userId = await deps.getUserId();
    leased = userId ? await deps.findActiveLease(userId) : null;
    if (!leased) return Response.json({ error: gate.reason }, { status: 403 });
  }

  const release = await deps.getActiveRelease();
  if (!release) return Response.json({ error: "no-active-model" }, { status: 404 });

  return Response.json({
    manifest: {
      modelVersion: release.model_version,
      engineVersion: release.engine_version,
      dataVersion: release.data_version,
      configSha256: release.config_sha256,
      signature: release.signature,
    },
    packageUrl: release.package_url,
    access: gate.ok ? { kind: gate.entitlement.kind } : { kind: "trial-lease", lease: leased },
  });
}

/**
 * POST /api/overlay/game-session — members get a lease without consuming
 * anything; trial users reserve one of their three game credits.
 */
export async function handleGameSession(
  request: Request,
  deps: OverlayApiDeps,
): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return Response.json({ error: "unauthenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { gameHash } = (body ?? {}) as Record<string, unknown>;
  if (typeof gameHash !== "string" || gameHash.length < 8) {
    return Response.json({ error: "gameHash is required" }, { status: 400 });
  }

  const gate = await deps.requireEntitlement();
  const now = deps.now?.() ?? new Date();

  if (gate.ok) {
    return Response.json({
      lease: { kind: gate.entitlement.kind, gameHash, expiresAt: leaseExpiry(now) },
    });
  }

  const lease = await deps.reserveTrialCredit(userId, gameHash);
  if (!lease) return Response.json({ error: "no-trial-credits" }, { status: 403 });
  return Response.json({ lease: { kind: "trial", ...lease } });
}
