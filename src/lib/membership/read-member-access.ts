import { pickActiveMemberEntitlement, type EntitlementRow } from "@/lib/entitlements/core";
import { createClient } from "@/lib/supabase/server";

export interface MemberAccess {
  active: boolean;
  signedIn: boolean;
}

// Resolve membership server-side so non-members never receive the member
// tool (or, for Advisor, the picker catalog). Callers keep their own
// 401/403 fallback for entitlements that lapse mid-session.
export async function readMemberAccess(): Promise<MemberAccess> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { active: false, signedIn: false };
    const { data } = await supabase
      .from("entitlements")
      .select("kind,status,starts_at,expires_at")
      .eq("user_id", user.id);
    const verdict = pickActiveMemberEntitlement((data as EntitlementRow[]) ?? [], new Date());
    return { active: verdict.active, signedIn: true };
  } catch {
    return { active: false, signedIn: false };
  }
}
