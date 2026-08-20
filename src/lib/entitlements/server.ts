import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { createClient } from "../supabase/server";
import {
  pickActiveMemberEntitlement,
  type EntitlementKind,
  type EntitlementRow,
} from "./core";

// Minimal client surface so the guard is testable without a live Supabase.
export interface EntitlementClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string; email?: string } | null } }>;
  };
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): Promise<{ data: EntitlementRow[] | null; error: { message: string } | null }>;
    };
  };
}

export type RequireEntitlementResult =
  | {
      ok: true;
      user: { id: string; email?: string };
      entitlement: { kind: EntitlementKind };
    }
  | { ok: false; status: 401 | 403; reason: string };

/**
 * Gate for every member decision surface. Fails closed: missing user → 401,
 * anything less than a currently-active entitlement → 403.
 *
 * A `bearerToken` (desktop overlay requests, which carry no session cookie)
 * is resolved via `resolveDeviceToken` instead of the cookie session. An
 * unknown or revoked token is reported as the distinct reason
 * "device-token-invalid" — separate from a merely-missing cookie session
 * ("unauthenticated") — so a caller can tell "this credential is bad, throw
 * it away" apart from "this user isn't a member" (status 403, never treated
 * as a reason to delete a valid credential).
 */
export async function requireActiveEntitlement(deps?: {
  client?: EntitlementClient;
  bearerToken?: string | null;
  resolveDeviceToken?: (token: string) => Promise<{ userId: string } | null>;
}): Promise<RequireEntitlementResult> {
  let userId: string;
  let userEmail: string | undefined;
  let client: EntitlementClient;

  if (deps?.bearerToken) {
    const resolved = deps.resolveDeviceToken
      ? await deps.resolveDeviceToken(deps.bearerToken)
      : null;
    if (!resolved) return { ok: false, status: 401, reason: "device-token-invalid" };
    userId = resolved.userId;
    client = deps.client ?? (createServiceClient() as unknown as EntitlementClient);
  } else {
    client = deps?.client ?? ((await createClient()) as unknown as EntitlementClient);
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) return { ok: false, status: 401, reason: "unauthenticated" };
    userId = user.id;
    userEmail = user.email;
  }

  const { data, error } = await client
    .from("entitlements")
    .select("kind,status,starts_at,expires_at")
    .eq("user_id", userId);
  if (error) return { ok: false, status: 403, reason: "lookup-failed" };

  const verdict = pickActiveMemberEntitlement(data ?? [], new Date());
  if (!verdict.active) return { ok: false, status: 403, reason: verdict.reason };

  return {
    ok: true,
    user: { id: userId, email: userEmail },
    entitlement: { kind: verdict.entitlement.kind as EntitlementKind },
  };
}

/**
 * Service-role client for admin routes (invite creation, grants, releases).
 * Server-only: requires SUPABASE_SERVICE_ROLE_KEY, which must never be
 * exposed with a NEXT_PUBLIC prefix.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Service client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }
  return createSupabaseJsClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
