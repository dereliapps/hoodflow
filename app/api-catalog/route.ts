import { canonicalSiteOrigin } from "@/lib/hoodflow-agent";
import {
  buildHoodFlowApiCatalog,
  HOODFLOW_API_CATALOG_PROFILE,
} from "@/lib/hoodflow-openapi";

export const dynamic = "force-dynamic";

const PUBLIC_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "accept, content-type",
  "cache-control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
  "content-type": `application/linkset+json; profile="${HOODFLOW_API_CATALOG_PROFILE}"`,
  "x-content-type-options": "nosniff",
};

export async function GET() {
  return new Response(JSON.stringify(buildHoodFlowApiCatalog()), {
    headers: {
      ...PUBLIC_HEADERS,
      link: `<${canonicalSiteOrigin()}/openapi.json>; rel="service-desc"; type="application/json"`,
    },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: PUBLIC_HEADERS });
}
