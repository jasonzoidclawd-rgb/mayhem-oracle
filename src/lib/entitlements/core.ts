import { createHash } from "node:crypto";

export type EntitlementKind = "member" | "trial";

export interface EntitlementRow {
  kind: EntitlementKind | string;
  status: string;
  starts_at: string;
  expires_at: string | null;
}

export type InactiveReason = "none" | "revoked" | "expired" | "not-started";

export type EntitlementVerdict =
  | { active: true; kind: EntitlementKind }
  | { active: false; reason: InactiveReason };

export type PickedEntitlement =
  | { active: true; entitlement: EntitlementRow }
  | { active: false; reason: InactiveReason };

export function evaluateEntitlement(
  row: EntitlementRow | null,
  now: Date,
): EntitlementVerdict {
  if (!row) return { active: false, reason: "none" };
  if (row.status !== "active") return { active: false, reason: "revoked" };
  if (new Date(row.starts_at) > now) return { active: false, reason: "not-started" };
  if (row.expires_at !== null && new Date(row.expires_at) <= now) {
    return { active: false, reason: "expired" };
  }
  return { active: true, kind: row.kind as EntitlementKind };
}

// When nothing is active, "expired" is more actionable feedback than
// "revoked", which beats a bare "none".
const REASON_PRECEDENCE: InactiveReason[] = ["expired", "not-started", "revoked", "none"];

export function pickActiveEntitlement(
  rows: EntitlementRow[],
  now: Date,
): PickedEntitlement {
  const active = rows.filter((row) => evaluateEntitlement(row, now).active);
  if (active.length > 0) {
    const member = active.find((row) => row.kind === "member");
    return { active: true, entitlement: member ?? active[0] };
  }

  let reason: InactiveReason = "none";
  for (const row of rows) {
    const verdict = evaluateEntitlement(row, now);
    if (!verdict.active &&
        REASON_PRECEDENCE.indexOf(verdict.reason) < REASON_PRECEDENCE.indexOf(reason)) {
      reason = verdict.reason;
    }
  }
  return { active: false, reason };
}

/** Invite codes are stored server-side only as this digest. */
export function hashInviteCode(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}
