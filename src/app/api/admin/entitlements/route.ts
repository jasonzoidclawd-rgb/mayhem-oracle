import {
  entitlementRowFor,
  generateInviteCode,
  inviteRowFor,
  requireAdmin,
} from "@/lib/entitlements/admin";
import { createServiceClient } from "@/lib/entitlements/server";

export async function GET(): Promise<Response> {
  const admin = await requireAdmin();
  if (!admin.ok) return Response.json({ error: admin.reason }, { status: admin.status });

  const service = createServiceClient();
  const [entitlements, invites] = await Promise.all([
    service
      .from("entitlements")
      .select("id,user_id,kind,status,starts_at,expires_at,note,created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    service
      .from("invite_codes")
      .select("id,kind,member_duration_days,max_redemptions,redemption_count,expires_at,revoked,created_at")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  return Response.json({
    entitlements: entitlements.data ?? [],
    inviteCodes: invites.data ?? [],
  });
}

export async function POST(request: Request): Promise<Response> {
  const admin = await requireAdmin();
  if (!admin.ok) return Response.json({ error: admin.reason }, { status: admin.status });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const payload = (body ?? {}) as Record<string, unknown>;
  const service = createServiceClient();

  switch (payload.action) {
    case "create-invite": {
      const kind = payload.kind;
      if (kind !== "member" && kind !== "trial") {
        return Response.json({ error: "kind must be member|trial" }, { status: 400 });
      }
      const generated = generateInviteCode();
      const { error } = await service.from("invite_codes").insert(
        inviteRowFor(
          {
            kind,
            memberDurationDays:
              typeof payload.memberDurationDays === "number" ? payload.memberDurationDays : null,
            maxRedemptions:
              typeof payload.maxRedemptions === "number" ? payload.maxRedemptions : 1,
            expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : null,
            createdBy: admin.user.id,
          },
          generated.codeHash,
        ),
      );
      if (error) return Response.json({ error: error.message }, { status: 400 });
      // The plaintext code exists only in this response.
      return Response.json({ code: generated.code, kind });
    }
    case "grant": {
      const { userId, kind } = payload;
      if (typeof userId !== "string" || (kind !== "member" && kind !== "trial")) {
        return Response.json({ error: "userId and kind are required" }, { status: 400 });
      }
      const { error } = await service.from("entitlements").insert(
        entitlementRowFor({
          userId,
          kind,
          expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : null,
          note: typeof payload.note === "string" ? payload.note : undefined,
          grantedBy: admin.user.id,
        }),
      );
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ granted: true });
    }
    case "revoke": {
      if (typeof payload.entitlementId !== "string") {
        return Response.json({ error: "entitlementId is required" }, { status: 400 });
      }
      const { error } = await service
        .from("entitlements")
        .update({ status: "revoked", updated_at: new Date().toISOString() })
        .eq("id", payload.entitlementId);
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ revoked: true });
    }
    default:
      return Response.json({ error: "unknown action" }, { status: 400 });
  }
}
