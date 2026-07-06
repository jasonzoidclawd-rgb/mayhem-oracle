import { createHash } from "node:crypto";

export type EntitlementKind = "member" | "trial" | "overlay_tester";

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
const ENTITLEMENT_PRIORITY: EntitlementKind[] = ["member", "trial", "overlay_tester"];

function pickActiveEntitlementForKinds(
  rows: EntitlementRow[],
  now: Date,
  allowedKinds: readonly EntitlementKind[] | null,
): PickedEntitlement {
  const allowed = allowedKinds ? new Set<string>(allowedKinds) : null;
  const scopedRows = allowed ? rows.filter((row) => allowed.has(row.kind)) : rows;
  const active = scopedRows.filter((row) => evaluateEntitlement(row, now).active);
  if (active.length > 0) {
    const preferred = ENTITLEMENT_PRIORITY
      .map((kind) => active.find((row) => row.kind === kind))
      .find((row): row is EntitlementRow => Boolean(row));
    return { active: true, entitlement: preferred ?? active[0] };
  }

  let reason: InactiveReason = "none";
  for (const row of scopedRows) {
    const verdict = evaluateEntitlement(row, now);
    if (!verdict.active &&
        REASON_PRECEDENCE.indexOf(verdict.reason) < REASON_PRECEDENCE.indexOf(reason)) {
      reason = verdict.reason;
    }
  }
  return { active: false, reason };
}

export function pickActiveEntitlement(
  rows: EntitlementRow[],
  now: Date,
): PickedEntitlement {
  return pickActiveEntitlementForKinds(rows, now, null);
}

export function pickActiveMemberEntitlement(
  rows: EntitlementRow[],
  now: Date,
): PickedEntitlement {
  return pickActiveEntitlementForKinds(rows, now, ["member", "trial"]);
}

export function pickActiveOverlayDownloadEntitlement(
  rows: EntitlementRow[],
  now: Date,
): PickedEntitlement {
  return pickActiveEntitlementForKinds(rows, now, ["member", "overlay_tester"]);
}

/** Invite codes are stored server-side only as this digest. */
export function hashInviteCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}
