import { NextResponse } from "next/server";

import {
  buildRobinhoodPriceRequests,
  parseRobinhoodPriceResults,
  PUBLIC_ROBINHOOD_PRICE_RPC_URL,
} from "@/lib/robinhood-prices";

const REQUEST_TIMEOUT_MS = 8_000;
const PRICE_BATCH_SIZE = 8;

function chunkRequests<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size));
}

export async function GET() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const requests = buildRobinhoodPriceRequests();
    const payload: unknown[] = [];
    try {
      for (const batch of chunkRequests(requests, PRICE_BATCH_SIZE)) {
        try {
          const response = await fetch(process.env.ROBINHOOD_PRICE_RPC_URL || PUBLIC_ROBINHOOD_PRICE_RPC_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(batch),
            signal: controller.signal,
          });
          if (!response.ok) continue;
          const batchPayload = await response.json();
          if (Array.isArray(batchPayload)) payload.push(...batchPayload);
        } catch (error) {
          if (controller.signal.aborted) throw error;
        }
      }
    } finally {
      clearTimeout(timeout);
    }
    if (payload.length === 0) throw new Error("Price RPC returned no usable batches");

    return NextResponse.json(parseRobinhoodPriceResults(payload), {
      headers: {
        "cache-control": "public, max-age=5, s-maxage=5, stale-while-revalidate=15",
      },
    });
  } catch {
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
