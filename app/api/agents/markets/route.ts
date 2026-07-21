import { NextResponse } from "next/server";

import { canonicalSiteOrigin, listAgentMarkets, MAX_ORACLE_DEVIATION_BPS } from "@/lib/hoodflow-agent";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export async function GET() {
  const markets = listAgentMarkets();
  const origin = canonicalSiteOrigin();
  return NextResponse.json({
    resource: "hoodflow.execution-markets",
    version: "1.0",
    chain: { id: 4663, name: "Robinhood Chain" },
    settlement: "USDG",
    executionPolicy: {
      fullInputOnly: true,
      freshQuoteRequired: true,
      liveOracleRequired: true,
      maxOracleDeviationBps: MAX_ORACLE_DEVIATION_BPS,
      slippageFloorRequired: true,
      finalWalletConfirmationRequired: true,
      preflightIsExecutionBound: false,
    },
    markets,
    marketCount: markets.length,
    resourceUrl: `${origin}/api/agents/markets`,
    quoteEndpoint: `${origin}/api/agents/quote`,
    fetchedAt: new Date().toISOString(),
  }, {
    headers: {
      ...CORS_HEADERS,
      "cache-control": "public, max-age=30, s-maxage=30, stale-while-revalidate=120",
    },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
