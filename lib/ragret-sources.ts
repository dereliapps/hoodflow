import { ROBINHOOD_PRICE_FEEDS } from "@/config/robinhood-price-feeds";
import stockHistorySnapshot from "@/generated/stock-price-history.json";
import {
  RagretDataUnavailableError,
  type RagretCommunitySnapshot,
  type RagretPricePoint,
  type RagretScenarioInput,
  type RagretScenarioRequest,
} from "@/lib/ragret";
import { decodeLatestRoundData } from "@/lib/chainlink";
import { PUBLIC_ROBINHOOD_PRICE_RPC_URL } from "@/lib/robinhood-prices";
import { getSeoAsset } from "@/lib/seo-assets";

const WINDOW_SECONDS = 24 * 60 * 60;
const MAX_WINDOW_DRIFT_SECONDS = 6 * 60 * 60;
const MAX_COMMUNITY_OBSERVATION_AGE_SECONDS = 10 * 60;
const CLOCK_SKEW_SECONDS = 60;
const SOURCE_TIMEOUT_MS = 8_000;
const DIRECT_RPC_TOTAL_TIMEOUT_MS = 4_500;
const DIRECT_RPC_REQUEST_TIMEOUT_MS = 1_500;
const DIRECT_RPC_MAX_BINARY_STEPS = 9;
const DIRECT_RPC_BRACKET_STEPS = [1n, 2n, 4n, 8n, 16n, 32n, 64n, 128n, 256n] as const;
const E8 = 100_000_000;
const MAX_COMMUNITY_RETURN_BPS = 1_000_000;
const LATEST_ROUND_DATA = "0xfeaf968c";
const GET_ROUND_DATA = "0x9a6fc8f5";

type HistoryPointPayload = {
  roundId?: unknown;
  price?: unknown;
  updatedAt?: unknown;
};

type HistoryPayload = {
  ticker?: unknown;
  feed?: unknown;
  points?: unknown;
};

type LivePricePayload = {
  prices?: Record<string, {
    price?: unknown;
    updatedAt?: unknown;
    oraclePaused?: unknown;
    status?: unknown;
  }>;
};

type CommunityMarketPayload = {
  address?: unknown;
  name?: unknown;
  symbol?: unknown;
  priceChange24h?: unknown;
  liquidityUsd?: unknown;
  lifecycle?: unknown;
  pairUrl?: unknown;
  externalUrl?: unknown;
  canonical?: unknown;
  category?: unknown;
};

type CommunityPayload = {
  markets?: unknown;
  updatedAt?: unknown;
};

type ParsedHistoryPoint = RagretPricePoint & {
  roundId: string;
};

type RpcRequest = {
  jsonrpc: "2.0";
  id: string;
  method: "eth_call";
  params: [{ to: string; data: string }, "latest"];
};

type RpcResponse = {
  id?: unknown;
  result?: unknown;
  error?: unknown;
};

export type RagretSourceOptions = {
  origin: string | URL;
  signal?: AbortSignal;
  nowSeconds?: number;
  fetcher?: typeof fetch;
};

export type RagretStockWindow = {
  stockName: string;
  stockStart: RagretPricePoint;
  stockEnd: RagretPricePoint;
};

function assertServerOnly() {
  if (typeof window !== "undefined") {
    throw new RagretDataUnavailableError("RAGRET market sources are available only on the server.");
  }
}

function unavailable(message: string): never {
  throw new RagretDataUnavailableError(message);
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value: unknown) {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function priceE8(value: unknown) {
  const parsed = finiteNumber(value);
  if (parsed === null || parsed <= 0) return null;
  const scaled = Math.round(parsed * E8);
  return Number.isSafeInteger(scaled) && scaled > 0 ? BigInt(scaled) : null;
}

function normalizeOrigin(value: string | URL) {
  try {
    const url = value instanceof URL ? value : new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      return unavailable("The same-origin RAGRET source URL is invalid.");
    }
    return url.origin;
  } catch {
    return unavailable("The same-origin RAGRET source URL is invalid.");
  }
}

function currentTime(options: RagretSourceOptions) {
  const value = options.nowSeconds ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(value) || value <= 0) {
    return unavailable("The RAGRET observation time is invalid.");
  }
  return value;
}

function requestSignal(parent?: AbortSignal) {
  const timeout = AbortSignal.timeout(SOURCE_TIMEOUT_MS);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

function boundedSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(Math.max(1, timeoutMs));
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

async function fetchJson(url: URL, options: RagretSourceOptions) {
  const response = await (options.fetcher ?? fetch)(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
    redirect: "error",
    signal: requestSignal(options.signal),
  });
  if (!response.ok) throw new Error(`RAGRET source returned ${response.status}`);
  return response.json() as Promise<unknown>;
}

function rpcRequest(id: string, feed: string, data: string): RpcRequest {
  return {
    jsonrpc: "2.0",
    id,
    method: "eth_call",
    params: [{ to: feed, data }, "latest"],
  };
}

function getRoundData(roundId: bigint) {
  return `${GET_ROUND_DATA}${roundId.toString(16).padStart(64, "0")}`;
}

async function directRpc(
  requests: RpcRequest[],
  options: RagretSourceOptions,
  deadline: number,
) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Direct Chainlink lookup timed out");
  const response = await (options.fetcher ?? fetch)(PUBLIC_ROBINHOOD_PRICE_RPC_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(requests.length === 1 ? requests[0] : requests),
    cache: "no-store",
    redirect: "error",
    signal: boundedSignal(options.signal, Math.min(remaining, DIRECT_RPC_REQUEST_TIMEOUT_MS)),
  });
  if (!response.ok) throw new Error(`Robinhood RPC returned ${response.status}`);
  const payload = await response.json() as unknown;
  const rows = Array.isArray(payload) ? payload : [payload];
  return new Map(rows.flatMap((raw): Array<[string, RpcResponse]> => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const row = raw as RpcResponse;
    return typeof row.id === "string" ? [[row.id, row]] : [];
  }));
}

function decodeDirectPoint(response: RpcResponse | undefined, feed: string, expectedRoundId?: bigint) {
  if (!response || response.error || typeof response.result !== "string") return null;
  const round = decodeLatestRoundData(response.result);
  if (!round
    || round.roundId <= 0n
    || round.answer <= 0n
    || round.updatedAt <= 0
    || round.answeredInRound < round.roundId
    || expectedRoundId !== undefined && round.roundId !== expectedRoundId) return null;
  return {
    roundId: round.roundId.toString(),
    priceE8: round.answer,
    updatedAt: round.updatedAt,
    sourceId: `chainlink-robinhood:${feed.toLowerCase()}:round:${round.roundId}`,
  } satisfies ParsedHistoryPoint;
}

async function readDirectRound(
  roundId: bigint,
  feed: string,
  options: RagretSourceOptions,
  deadline: number,
) {
  const id = `round:${roundId}`;
  const rows = await directRpc([rpcRequest(id, feed, getRoundData(roundId))], options, deadline);
  return decodeDirectPoint(rows.get(id), feed, roundId);
}

function parseHistoryPoints(value: unknown, feed: string) {
  if (!Array.isArray(value)) return [];
  const normalizedFeed = feed.toLowerCase();
  return value.flatMap((raw): ParsedHistoryPoint[] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const point = raw as HistoryPointPayload;
    const roundId = typeof point.roundId === "string" && /^\d+$/.test(point.roundId)
      ? point.roundId
      : "";
    const price = priceE8(point.price);
    const updatedAt = positiveInteger(point.updatedAt);
    if (!roundId || price === null || updatedAt === null) return [];
    return [{
      roundId,
      priceE8: price,
      updatedAt,
      sourceId: `chainlink-robinhood:${normalizedFeed}:round:${roundId}`,
    }];
  }).sort((left, right) => left.updatedAt - right.updatedAt || left.roundId.localeCompare(right.roundId));
}

function snapshotPoints(stock: string, feed: string) {
  const snapshot = stockHistorySnapshot as unknown as {
    assets?: Record<string, { feed?: unknown; points?: unknown }>;
  };
  const asset = snapshot.assets?.[stock];
  if (!asset || typeof asset.feed !== "string" || asset.feed.toLowerCase() !== feed.toLowerCase()) return [];
  return parseHistoryPoints(asset.points, feed);
}

function mergeHistoryPoints(primary: ParsedHistoryPoint[], fallback: ParsedHistoryPoint[]) {
  const byRound = new Map<string, ParsedHistoryPoint>();
  for (const point of [...fallback, ...primary]) {
    const current = byRound.get(point.roundId);
    if (current && (current.priceE8 !== point.priceE8 || current.updatedAt !== point.updatedAt)) {
      return unavailable("Conflicting Chainlink history was returned for the Stock Token.");
    }
    byRound.set(point.roundId, point);
  }
  return [...byRound.values()].sort((left, right) => left.updatedAt - right.updatedAt || left.roundId.localeCompare(right.roundId));
}

function parseLivePoint(payload: unknown, stock: string, feed: string, now: number, heartbeat: number) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const point = (payload as LivePricePayload).prices?.[stock];
  if (!point || point.status !== "live" || point.oraclePaused !== false) return null;
  const price = priceE8(point.price);
  const updatedAt = positiveInteger(point.updatedAt);
  if (price === null || updatedAt === null
    || updatedAt > now + CLOCK_SKEW_SECONDS
    || now - updatedAt > heartbeat) return null;
  return {
    priceE8: price,
    updatedAt,
    sourceId: `chainlink-robinhood:${feed.toLowerCase()}:live:${updatedAt}`,
  } satisfies RagretPricePoint;
}

function freshestHistoryPoint(points: ParsedHistoryPoint[], now: number, heartbeat: number) {
  const candidates = points.filter((point) => point.updatedAt <= now + CLOCK_SKEW_SECONDS);
  const latest = candidates.at(-1);
  return latest && now - latest.updatedAt <= heartbeat ? latest : null;
}

function selectWindowStart(points: ParsedHistoryPoint[], end: RagretPricePoint) {
  const target = end.updatedAt - WINDOW_SECONDS;
  const candidates = points.filter((point) => point.updatedAt < end.updatedAt);
  const start = [...candidates].sort((left, right) => {
    const leftDistance = Math.abs(left.updatedAt - target);
    const rightDistance = Math.abs(right.updatedAt - target);
    return leftDistance - rightDistance
      || left.updatedAt - right.updatedAt
      || left.roundId.localeCompare(right.roundId);
  })[0];
  return start && Math.abs(start.updatedAt - target) <= MAX_WINDOW_DRIFT_SECONDS ? start : null;
}

async function directChainlinkWindow(
  feed: string,
  preferredEnd: RagretPricePoint | null,
  now: number,
  heartbeat: number,
  options: RagretSourceOptions,
) {
  const deadline = Date.now() + DIRECT_RPC_TOTAL_TIMEOUT_MS;
  const latestId = "latest";
  const latestRows = await directRpc([rpcRequest(latestId, feed, LATEST_ROUND_DATA)], options, deadline);
  const latest = decodeDirectPoint(latestRows.get(latestId), feed);
  if (!latest
    || latest.updatedAt > now + CLOCK_SKEW_SECONDS
    || now - latest.updatedAt > heartbeat) return null;

  let end: RagretPricePoint = preferredEnd ?? latest;
  if (preferredEnd) {
    if (latest.updatedAt + CLOCK_SKEW_SECONDS < preferredEnd.updatedAt) return null;
    if (latest.updatedAt === preferredEnd.updatedAt && latest.priceE8 === preferredEnd.priceE8) end = latest;
  }
  const target = end.updatedAt - WINDOW_SECONDS;
  if (latest.updatedAt <= target) return null;

  const bracketRequests = DIRECT_RPC_BRACKET_STEPS.flatMap((step) => {
    const roundId = BigInt(latest.roundId) - step;
    return roundId > 0n
      ? [rpcRequest(`step:${step}`, feed, getRoundData(roundId))]
      : [];
  });
  const bracketRows = await directRpc(bracketRequests, options, deadline);
  let upper = latest;
  let lower: ParsedHistoryPoint | null = null;
  for (const step of DIRECT_RPC_BRACKET_STEPS) {
    const expectedRoundId = BigInt(latest.roundId) - step;
    if (expectedRoundId <= 0n) continue;
    const point = decodeDirectPoint(bracketRows.get(`step:${step}`), feed, expectedRoundId);
    if (!point) continue;
    if (point.updatedAt > upper.updatedAt || BigInt(point.roundId) >= BigInt(upper.roundId)) return null;
    if (point.updatedAt <= target) {
      lower = point;
      break;
    }
    upper = point;
  }
  if (!lower) return null;

  for (let step = 0; step < DIRECT_RPC_MAX_BINARY_STEPS; step += 1) {
    const lowerId = BigInt(lower.roundId);
    const upperId = BigInt(upper.roundId);
    if (upperId - lowerId <= 1n) break;
    const midpoint = lowerId + (upperId - lowerId) / 2n;
    const point = await readDirectRound(midpoint, feed, options, deadline);
    if (!point || point.updatedAt < lower.updatedAt || point.updatedAt > upper.updatedAt) return null;
    if (point.updatedAt <= target) lower = point;
    else upper = point;
  }

  const start = [lower, upper]
    .filter((point) => point.updatedAt < end.updatedAt)
    .sort((left, right) => Math.abs(left.updatedAt - target) - Math.abs(right.updatedAt - target)
      || left.updatedAt - right.updatedAt
      || left.roundId.localeCompare(right.roundId))[0];
  if (!start || Math.abs(start.updatedAt - target) > MAX_WINDOW_DRIFT_SECONDS) return null;
  return { start, end };
}

async function historyFromApi(stock: string, feed: string, origin: string, options: RagretSourceOptions) {
  const url = new URL("/api/history", origin);
  url.searchParams.set("ticker", stock);
  const payload = await fetchJson(url, options);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const history = payload as HistoryPayload;
  if (history.ticker !== stock
    || typeof history.feed !== "string"
    || history.feed.toLowerCase() !== feed.toLowerCase()) return [];
  return parseHistoryPoints(history.points, feed);
}

async function liveFromApi(stock: string, feed: string, origin: string, options: RagretSourceOptions, now: number, heartbeat: number) {
  const payload = await fetchJson(new URL("/api/prices", origin), options);
  return parseLivePoint(payload, stock, feed, now, heartbeat);
}

export async function resolveStockRollingWindow(
  stock: string,
  options: RagretSourceOptions,
): Promise<RagretStockWindow> {
  assertServerOnly();
  try {
    const normalizedStock = stock.trim().toUpperCase();
    const config = ROBINHOOD_PRICE_FEEDS[normalizedStock as keyof typeof ROBINHOOD_PRICE_FEEDS];
    if (!config?.feed) return unavailable("The Stock Token does not have a supported Chainlink feed.");
    const origin = normalizeOrigin(options.origin);
    const now = currentTime(options);
    const fallback = snapshotPoints(normalizedStock, config.feed);
    const [liveResult, historyResult] = await Promise.allSettled([
      liveFromApi(normalizedStock, config.feed, origin, options, now, config.heartbeat),
      historyFromApi(normalizedStock, config.feed, origin, options),
    ]);
    const primaryHistory = historyResult.status === "fulfilled" ? historyResult.value : [];
    const history = mergeHistoryPoints(primaryHistory, fallback);
    const live = liveResult.status === "fulfilled" ? liveResult.value : null;
    const fallbackEnd = freshestHistoryPoint(history, now, config.heartbeat);
    const unresolvedEnd = live ?? fallbackEnd;
    const matchingRound = unresolvedEnd
      ? history.find((point) => point.updatedAt === unresolvedEnd.updatedAt && point.priceE8 === unresolvedEnd.priceE8)
      : null;
    let stockEnd = matchingRound ?? unresolvedEnd;
    let stockStart = stockEnd ? selectWindowStart(history, stockEnd) : null;
    if (!stockStart) {
      const direct = await directChainlinkWindow(config.feed, stockEnd, now, config.heartbeat, options);
      stockStart = direct?.start ?? null;
      stockEnd = direct?.end ?? stockEnd;
    }
    if (!stockEnd) return unavailable("A fresh Chainlink observation is unavailable for the Stock Token.");
    if (!stockStart) return unavailable("A comparable 24-hour Chainlink round is unavailable for the Stock Token.");
    return {
      stockName: getSeoAsset(normalizedStock)?.name ?? normalizedStock,
      stockStart,
      stockEnd,
    };
  } catch (error) {
    if (error instanceof RagretDataUnavailableError) throw error;
    throw new RagretDataUnavailableError("The Stock Token 24-hour Chainlink window is unavailable.");
  }
}

function exactCommunityMarket(payload: unknown, address: string, now: number) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return unavailable("The community-token market response is invalid.");
  }
  const response = payload as CommunityPayload;
  if (!Array.isArray(response.markets)) return unavailable("The community-token market response is invalid.");
  const matches = response.markets.filter((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const candidate = (raw as CommunityMarketPayload).address;
    return typeof candidate === "string" && candidate.toLowerCase() === address;
  }) as CommunityMarketPayload[];
  if (matches.length !== 1) return unavailable("The exact community-token market could not be resolved.");

  const market = matches[0];
  if (market.canonical === true || market.category === "RWA") {
    return unavailable("The selected address is not a community token.");
  }
  const name = typeof market.name === "string" ? market.name.trim() : "";
  const symbol = typeof market.symbol === "string" ? market.symbol.trim().toUpperCase() : "";
  const changePct = finiteNumber(market.priceChange24h);
  const liquidityUsd = finiteNumber(market.liquidityUsd);
  const lifecycle = typeof market.lifecycle === "string" ? market.lifecycle.trim() : "";
  const pairUrl = typeof market.pairUrl === "string" && market.pairUrl.trim()
    ? market.pairUrl.trim()
    : typeof market.externalUrl === "string" ? market.externalUrl.trim() : "";
  const updatedAtMs = positiveInteger(response.updatedAt);
  if (!name || !symbol || changePct === null || liquidityUsd === null || liquidityUsd < 0
    || !lifecycle || updatedAtMs === null) {
    return unavailable("The exact community token does not have a complete 24-hour market snapshot.");
  }
  const observedAt = Math.floor(updatedAtMs / 1_000);
  if (observedAt > now + CLOCK_SKEW_SECONDS || now - observedAt > MAX_COMMUNITY_OBSERVATION_AGE_SECONDS) {
    return unavailable("The community-token 24-hour market snapshot is stale.");
  }
  const returnBps = Math.round(changePct * 100);
  if (!Number.isSafeInteger(returnBps) || returnBps <= -10_000 || returnBps > MAX_COMMUNITY_RETURN_BPS) {
    return unavailable("The community-token 24-hour move is outside supported bounds.");
  }
  return {
    address,
    name,
    symbol,
    returnBps,
    liquidityUsd,
    lifecycle,
    pairUrl,
    observedAt,
  } satisfies RagretCommunitySnapshot;
}

export async function resolveCommunitySnapshot(
  communityAddress: string,
  options: RagretSourceOptions,
): Promise<RagretCommunitySnapshot> {
  assertServerOnly();
  try {
    const address = communityAddress.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      return unavailable("The community-token address is invalid.");
    }
    const origin = normalizeOrigin(options.origin);
    const now = currentTime(options);
    const url = new URL("/api/community-markets", origin);
    url.searchParams.set("token", address);
    const payload = await fetchJson(url, options);
    return exactCommunityMarket(payload, address, now);
  } catch (error) {
    if (error instanceof RagretDataUnavailableError) throw error;
    throw new RagretDataUnavailableError("The exact community-token 24-hour move is unavailable.");
  }
}

export async function resolveRagretScenarioSources(
  request: RagretScenarioRequest,
  options: RagretSourceOptions,
): Promise<Omit<RagretScenarioInput, "request">> {
  assertServerOnly();
  try {
    const generatedAt = currentTime(options);
    const [stock, community] = await Promise.all([
      resolveStockRollingWindow(request.stock, options),
      resolveCommunitySnapshot(request.communityAddress, options),
    ]);
    return {
      ...stock,
      community,
      generatedAt,
    };
  } catch (error) {
    if (error instanceof RagretDataUnavailableError) throw error;
    throw new RagretDataUnavailableError("The RAGRET market sources are unavailable.");
  }
}
