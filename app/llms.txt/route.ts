import { buildLlmsTxt } from "@/lib/llms";

export const dynamic = "force-dynamic";

const HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "cache-control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
  "content-type": "text/plain; charset=utf-8",
  "x-content-type-options": "nosniff",
};

export async function GET() {
  return new Response(buildLlmsTxt(), { headers: HEADERS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: HEADERS });
}
