import { createHash } from "node:crypto";
import { createServiceClient } from "../entitlements/server";

export interface ResolvedDevice {
  deviceId: string;
  userId: string;
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Resolve a device bearer token to its device + owner. Null if unknown or revoked. */
export async function resolveDeviceToken(token: string): Promise<ResolvedDevice | null> {
  const service = createServiceClient();
  const { data } = await service
    .from("devices")
    .select("id,user_id,revoked")
    .eq("device_token_hash", hashDeviceToken(token))
    .maybeSingle();
  if (!data || data.revoked) return null;
  return { deviceId: data.id, userId: data.user_id };
}
