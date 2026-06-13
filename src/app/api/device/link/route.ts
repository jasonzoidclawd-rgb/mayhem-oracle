import { handleDeviceLink } from "@/lib/api/telemetry";
import { createTelemetryDeps } from "@/lib/api/telemetry-deps";

export async function POST(request: Request): Promise<Response> {
  return handleDeviceLink(request, createTelemetryDeps());
}
