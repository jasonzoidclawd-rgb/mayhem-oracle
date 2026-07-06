import { createOverlayDownloadDeps } from "@/lib/api/deps";
import { handleOverlayDownload } from "@/lib/api/downloads";

export async function GET(request: Request): Promise<Response> {
  return handleOverlayDownload(request, createOverlayDownloadDeps());
}
