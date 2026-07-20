import { NextResponse } from "next/server";

import {
  ROBINHOOD_PRICE_FEEDS,
  type RobinhoodPriceTicker,
} from "@/config/robinhood-price-feeds";
import { decodeLatestRoundData, scalePrice } from "@/lib/chainlink";
import { PUBLIC_ROBINHOOD_PRICE_RPC_URL } from "@/lib/robinhood-prices";

const LATEST_ROUND_DATA = "0xfeaf968c";
const GET_ROUND_DATA = "0x9a6fc8f5";
const FEED_DECIMALS = 8;
const REQUEST_TIMEOUT_MS = 2_500;
const ROUND_COUNT = 32;
const HISTORY_CACHE_TTL_MS = 5 * 60_000;
const STALE_CACHE_TTL_MS = 24 * 60 * 60_000;

type RpcResult = {
  id: string;
  result?: string;
};

type HistoryPoint = {
  roundId: string;
  price: number;
  updatedAt: number;
};

type HistoryCacheEntry = {
  feed: string;
  points: HistoryPoint[];
  cachedAt: number;
};

const historyCache = new Map<RobinhoodPriceTicker, HistoryCacheEntry>();

function rpcCall(id: string, to: string, data: string) {
  return {
    jsonrpc: "2.0" as const,
    id,
    method: "eth_call" as const,
    params: [{ to, data }, "latest"] as const,
  };
}

async function postRpc(url: string, body: object | object[]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`History RPC returned ${response.status}`);
    return await response.json() as RpcResult | RpcResult[];
  } finally {
    clearTimeout(timeout);
  }
}

async function readHistory(rpcUrl: string, ticker: RobinhoodPriceTicker, feed: string) {
  const latestPayload = await postRpc(rpcUrl, rpcCall(`latest:${ticker}`, feed, LATEST_ROUND_DATA));
  if (Array.isArray(latestPayload)) throw new Error("Latest round returned a batch");
  const latest = decodeLatestRoundData(latestPayload.result);
  if (!latest) throw new Error("Latest Chainlink round could not be decoded");

  const requests = Array.from({ length: ROUND_COUNT }, (_, index) => {
    const roundId = latest.roundId - BigInt(index);
    return rpcCall(roundId.toString(), feed, `${GET_ROUND_DATA}${roundId.toString(16).padStart(64, "0")}`);
  });
  const payload = await postRpc(rpcUrl, requests);
  if (!Array.isArray(payload)) throw new Error("History RPC returned a non-batch response");

  const points = payload.flatMap((item) => {
    const round = decodeLatestRoundData(item.result);
    const price = round ? scalePrice(round.answer, FEED_DECIMALS) : null;
    if (!round || !price || round.updatedAt <= 0) return [];
    return [{ roundId: round.roundId.toString(), price, updatedAt: round.updatedAt }];
  }).sort((left, right) => left.updatedAt - right.updatedAt);
  if (points.length < 2) throw new Error("History RPC returned fewer than two rounds");
  return points;
}

function historyResponse(ticker: RobinhoodPriceTicker, entry: HistoryCacheEntry, cacheState: "fresh" | "stale" | "miss") {
  return NextResponse.json({
    ticker,
    feed: entry.feed,
    points: entry.points,
    fetchedAt: new Date(entry.cachedAt).toISOString(),
    cacheState,
  }, {
    headers: {
      "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
      "x-hoodflow-history": cacheState,
    },
  });
}

export async function GET(request: Request) {
  const ticker = new URL(request.url).searchParams.get("ticker")?.toUpperCase() as RobinhoodPriceTicker | undefined;
  if (!ticker || !(ticker in ROBINHOOD_PRICE_FEEDS)) {
    return NextResponse.json({ error: "Unknown Robinhood asset" }, { status: 400 });
  }

  const feed = ROBINHOOD_PRICE_FEEDS[ticker].feed;
  if (!feed) {
    return NextResponse.json({ ticker, points: [], error: "No Chainlink feed is listed for this asset" }, {
      headers: { "cache-control": "public, max-age=60, s-maxage=300" },
    });
  }

  const cached = historyCache.get(ticker);
  if (cached && Date.now() - cached.cachedAt <= HISTORY_CACHE_TTL_MS) {
    return historyResponse(ticker, cached, "fresh");
  }

  const rpcUrls = [process.env.ROBINHOOD_PRICE_RPC_URL, PUBLIC_ROBINHOOD_PRICE_RPC_URL]
    .filter((url): url is string => Boolean(url))
    .filter((url, index, all) => all.indexOf(url) === index);

  try {
    const points = await Promise.any(rpcUrls.map((rpcUrl) => readHistory(rpcUrl, ticker, feed)));
    const entry = { feed, points, cachedAt: Date.now() };
    historyCache.set(ticker, entry);
    return historyResponse(ticker, entry, "miss");
  } catch {
    if (cached && Date.now() - cached.cachedAt <= STALE_CACHE_TTL_MS) {
      return historyResponse(ticker, cached, "stale");
    }
    return NextResponse.json({ ticker, points: [], error: "Onchain price history is temporarily unavailable" }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
