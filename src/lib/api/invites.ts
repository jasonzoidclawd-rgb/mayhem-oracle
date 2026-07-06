import { hashInviteCode, type EntitlementKind } from "../entitlements/core";

export interface RedeemOutcome {
  kind: EntitlementKind;
  expires_at?: string | null;
}

export interface InviteApiDeps {
  /** Resolves the signed-in user or null. */
  getUserId(): Promise<string | null>;
  /** Calls the security-definer redeem_invite RPC with the user's client. */
  redeem(codeHash: string, deviceId: string | null): Promise<
    { data: RedeemOutcome; error: null } | { data: null; error: { message: string } }
  >;
}

// The redeem_invite function raises with these messages; map them to client
// errors instead of leaking a 500.
const KNOWN_REDEEM_ERRORS = [
  "invalid invite code",
  "invite code revoked",
  "invite code expired",
  "invite code exhausted",
  "trial codes require a linked device",
  "device not linked to this account",
];

export async function handleRedeemInvite(
  request: Request,
  deps: InviteApiDeps,
): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return Response.json({ error: "unauthenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { code, deviceId } = (body ?? {}) as Record<string, unknown>;
  if (typeof code !== "string" || code.trim().length < 6) {
    return Response.json({ error: "code is required" }, { status: 400 });
  }
  if (deviceId !== undefined && typeof deviceId !== "string") {
    return Response.json({ error: "deviceId must be a string" }, { status: 400 });
  }

  const { data, error } = await deps.redeem(
    hashInviteCode(code),
    typeof deviceId === "string" ? deviceId : null,
  );
  if (error) {
    const known = KNOWN_REDEEM_ERRORS.find((message) => error.message.includes(message));
    // Double redemptions surface as unique-constraint violations.
    if (error.message.includes("duplicate key")) {
      return Response.json({ error: "invite already redeemed" }, { status: 409 });
    }
    if (known) return Response.json({ error: known }, { status: 400 });
    return Response.json({ error: "redemption failed" }, { status: 400 });
  }

  return Response.json({ kind: data.kind, expiresAt: data.expires_at ?? null });
}
