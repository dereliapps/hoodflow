import { Contract, JsonRpcProvider, formatUnits, parseUnits } from "ethers";

import {
  ROBINHOOD_MAINNET,
  ROBINHOOD_TOKENS,
  ROUTED_ASSETS,
  STOCK_TOKEN_DECIMALS,
  USDG_ADDRESS,
  USDG_DECIMALS,
  V3_QUOTER_ABI,
  V3_QUOTER_ADDRESS,
  V3_ROUTE_FEES,
  V4_POOL_CANDIDATES,
  V4_QUOTER_ABI,
  V4_QUOTER_ADDRESS,
  buildExactInputQuoteParams,
  isV3RoutedAsset,
} from "@/lib/hoodflow-mainnet";
import {
  buildRobinhoodPriceRequests,
  parseRobinhoodPriceResults,
  type PricePoint,
  type PriceRpcResult,
} from "@/lib/robinhood-prices";
import {
  calculateOracleDeviation,
  OracleDeviationError,
  type OracleDeviationInput,
} from "@/lib/oracle-protection";

export { MAX_ORACLE_DEVIATION_BPS } from "@/lib/oracle-protection";

export type AgentQuoteSide = "buy" | "sell";

export type AgentQuoteRequest = {
  asset: string;
  side: AgentQuoteSide;
  amount: string;
  slippageBps: number;
};

export type AgentMarket = {
  ticker: string;
  name: string;
  type: "Stock Token" | "ETF Token";
  tokenAddress: string;
  settlementTicker: "USDG";
  settlementAddress: string;
  route: "Uniswap V3" | "Uniswap V4";
  status: "route-reviewed";
};

export type AgentQuote = {
  quoteId: string;
  status: "indicative-preflight";
  chain: { id: 4663; name: "Robinhood Chain" };
  asset: string;
  side: AgentQuoteSide;
  pay: { ticker: string; address: string; amount: string; rawAmount: string; decimals: number };
  receive: { ticker: string; address: string; estimatedAmount: string; indicativeMinimumAmount: string; rawEstimatedAmount: string; rawIndicativeMinimumAmount: string; decimals: number };
  route: { protocol: "Uniswap V3" | "Uniswap V4"; fee: number; feeBps: number; tickSpacing: number | null; gasEstimate: string | null };
  protection: { slippageBps: number; dataExpiresAt: string; executionBinding: "none-requote-required" };
  reference: { status: "live"; price: number; impliedDexPrice: number; deviationBps: number; maxDeviationBps: number; updatedAt: number; heartbeat: number; oraclePaused: false };
  custody: "self-custody";
  requiresUserSignature: true;
  executionHandoff: { marketPath: string; marketUrl: string; intent: AgentQuoteRequest; instruction: string };
  quotedAt: string;
};

const MARKET_NAMES: Record<string, string> = {
  AAPL: "Apple",
  AMD: "AMD",
  AMZN: "Amazon",
  GOOGL: "Alphabet",
  INTC: "Intel",
  META: "Meta",
  MU: "Micron",
  NVDA: "NVIDIA",
  SNDK: "Sandisk",
  SPCX: "SpaceX",
  TSLA: "Tesla",
  QQQ: "Invesco QQQ",
  SGOV: "iShares 0-3 Month Treasury",
  SLV: "iShares Silver Trust",
  SPY: "SPDR S&P 500",
};

const ETF_TICKERS = new Set(["QQQ", "SGOV", "SLV", "SPY"]);
const AGENT_DISABLED_MARKETS = new Set(["SGOV"]);
const DECIMAL_INPUT = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const MAX_BUY_AMOUNT = 100_000;
const MAX_SELL_AMOUNT = 1_000_000;
const QUOTE_TTL_MS = 75_000;
const RPC_TIMEOUT_MS = 5_000;
const CANONICAL_SITE_ORIGIN = "https://hoodflow.app";

export class AgentQuoteValidationError extends Error {}
export class AgentQuoteUnavailableError extends Error {}

export function canonicalSiteOrigin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return CANONICAL_SITE_ORIGIN;
  try {
    const url = new URL(configured);
    const localDevelopment = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !localDevelopment) return CANONICAL_SITE_ORIGIN;
    return url.origin;
  } catch {
    return CANONICAL_SITE_ORIGIN;
  }
}

export function buildAgentMarketUrl(request: AgentQuoteRequest) {
  const url = new URL("/", canonicalSiteOrigin());
  url.searchParams.set("asset", request.asset);
  url.searchParams.set("agentSide", request.side);
  url.searchParams.set("agentAmount", request.amount);
  url.searchParams.set("agentSlippageBps", String(request.slippageBps));
  return url;
}

export function listAgentMarkets(): AgentMarket[] {
  return ROUTED_ASSETS.filter((ticker) => !AGENT_DISABLED_MARKETS.has(ticker)).map((ticker) => ({
    ticker,
    name: MARKET_NAMES[ticker] ?? ticker,
    type: ETF_TICKERS.has(ticker) ? "ETF Token" : "Stock Token",
    tokenAddress: ROBINHOOD_TOKENS[ticker],
    settlementTicker: "USDG",
    settlementAddress: USDG_ADDRESS,
    route: isV3RoutedAsset(ticker) ? "Uniswap V3" : "Uniswap V4",
    status: "route-reviewed",
  }));
}

function readString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AgentQuoteValidationError(`${field} is required.`);
  }
  return value.trim();
}

export function parseAgentQuoteRequest(value: unknown): AgentQuoteRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentQuoteValidationError("A JSON quote request is required.");
  }
  const input = value as Record<string, unknown>;
  const asset = readString(input.asset, "asset").toUpperCase();
  if (!ROUTED_ASSETS.includes(asset) || AGENT_DISABLED_MARKETS.has(asset)) {
    throw new AgentQuoteValidationError("asset must be one of HoodFlow's execution-ready markets.");
  }

  const side = readString(input.side, "side").toLowerCase();
  if (side !== "buy" && side !== "sell") {
    throw new AgentQuoteValidationError("side must be buy or sell.");
  }

  const amount = readString(input.amount, "amount");
  if (!DECIMAL_INPUT.test(amount) || Number(amount) <= 0 || !Number.isFinite(Number(amount))) {
    throw new AgentQuoteValidationError("amount must be a positive decimal string.");
  }
  const amountDecimals = amount.split(".")[1]?.length ?? 0;
  const inputDecimals = side === "buy" ? USDG_DECIMALS : STOCK_TOKEN_DECIMALS;
  if (amountDecimals > inputDecimals) {
    throw new AgentQuoteValidationError(`amount supports at most ${inputDecimals} decimal places for this side.`);
  }
  const maximum = side === "buy" ? MAX_BUY_AMOUNT : MAX_SELL_AMOUNT;
  if (Number(amount) > maximum) {
    throw new AgentQuoteValidationError(`amount exceeds the public quote limit of ${maximum.toLocaleString("en-US")}.`);
  }

  const rawSlippage = input.slippageBps ?? 50;
  if (typeof rawSlippage !== "number" || !Number.isInteger(rawSlippage) || rawSlippage < 1 || rawSlippage > 500) {
    throw new AgentQuoteValidationError("slippageBps must be an integer from 1 to 500.");
  }

  return { asset, side, amount, slippageBps: rawSlippage };
}

function configuredRpcUrls() {
  return [
    process.env.ROBINHOOD_MAINNET_RPC_URL_PRIMARY,
    process.env.ROBINHOOD_MAINNET_RPC_URL_SECONDARY,
    ...(process.env.ROBINHOOD_RPC_URLS ?? "").split(","),
    process.env.ROBINHOOD_RPC_URL,
    ...ROBINHOOD_MAINNET.rpcUrls,
  ].map((url) => url?.trim() ?? "").filter((url, index, urls) => Boolean(url) && urls.indexOf(url) === index);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = RPC_TIMEOUT_MS): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new AgentQuoteUnavailableError("Onchain quote timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

type RouteQuote = {
  amountOut: bigint;
  protocol: "Uniswap V3" | "Uniswap V4";
  fee: number;
  tickSpacing: number | null;
  gasEstimate: bigint | null;
};

export function evaluateOracleDeviation(input: OracleDeviationInput) {
  try {
    return calculateOracleDeviation(input);
  } catch (error) {
    if (error instanceof OracleDeviationError) throw new AgentQuoteUnavailableError(error.message);
    throw error;
  }
}

async function readLiveReference(provider: JsonRpcProvider, asset: string): Promise<PricePoint & { price: number; updatedAt: number; oraclePaused: false; status: "live" }> {
  const requests = buildRobinhoodPriceRequests().filter((request) => request.id.endsWith(`:${asset}`));
  const results = await withTimeout(Promise.all(requests.map(async (request) => {
    const result = await provider.call(request.params[0]);
    return { id: request.id, result } satisfies PriceRpcResult;
  })));
  const parsed = parseRobinhoodPriceResults(results);
  const point = parsed.prices[asset as keyof typeof parsed.prices];
  if (!point || point.status !== "live" || point.price === null || point.updatedAt === null || point.oraclePaused !== false) {
    throw new AgentQuoteUnavailableError("The live oracle safety check did not pass.");
  }
  return { ...point, status: "live", price: point.price, updatedAt: point.updatedAt, oraclePaused: false };
}

async function readRouteQuote(provider: JsonRpcProvider, request: AgentQuoteRequest, amountIn: bigint): Promise<RouteQuote> {
  const tokenAddress = ROBINHOOD_TOKENS[request.asset];
  const tokenIn = request.side === "buy" ? USDG_ADDRESS : tokenAddress;
  const tokenOut = request.side === "buy" ? tokenAddress : USDG_ADDRESS;

  if (isV3RoutedAsset(request.asset)) {
    const fee = V3_ROUTE_FEES[request.asset];
    const quoter = new Contract(V3_QUOTER_ADDRESS, V3_QUOTER_ABI, provider);
    const result = await withTimeout(quoter.quoteExactInputSingle.staticCall({
      tokenIn,
      tokenOut,
      amountIn,
      fee,
      sqrtPriceLimitX96: 0,
    }));
    const amountOut = BigInt(result[0].toString());
    if (amountOut <= 0n) throw new AgentQuoteUnavailableError("The reviewed V3 pool returned no output.");
    return {
      amountOut,
      protocol: "Uniswap V3",
      fee,
      tickSpacing: null,
      gasEstimate: BigInt(result[3].toString()),
    };
  }

  const quoter = new Contract(V4_QUOTER_ADDRESS, V4_QUOTER_ABI, provider);
  const attempts = await withTimeout(Promise.allSettled(V4_POOL_CANDIDATES.map(async (route) => {
    const result = await quoter.quoteExactInputSingle.staticCall(buildExactInputQuoteParams(tokenIn, tokenOut, amountIn, route));
    return {
      amountOut: BigInt(result[0].toString()),
      protocol: "Uniswap V4" as const,
      fee: route.fee,
      tickSpacing: route.tickSpacing,
      gasEstimate: BigInt(result[1].toString()),
    };
  })));
  const quotes = attempts.flatMap((attempt) => attempt.status === "fulfilled" && attempt.value.amountOut > 0n ? [attempt.value] : []);
  if (quotes.length === 0) throw new AgentQuoteUnavailableError("No reviewed pool returned an executable quote.");
  return quotes.reduce((best, current) => current.amountOut > best.amountOut ? current : best);
}

export async function prepareAgentQuote(request: AgentQuoteRequest): Promise<AgentQuote> {
  const tokenAddress = ROBINHOOD_TOKENS[request.asset];
  const inputDecimals = request.side === "buy" ? USDG_DECIMALS : STOCK_TOKEN_DECIMALS;
  const outputDecimals = request.side === "buy" ? STOCK_TOKEN_DECIMALS : USDG_DECIMALS;
  const amountIn = parseUnits(request.amount, inputDecimals);
  let routeQuote: RouteQuote | null = null;
  let liveReference: Awaited<ReturnType<typeof readLiveReference>> | null = null;

  for (const rpcUrl of configuredRpcUrls().slice(0, 3)) {
    const provider = new JsonRpcProvider(rpcUrl, ROBINHOOD_MAINNET.chainIdNumber, { staticNetwork: true });
    try {
      [routeQuote, liveReference] = await Promise.all([
        readRouteQuote(provider, request, amountIn),
        readLiveReference(provider, request.asset),
      ]);
      break;
    } catch {
      // Continue to the next configured endpoint. A public error never exposes RPC credentials.
    } finally {
      provider.destroy();
    }
  }
  if (!routeQuote || !liveReference) throw new AgentQuoteUnavailableError("A fresh onchain route is temporarily unavailable.");

  const minimumOut = routeQuote.amountOut * BigInt(10_000 - request.slippageBps) / 10_000n;
  if (minimumOut <= 0n) throw new AgentQuoteUnavailableError("The protected minimum output is zero.");
  const estimatedAmount = formatUnits(routeQuote.amountOut, outputDecimals);
  const referenceCheck = evaluateOracleDeviation({
    side: request.side,
    inputAmount: formatUnits(amountIn, inputDecimals),
    outputAmount: estimatedAmount,
    oraclePrice: liveReference.price,
  });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + QUOTE_TTL_MS);
  const payTicker = request.side === "buy" ? "USDG" : request.asset;
  const receiveTicker = request.side === "buy" ? request.asset : "USDG";
  const payAddress = request.side === "buy" ? USDG_ADDRESS : tokenAddress;
  const receiveAddress = request.side === "buy" ? tokenAddress : USDG_ADDRESS;
  const handoffUrl = buildAgentMarketUrl(request);

  return {
    quoteId: `hf-${request.asset.toLowerCase()}-${now.getTime().toString(36)}`,
    status: "indicative-preflight",
    chain: { id: 4663, name: "Robinhood Chain" },
    asset: request.asset,
    side: request.side,
    pay: { ticker: payTicker, address: payAddress, amount: formatUnits(amountIn, inputDecimals), rawAmount: amountIn.toString(), decimals: inputDecimals },
    receive: {
      ticker: receiveTicker,
      address: receiveAddress,
      estimatedAmount,
      indicativeMinimumAmount: formatUnits(minimumOut, outputDecimals),
      rawEstimatedAmount: routeQuote.amountOut.toString(),
      rawIndicativeMinimumAmount: minimumOut.toString(),
      decimals: outputDecimals,
    },
    route: {
      protocol: routeQuote.protocol,
      fee: routeQuote.fee,
      feeBps: routeQuote.fee / 100,
      tickSpacing: routeQuote.tickSpacing,
      gasEstimate: routeQuote.gasEstimate?.toString() ?? null,
    },
    protection: { slippageBps: request.slippageBps, dataExpiresAt: expiresAt.toISOString(), executionBinding: "none-requote-required" },
    reference: {
      status: "live",
      price: liveReference.price,
      impliedDexPrice: referenceCheck.impliedDexPrice,
      deviationBps: referenceCheck.deviationBps,
      maxDeviationBps: referenceCheck.maxDeviationBps,
      updatedAt: liveReference.updatedAt,
      heartbeat: liveReference.heartbeat,
      oraclePaused: false,
    },
    custody: "self-custody",
    requiresUserSignature: true,
    executionHandoff: {
      marketPath: `${handoffUrl.pathname}${handoffUrl.search}`,
      marketUrl: handoffUrl.href,
      intent: request,
      instruction: "Prefill the HoodFlow order, request a fresh execution-bound quote, and confirm it in the user's wallet.",
    },
    quotedAt: now.toISOString(),
  };
}
