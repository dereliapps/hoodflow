import { NextResponse } from "next/server";

import {
  buildRobinhoodPriceRequests,
  parseRobinhoodPriceResults,
  PUBLIC_ROBINHOOD_PRICE_RPC_URL,
  type PriceResponse,
  type PriceRpcRequest,
  type PriceRpcResult,
} from "@/lib/robinhood-prices";

const REQUEST_TIMEOUT_MS = 3_500;
const PRICE_BATCH_SIZE = 8;
const MAX_RPC_ATTEMPTS = 3;
const GOOD_CACHE_TTL_MS = 30_000;

let lastGoodResponse: PriceResponse | null = null;
let lastGoodResponseAt = 0;

function chunkRequests<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size));
}

function resultIsUsable(result: PriceRpcResult | undefined) {
  return Boolean(result?.result && !result.error);
}

async function requestBatch(batch: PriceRpcRequest[]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(process.env.ROBINHOOD_PRICE_RPC_URL || PUBLIC_ROBINHOOD_PRICE_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(batch),
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload) ? payload as PriceRpcResult[] : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function readPriceRpc(requests: PriceRpcRequest[]) {
  const collected = new Map<string, PriceRpcResult>();
  for (let attempt = 0; attempt < MAX_RPC_ATTEMPTS; attempt += 1) {
    const remaining = requests.filter((request) => !resultIsUsable(collected.get(request.id)));
    if (remaining.length === 0) break;
    const responses = await Promise.all(chunkRequests(remaining, PRICE_BATCH_SIZE).map(requestBatch));
    responses.flat().forEach((result) => {
      if (result && typeof result.id === "string" && resultIsUsable(result)) collected.set(result.id, result);
    });
    if (attempt < MAX_RPC_ATTEMPTS - 1 && collected.size < requests.length) {
      await new Promise((resolve) => setTimeout(resolve, 140 * (attempt + 1)));
    }
  }
  return [...collected.values()];
}

export async function GET() {
  try {
    const requests = buildRobinhoodPriceRequests();
    const payload = await readPriceRpc(requests);
    if (payload.length === 0) throw new Error("Price RPC returned no usable batches");

    const current = parseRobinhoodPriceResults(payload);
    if (current.liveCount >= 15) {
      lastGoodResponse = current;
      lastGoodResponseAt = Date.now();
    }
    const response = current.liveCount < 15
      && lastGoodResponse
      && Date.now() - lastGoodResponseAt <= GOOD_CACHE_TTL_MS
      ? lastGoodResponse
      : current;

    return NextResponse.json(response, {
      headers: {
        "cache-control": "public, max-age=3, s-maxage=3, stale-while-revalidate=12",
      },
    });
  } catch {
    if (lastGoodResponse && Date.now() - lastGoodResponseAt <= GOOD_CACHE_TTL_MS) {
      return NextResponse.json(lastGoodResponse, {
        headers: { "cache-control": "public, max-age=2, s-maxage=2, stale-while-revalidate=8" },
      });
    }
    return NextResponse.json({
      chainId: 4_663,
      source: "Chainlink Data Feeds on Robinhood Chain",
      sourceUrl: "https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood",
      fetchedAt: new Date().toISOString(),
      availableCount: 0,
      liveCount: 0,
      prices: {},
      error: "Live onchain prices are temporarily unavailable",
    }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
