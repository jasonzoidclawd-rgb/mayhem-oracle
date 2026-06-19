import { createInviteDeps } from "@/lib/api/deps";
import { handleRedeemInvite } from "@/lib/api/invites";

export async function POST(request: Request): Promise<Response> {
  return handleRedeemInvite(request, createInviteDeps());
}
