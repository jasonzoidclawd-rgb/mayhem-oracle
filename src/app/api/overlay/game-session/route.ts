import { createOverlayDeps } from "@/lib/api/deps";
import { handleGameSession } from "@/lib/api/overlay";

export async function POST(request: Request): Promise<Response> {
  return handleGameSession(request, createOverlayDeps());
}
