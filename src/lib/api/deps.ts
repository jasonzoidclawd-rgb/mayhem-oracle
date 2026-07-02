import { loadInternalDecisionData } from "../data/internal-loader";
import { createServiceClient, requireActiveEntitlement } from "../entitlements/server";
import { createClient } from "../supabase/server";
import type { DecisionApiDeps } from "./decision";
import type { InviteApiDeps } from "./invites";
import { leaseExpiry, type OverlayApiDeps } from "./overlay";

type TrialReservationRpcResult = {
  game_hash?: unknown;
  reserved_at?: unknown;
};

export function createDecisionDeps(): DecisionApiDeps {
  return {
    requireEntitlement: () => requireActiveEntitlement(),
    loadData: (championSlug) => loadInternalDecisionData(championSlug),
    recordSession: async (record) => {
      // Insert with the user's own client; RLS allows self-inserts only.
      const client = await createClient();
      await client.from("decision_sessions").insert({
        user_id: record.userId,
        model_version: record.modelVersion,
        mode: record.mode,
        champion_slug: record.championSlug,
        round: record.round,
        context: record.context,
        result_summary: record.resultSummary,
      });
    },
  };
}

export function createInviteDeps(): InviteApiDeps {
  return {
    getUserId: async () => {
      const client = await createClient();
      const {
        data: { user },
      } = await client.auth.getUser();
      return user?.id ?? null;
    },
    redeem: async (codeHash, deviceId) => {
      const client = await createClient();
      const { data, error } = await client.rpc("redeem_invite", {
        p_code_hash: codeHash,
        p_device_id: deviceId,
      });
      if (error) return { data: null, error: { message: error.message } };
      return { data: data as { kind: "member" | "trial"; expires_at?: string | null }, error: null };
    },
  };
}

export function createOverlayDeps(): OverlayApiDeps {
  return {
    requireEntitlement: () => requireActiveEntitlement(),
    getUserId: async () => {
      const client = await createClient();
      const {
        data: { user },
      } = await client.auth.getUser();
      return user?.id ?? null;
    },
    getActiveRelease: async () => {
      const client = await createClient();
      const { data } = await client
        .from("model_releases")
        .select("model_version,engine_version,data_version,config_sha256,signature,package_url")
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ?? null;
    },
    findActiveLease: async (userId) => {
      const service = createServiceClient();
      const cutoff = new Date(Date.now() - 40 * 60_000).toISOString();
      const { data } = await service
        .from("referral_progress")
        .select("reserved_game_hash,reserved_at")
        .eq("user_id", userId)
        .gte("reserved_at", cutoff)
        .not("reserved_game_hash", "is", null)
        .limit(1)
        .maybeSingle();
      if (!data?.reserved_game_hash || !data.reserved_at) return null;
      return {
        gameHash: data.reserved_game_hash,
        expiresAt: leaseExpiry(new Date(data.reserved_at)),
      };
    },
    reserveTrialCredit: async (userId, gameHash) => {
      const service = createServiceClient();
      const { data, error } = await service.rpc("reserve_trial_credit", {
        p_user_id: userId,
        p_game_hash: gameHash,
      });
      if (error || !data || typeof data !== "object") return null;

      const reservation = data as TrialReservationRpcResult;
      if (typeof reservation.reserved_at !== "string") return null;
      const reservedAt = new Date(reservation.reserved_at);
      if (Number.isNaN(reservedAt.getTime())) return null;

      return {
        gameHash: typeof reservation.game_hash === "string" ? reservation.game_hash : gameHash,
        expiresAt: leaseExpiry(reservedAt),
      };
    },
  };
}
