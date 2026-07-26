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
    connectors: {
      mcp: {
        transport: "streamable-http",
        protocolVersion: "2025-11-25",
        endpoint: `${origin}/api/mcp`,
      },
      openapi: {
        specification: "3.1.2",
        endpoint: `${origin}/openapi.json`,
      },
    },
    capabilities: {
      resources: [{
        id: "hoodflow.execution-markets",
        description: "Read the current route-reviewed Stock Token registry and execution policy.",
        method: "GET",
        endpoint: `${origin}/api/agents/markets`,
      }],
      preflightActions: [
        {
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
        },
        {
          id: "hoodflow.prepare-stock-token-basket",
          description: "Allocate one USDG budget across two to six reviewed markets and preflight every leg. The plan is non-atomic and never auto-submits.",
          method: "POST",
          endpoint: `${origin}/api/agents/basket`,
          inputSchema: {
            type: "object",
            required: ["budgetUsdG", "legs"],
            properties: {
              budgetUsdG: { type: "string", description: "Total USDG budget, up to 100,000 with at most six decimals." },
              legs: {
                type: "array",
                minItems: 2,
                maxItems: 6,
                items: {
                  type: "object",
                  required: ["asset", "weightBps"],
                  properties: {
                    asset: { type: "string" },
                    weightBps: { type: "integer", minimum: 1, maximum: 9_999 },
                  },
                },
              },
              slippageBps: { type: "integer", minimum: 1, maximum: 500, default: 50 },
              failurePolicy: { type: "string", enum: ["all-or-nothing", "omit-unsafe"], default: "all-or-nothing" },
            },
          },
          output: "A deterministic, short-lived allocation plan. Each accepted leg must be requoted and confirmed separately in the user's wallet.",
        },
      ],
    },
    safety: {
      custody: "self-custody",
      autonomousSubmission: false,
      walletConfirmation: "required",
      basketAtomicity: "non-atomic",
      basketExecution: "one fresh quote and at least one trade confirmation per leg; allowance and Permit2 steps can add wallet prompts",
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
