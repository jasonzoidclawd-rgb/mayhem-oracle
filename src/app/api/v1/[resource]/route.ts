import { NextResponse } from "next/server";
import {
  PUBLIC_RESOURCES,
  ATTRIBUTION,
  CORS_HEADERS,
  CACHE_HEADERS,
  readPublicResource,
} from "@/lib/api/public-catalog";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ resource: string }> },
): Promise<Response> {
  const { resource } = await params;
  const body = await readPublicResource(resource);

  if (!body) {
    return NextResponse.json(
      { error: `Unknown resource '${resource}'`, available: Object.keys(PUBLIC_RESOURCES) },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  return NextResponse.json(
    { ...ATTRIBUTION, ...body },
    { headers: { ...CORS_HEADERS, ...CACHE_HEADERS } },
  );
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
