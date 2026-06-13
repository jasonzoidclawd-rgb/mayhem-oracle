import { randomBytes } from "node:crypto";
import { createClient } from "../supabase/server";
import { hashInviteCode, type EntitlementKind } from "./core";

export type RequireAdminResult =
  | { ok: true; user: { id: string } }
  | { ok: false; status: 401 | 403; reason: string };

interface AdminAuthClient {
  auth: {
    getUser(): Promise<{
      data: {
        user: { id: string; app_metadata?: Record<string, unknown> } | null;
      };
    }>;
  };
}

/** Administrators are flagged via auth.users.app_metadata.role = 'admin'. */
export async function requireAdmin(deps?: {
  client?: AdminAuthClient;
}): Promise<RequireAdminResult> {
  const client = deps?.client ?? ((await createClient()) as unknown as AdminAuthClient);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return { ok: false, status: 401, reason: "unauthenticated" };
  if (user.app_metadata?.role !== "admin") {
    return { ok: false, status: 403, reason: "admin-only" };
  }
  return { ok: true, user: { id: user.id } };
}

// Unambiguous alphabet (no 0/O/1/I); codes read aloud cleanly.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function codeChunk(length: number): string {
  const bytes = randomBytes(length);
  let chunk = "";
  for (let i = 0; i < length; i += 1) {
    chunk += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return chunk;
}

export interface GeneratedInvite {
  /** Plaintext code — shown exactly once at creation, never stored. */
  code: string;
  codeHash: string;
}

export function generateInviteCode(): GeneratedInvite {
  const code = `MAYHEM-${codeChunk(4)}-${codeChunk(4)}`;
  return { code, codeHash: hashInviteCode(code) };
}

export interface CreateInviteInput {
  kind: EntitlementKind;
  memberDurationDays?: number | null;
  maxRedemptions?: number;
  expiresAt?: string | null;
  createdBy: string;
}

export interface GrantEntitlementInput {
  userId: string;
  kind: EntitlementKind;
  expiresAt?: string | null;
  note?: string;
  grantedBy: string;
}

// Service-role row writers used by the admin route. Kept as plain insert/update
// payload builders so the route stays the only place holding the live client.
export function inviteRowFor(input: CreateInviteInput, codeHash: string) {
  return {
    code_hash: codeHash,
    kind: input.kind,
    member_duration_days: input.memberDurationDays ?? null,
    max_redemptions: input.maxRedemptions ?? 1,
    expires_at: input.expiresAt ?? null,
    created_by: input.createdBy,
  };
}

export function entitlementRowFor(input: GrantEntitlementInput) {
  return {
    user_id: input.userId,
    kind: input.kind,
    status: "active" as const,
    expires_at: input.expiresAt ?? null,
    note: input.note ?? null,
    granted_by: input.grantedBy,
  };
}
