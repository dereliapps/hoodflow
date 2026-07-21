import { NextResponse } from "next/server";

import { canonicalSiteOrigin, MAX_ORACLE_DEVIATION_BPS } from "@/lib/hoodflow-agent";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export async function GET() {
  const origin = canonicalSiteOrigin();
  return NextResponse.json({
    name: "HoodFlow Execution Preflight",
    provider: "HoodFlow",
    version: "1.0",
    description: "A bounded preflight surface for discovering reviewed Stock Token markets and checking indicative Robinhood Chain routes before a fresh wallet quote.",
    network: { chainId: 4663, name: "Robinhood Chain", settlementToken: "USDG" },
    capabilities: {
      resources: [{
        id: "hoodflow.execution-markets",
        description: "Read the current route-reviewed Stock Token registry and execution policy.",
        method: "GET",
        endpoint: `${origin}/api/agents/markets`,
      }],
      preflightActions: [{
        id: "hoodflow.prepare-stock-token-quote",
        description: "Prepare a short-lived, slippage-bounded indicative buy or sell preflight. This endpoint never submits a transaction.",
        method: "POST",
        endpoint: `${origin}/api/agents/quote`,
        inputSchema: {
          type: "object",
          required: ["asset", "side", "amount"],
          properties: {
            asset: { type: "string", description: "Route-reviewed HoodFlow ticker, for example AAPL." },
            side: { type: "string", enum: ["buy", "sell"] },
            amount: { type: "string", description: "USDG for buys; Stock Token units for sells." },
            slippageBps: { type: "integer", minimum: 1, maximum: 500, default: 50 },
          },
        },
        output: "Indicative route check plus an exact-intent HoodFlow handoff. HoodFlow requotes before final wallet confirmation.",
      }],
    },
    safety: {
      custody: "self-custody",
      autonomousSubmission: false,
      walletConfirmation: "required",
      preflightDataTtlSeconds: 75,
      maxOracleDeviationBps: MAX_ORACLE_DEVIATION_BPS,
      note: "HoodFlow's public agent surface prepares execution. It does not hold funds, request private keys, or sign for the user.",
    },
    virtualsAcp: {
      integrationMode: "API-only provider candidate",
      registryStatus: "not-published",
      claim: "The resource and preflight API are ready for provider onboarding; no live ACP listing is claimed yet.",
    },
  }, {
    headers: {
      ...CORS_HEADERS,
      "cache-control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
    },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
