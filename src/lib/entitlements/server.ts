import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { createClient } from "../supabase/server";
import {
  pickActiveEntitlement,
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
 */
export async function requireActiveEntitlement(deps?: {
  client?: EntitlementClient;
}): Promise<RequireEntitlementResult> {
  const client = deps?.client ?? ((await createClient()) as unknown as EntitlementClient);

  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return { ok: false, status: 401, reason: "unauthenticated" };

  const { data, error } = await client
    .from("entitlements")
    .select("kind,status,starts_at,expires_at")
    .eq("user_id", user.id);
  if (error) return { ok: false, status: 403, reason: "lookup-failed" };

  const verdict = pickActiveEntitlement(data ?? [], new Date());
  if (!verdict.active) return { ok: false, status: 403, reason: verdict.reason };

  return {
    ok: true,
    user: { id: user.id, email: user.email },
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
