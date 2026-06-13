import { parseBatch } from "../telemetry/validate";

export interface TelemetryDeps {
  /** Resolve a device bearer token to its device + owner, or null. */
  resolveDeviceToken(token: string): Promise<{ deviceId: string; userId: string } | null>;
  /** Game hashes already ingested (for idempotent dedupe). */
  knownGameHashes(gameHashes: string[]): Promise<Set<string>>;
  /** Persist the compressed safe batch to object storage (R2). */
  putBatch(key: string, body: ArrayBuffer | string): Promise<void>;
  /** Record batch metadata + accepted game hashes in Supabase. */
  recordBatch(meta: {
    deviceId: string;
    userId: string;
    r2Key: string;
    gameHashes: string[];
  }): Promise<void>;
  createDeviceCode(platform: string): Promise<{ code: string; expiresInSeconds: number }>;
  /** Approve a device code for the signed-in user; null if the code is unknown. */
  linkDevice(code: string, userId: string, label: string | null): Promise<{ deviceToken: string } | null>;
  getUserId(): Promise<string | null>;
}

const MAX_BODY_BYTES = 5_000_000;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export async function handleDeviceCode(request: Request, deps: TelemetryDeps): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const platform = (body as Record<string, unknown>)?.platform;
  if (platform !== "windows" && platform !== "macos") {
    return json({ error: "platform must be windows|macos" }, 400);
  }
  const result = await deps.createDeviceCode(platform);
  return json(result, 200);
}

export async function handleDeviceLink(request: Request, deps: TelemetryDeps): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return json({ error: "unauthenticated" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const { code, label } = (body ?? {}) as Record<string, unknown>;
  if (typeof code !== "string" || code.length < 4) {
    return json({ error: "code is required" }, 400);
  }
  const linked = await deps.linkDevice(code, userId, typeof label === "string" ? label : null);
  if (!linked) return json({ error: "invalid or expired code" }, 400);
  return json({ deviceToken: linked.deviceToken }, 200);
}

export async function handleTelemetryUpload(request: Request, deps: TelemetryDeps): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const device = token ? await deps.resolveDeviceToken(token) : null;
  if (!device) return json({ error: "unauthenticated device" }, 401);

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) return json({ error: "batch too large" }, 413);

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: "batch too large" }, 413);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const parsed = parseBatch(raw);
  if (!parsed.ok) {
    // Identity leakage is a hard 422 (the collector should never send it).
    const status = parsed.error === "identity field present" ? 422 : 400;
    return json({ error: parsed.error }, status);
  }

  const incomingHashes = parsed.matches.map((match) => match.gameHash);
  const seen = await deps.knownGameHashes(incomingHashes);
  const fresh = parsed.matches.filter((match) => !seen.has(match.gameHash));
  const duplicates = parsed.matches.length - fresh.length;

  if (fresh.length > 0) {
    const r2Key = `batches/${device.userId}/${Date.now()}-${fresh[0].gameHash}.json`;
    await deps.putBatch(r2Key, JSON.stringify(fresh));
    await deps.recordBatch({
      deviceId: device.deviceId,
      userId: device.userId,
      r2Key,
      gameHashes: fresh.map((match) => match.gameHash),
    });
  }

  return json({ accepted: fresh.length, duplicates }, 200);
}
