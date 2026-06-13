import { createOverlayDeps } from "@/lib/api/deps";
import { handleOverlayBootstrap } from "@/lib/api/overlay";

export async function GET(request: Request): Promise<Response> {
  return handleOverlayBootstrap(request, createOverlayDeps());
}
