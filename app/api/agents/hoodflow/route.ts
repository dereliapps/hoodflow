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
          id: "hoodflow.prepare-action-lock",
          name: "ActionLock",
          description: "Inspect canonical token identity, corporate-action and multiplier risk, plus available halt or pause signals. This read-only preflight never signs or submits.",
          method: "POST",
          endpoint: `${origin}/api/action-lock`,
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
          checks: [
            "canonical-token-address",
            "corporate-action-status",
            "token-multiplier",
            "halt-and-pause-signals",
          ],
          output: "A downloadable ActionLock passport with explicit pass, block or unknown checks. It is not proof of execution or settlement.",
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
      actionLock: "Read/preflight only. Official corporate-action and halt data can be incomplete or delayed; a passport is not proof of execution.",
    },
    virtualsAcp: {
      integrationMode: "registered public resource provider",
      registryStatus: "published",
      agentId: "019fdd55-ee5f-72b6-b06e-4dd67502ed4d",
      resources: [
        {
          id: "019fdd57-7db9-780f-9d9f-01b89e626b7e",
          name: "HoodFlow Agent Manifest",
          url: `${origin}/api/agents/hoodflow`,
        },
        {
          id: "019fdd57-be0a-7331-a7fe-42d50768f70a",
          name: "HoodFlow Reviewed Markets",
          url: `${origin}/api/agents/markets`,
        },
      ],
      signerConfigured: false,
      claim: "HoodFlow is registered on EconomyOS with two public, read-only ACP resources. Quote, ActionLock and basket preflights remain direct API actions and always hand execution back to the user.",
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
