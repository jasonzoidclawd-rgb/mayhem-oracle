import { randomBytes, createHash } from "node:crypto";
import { createServiceClient } from "../entitlements/server";
import { createClient } from "../supabase/server";
import { createR2Storage } from "../telemetry/r2";
import type { TelemetryDeps } from "./telemetry";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Unambiguous code for the device-link flow (read aloud / typed on desktop).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function shortCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    if (i === 4) code += "-";
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

export function createTelemetryDeps(): TelemetryDeps {
  const r2 = createR2Storage();

  return {
    resolveDeviceToken: async (token) => {
      const service = createServiceClient();
      const { data } = await service
        .from("devices")
        .select("id,user_id,revoked")
        .eq("device_token_hash", sha256(token))
        .maybeSingle();
      if (!data || data.revoked) return null;
      return { deviceId: data.id, userId: data.user_id };
    },

    knownGameHashes: async (gameHashes) => {
      const service = createServiceClient();
      const { data } = await service
        .from("ingested_games")
        .select("game_hash")
        .in("game_hash", gameHashes);
      return new Set((data ?? []).map((row) => row.game_hash as string));
    },

    putBatch: async (key, body) => {
      await r2.put(key, body);
    },

    recordBatch: async ({ deviceId, userId, r2Key, gameHashes }) => {
      const service = createServiceClient();
      const { data: batch } = await service
        .from("telemetry_batches")
        .insert({
          device_id: deviceId,
          user_id: userId,
          r2_key: r2Key,
          game_count: gameHashes.length,
          schema_version: 1,
        })
        .select("id")
        .single();
      if (!batch) return;
      // Idempotent dedupe rows; ignore conflicts from a racing duplicate upload.
      await service.from("ingested_games").upsert(
        gameHashes.map((hash) => ({
          game_hash: hash,
          batch_id: batch.id,
          contributor_id: userId,
        })),
        { onConflict: "game_hash", ignoreDuplicates: true },
      );
    },

    createDeviceCode: async (platform) => {
      const service = createServiceClient();
      const code = shortCode();
      const expiresInSeconds = 600;
      await service.from("device_codes").insert({
        code_hash: sha256(code),
        platform,
        expires_at: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      });
      return { code, expiresInSeconds };
    },

    linkDevice: async (code, userId, label) => {
      const service = createServiceClient();
      const { data: codeRow } = await service
        .from("device_codes")
        .select("id,platform,status,expires_at")
        .eq("code_hash", sha256(code))
        .maybeSingle();
      if (!codeRow || codeRow.status !== "pending" || new Date(codeRow.expires_at) <= new Date()) {
        return null;
      }

      const deviceToken = randomBytes(32).toString("base64url");
      const { data: device } = await service
        .from("devices")
        .insert({
          user_id: userId,
          device_token_hash: sha256(deviceToken),
          platform: codeRow.platform,
          label,
        })
        .select("id")
        .single();
      if (!device) return null;

      await service
        .from("device_codes")
        .update({ status: "claimed", claimed_by: userId, device_id: device.id })
        .eq("id", codeRow.id);

      return { deviceToken };
    },

    getUserId: async () => {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user?.id ?? null;
    },
  };
}
