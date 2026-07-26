import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  AgentBasketUnavailableError,
  AgentBasketValidationError,
  parseAgentBasketRequest,
  prepareAgentBasket,
} from "@/lib/hoodflow-basket";
import {
  AgentQuoteUnavailableError,
  AgentQuoteValidationError,
  canonicalSiteOrigin,
  listAgentMarkets,
  MAX_ORACLE_DEVIATION_BPS,
  parseAgentQuoteRequest,
  prepareAgentQuote,
} from "@/lib/hoodflow-agent";

export const HOODFLOW_MCP_PROTOCOL_VERSION = "2025-11-25";
export const HOODFLOW_MCP_RESOURCE_URI = "hoodflow://execution-markets";
export const HOODFLOW_MCP_TOOL_NAMES = [
  "hoodflow_list_markets",
  "hoodflow_prepare_quote",
  "hoodflow_prepare_basket",
] as const;

const DECIMAL_STRING = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

const quoteIntentSchema = z.object({
  asset: z.string().min(1).max(16).describe("Route-reviewed HoodFlow ticker."),
  side: z.enum(["buy", "sell"]),
  amount: z.string().regex(DECIMAL_STRING).describe(
    "USDG for buys; Stock Token units for sells.",
  ),
  slippageBps: z.number().int().min(1).max(500).default(50),
}).strict();

const normalizedQuoteIntentSchema = quoteIntentSchema.extend({
  slippageBps: z.number().int().min(1).max(500),
});

const basketIntentSchema = z.object({
  budgetUsdG: z.string().regex(DECIMAL_STRING).describe(
    "Total USDG budget. Maximum 100,000 USDG with up to 6 decimals.",
  ),
  legs: z.array(z.object({
    asset: z.string().min(1).max(16),
    weightBps: z.number().int().min(1).max(10_000),
  }).strict()).min(2).max(6).describe(
    "Unique route-reviewed assets whose weights sum to exactly 10,000 bps.",
  ),
  slippageBps: z.number().int().min(1).max(500).default(50),
  failurePolicy: z.enum(["all-or-nothing", "omit-unsafe"]).default("all-or-nothing"),
}).strict();

const chainSchema = z.object({
  id: z.literal(4663),
  name: z.literal("Robinhood Chain"),
}).strict();

const amountSchema = z.object({
  ticker: z.string(),
  address: z.string(),
  amount: z.string(),
  rawAmount: z.string(),
  decimals: z.number().int(),
}).strict();

const quoteOutputSchema = z.object({
  quoteId: z.string(),
  status: z.literal("indicative-preflight"),
  chain: chainSchema,
  asset: z.string(),
  side: z.enum(["buy", "sell"]),
  pay: amountSchema,
  receive: z.object({
    ticker: z.string(),
    address: z.string(),
    estimatedAmount: z.string(),
    indicativeMinimumAmount: z.string(),
    rawEstimatedAmount: z.string(),
    rawIndicativeMinimumAmount: z.string(),
    decimals: z.number().int(),
  }).strict(),
  route: z.object({
    protocol: z.enum(["Uniswap V3", "Uniswap V4"]),
    fee: z.number(),
    feeBps: z.number(),
    tickSpacing: z.number().int().nullable(),
    gasEstimate: z.string().nullable(),
  }).strict(),
  protection: z.object({
    slippageBps: z.number().int(),
    dataExpiresAt: z.string(),
    executionBinding: z.literal("none-requote-required"),
  }).strict(),
  reference: z.object({
    status: z.literal("live"),
    price: z.number(),
    impliedDexPrice: z.number(),
    deviationBps: z.number(),
    maxDeviationBps: z.number(),
    updatedAt: z.number(),
    heartbeat: z.number(),
    oraclePaused: z.literal(false),
  }).strict(),
  custody: z.literal("self-custody"),
  requiresUserSignature: z.literal(true),
  executionHandoff: z.object({
    marketPath: z.string(),
    marketUrl: z.string(),
    intent: normalizedQuoteIntentSchema,
    instruction: z.string(),
  }).strict(),
  quotedAt: z.string(),
}).strict();

const marketSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  type: z.enum(["Stock Token", "ETF Token"]),
  tokenAddress: z.string(),
  settlementTicker: z.literal("USDG"),
  settlementAddress: z.string(),
  route: z.enum(["Uniswap V3", "Uniswap V4"]),
  status: z.literal("route-reviewed"),
}).strict();

const marketDirectorySchema = z.object({
  resource: z.literal("hoodflow.execution-markets"),
  version: z.literal("1.1"),
  chain: chainSchema,
  settlement: z.literal("USDG"),
  executionPolicy: z.object({
    fullInputOnly: z.literal(true),
    freshQuoteRequired: z.literal(true),
    liveOracleRequired: z.literal(true),
    maxOracleDeviationBps: z.number(),
    slippageFloorRequired: z.literal(true),
    finalWalletConfirmationRequired: z.literal(true),
    preflightIsExecutionBound: z.literal(false),
    autonomousSubmission: z.literal(false),
  }).strict(),
  markets: z.array(marketSchema),
  marketCount: z.number().int(),
  quoteEndpoint: z.string(),
  basketEndpoint: z.string(),
  mcpEndpoint: z.string(),
  fetchedAt: z.string(),
}).strict();

const basketAllocationSchema = z.object({
  amount: z.string(),
  rawAmount: z.string(),
}).strict();

const basketOutputSchema = z.object({
  basketId: z.string(),
  status: z.enum(["indicative-preflight", "partial-indicative-preflight"]),
  progress: z.object({
    requestedLegs: z.number().int(),
    preparedLegs: z.number().int(),
    rejectedLegs: z.number().int(),
    completeness: z.enum(["full", "partial"]),
  }).strict(),
  budget: z.object({
    ticker: z.literal("USDG"),
    decimals: z.literal(6),
    requestedAmount: z.string(),
    rawRequestedAmount: z.string(),
    plannedAmount: z.string(),
    rawPlannedAmount: z.string(),
    unallocatedAmount: z.string(),
    rawUnallocatedAmount: z.string(),
  }).strict(),
  legs: z.array(z.object({
    index: z.number().int(),
    asset: z.string(),
    weightBps: z.number().int(),
    allocation: basketAllocationSchema,
    quote: quoteOutputSchema,
  }).strict()),
  rejectedLegs: z.array(z.object({
    index: z.number().int(),
    asset: z.string(),
    weightBps: z.number().int(),
    allocation: basketAllocationSchema,
    code: z.literal("preflight_unavailable"),
    retryable: z.literal(true),
  }).strict()),
  protection: z.object({
    slippageBps: z.number().int(),
    failurePolicy: z.enum(["all-or-nothing", "omit-unsafe"]),
    dataExpiresAt: z.string(),
    executionBinding: z.literal("none-requote-required"),
  }).strict(),
  custody: z.literal("self-custody"),
  requiresUserSignature: z.literal(true),
  execution: z.object({
    atomic: z.literal(false),
    submission: z.literal("none"),
    minimumTradeConfirmations: z.number().int(),
    instruction: z.string(),
  }).strict(),
  preparedAt: z.string(),
}).strict();

export type HoodFlowMcpDependencies = {
  prepareQuote?: typeof prepareAgentQuote;
  prepareBasket?: typeof prepareAgentBasket;
};

export function buildHoodFlowMarketDirectory(now = new Date()) {
  const origin = canonicalSiteOrigin();
  const markets = listAgentMarkets();
  return {
    resource: "hoodflow.execution-markets" as const,
    version: "1.1" as const,
    chain: { id: 4663 as const, name: "Robinhood Chain" as const },
    settlement: "USDG" as const,
    executionPolicy: {
      fullInputOnly: true as const,
      freshQuoteRequired: true as const,
      liveOracleRequired: true as const,
      maxOracleDeviationBps: MAX_ORACLE_DEVIATION_BPS,
      slippageFloorRequired: true as const,
      finalWalletConfirmationRequired: true as const,
      preflightIsExecutionBound: false as const,
      autonomousSubmission: false as const,
    },
    markets,
    marketCount: markets.length,
    quoteEndpoint: `${origin}/api/agents/quote`,
    basketEndpoint: `${origin}/api/agents/basket`,
    mcpEndpoint: `${origin}/api/mcp`,
    fetchedAt: now.toISOString(),
  };
}

function structuredResult(payload: object) {
  const structuredContent = payload as Record<string, unknown>;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent,
  };
}

function safeToolError(message: string, retryable = false) {
  return {
    isError: true,
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        error: message,
        retryable,
        safety: "No transaction was created, signed, or submitted.",
      }),
    }],
  };
}

export function createHoodFlowMcpServer(
  dependencies: HoodFlowMcpDependencies = {},
) {
  const quotePreparer = dependencies.prepareQuote ?? prepareAgentQuote;
  const basketPreparer = dependencies.prepareBasket ?? prepareAgentBasket;
  const server = new McpServer({
    name: "hoodflow-preflight",
    version: "1.1.0",
  }, {
    instructions: [
      "HoodFlow exposes public Robinhood Chain market discovery and indicative preflight only.",
      "These tools never hold funds, sign messages, create executable calldata, or submit transactions.",
      "Treat every quote and basket leg as temporary. HoodFlow must re-quote before the user confirms each leg in their own wallet.",
    ].join(" "),
  });

  server.registerTool("hoodflow_list_markets", {
    title: "List HoodFlow execution markets",
    description: "Read the current route-reviewed Stock Token registry and its safety policy.",
    inputSchema: z.object({}).strict(),
    outputSchema: marketDirectorySchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async () => structuredResult(buildHoodFlowMarketDirectory()));

  server.registerTool("hoodflow_prepare_quote", {
    title: "Prepare a Stock Token quote",
    description: [
      "Check a live route, oracle deviation, and protected indicative minimum.",
      "Returns a HoodFlow handoff only; it cannot sign or submit a transaction.",
    ].join(" "),
    inputSchema: quoteIntentSchema,
    outputSchema: quoteOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (input) => {
    try {
      const request = parseAgentQuoteRequest(input);
      return structuredResult(await quotePreparer(request));
    } catch (error) {
      if (error instanceof AgentQuoteValidationError) {
        return safeToolError(error.message);
      }
      if (error instanceof AgentQuoteUnavailableError) {
        return safeToolError("A fresh executable route is temporarily unavailable.", true);
      }
      return safeToolError("Quote verification failed safely.", true);
    }
  });

  server.registerTool("hoodflow_prepare_basket", {
    title: "Prepare a weighted Stock Token basket",
    description: [
      "Validate and preflight a 2–6 leg USDG basket using reviewed HoodFlow markets.",
      "Each leg remains a separate wallet-confirmed intent; no transaction is signed or submitted.",
    ].join(" "),
    inputSchema: basketIntentSchema,
    outputSchema: basketOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  }, async (input) => {
    try {
      const request = parseAgentBasketRequest(input);
      return structuredResult(await basketPreparer(request));
    } catch (error) {
      if (error instanceof AgentBasketValidationError) {
        return safeToolError(error.message);
      }
      if (error instanceof AgentBasketUnavailableError) {
        return safeToolError("The requested basket could not be prepared safely.", true);
      }
      return safeToolError("Basket verification failed safely.", true);
    }
  });

  server.registerResource("hoodflow-execution-markets", HOODFLOW_MCP_RESOURCE_URI, {
    title: "HoodFlow execution markets",
    description: "Current route-reviewed Stock Token registry and execution policy.",
    mimeType: "application/json",
  }, async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify(buildHoodFlowMarketDirectory()),
    }],
  }));

  return server;
}
