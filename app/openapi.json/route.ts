import { canonicalSiteOrigin } from "@/lib/hoodflow-agent";
import { buildHoodFlowOpenApiDocument } from "@/lib/hoodflow-openapi";

export const dynamic = "force-dynamic";

const PUBLIC_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "accept, content-type",
  "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

export async function GET() {
  return new Response(JSON.stringify(buildHoodFlowOpenApiDocument()), {
    headers: {
      ...PUBLIC_HEADERS,
      link: `<${canonicalSiteOrigin()}/.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"`,
    },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: PUBLIC_HEADERS });
}
