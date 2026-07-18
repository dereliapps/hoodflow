import { NextResponse } from "next/server";

import {
  buildRobinhoodPriceRequests,
  parseRobinhoodPriceResults,
  PUBLIC_ROBINHOOD_PRICE_RPC_URL,
} from "@/lib/robinhood-prices";

const REQUEST_TIMEOUT_MS = 8_000;

export async function GET() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(process.env.ROBINHOOD_PRICE_RPC_URL || PUBLIC_ROBINHOOD_PRICE_RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildRobinhoodPriceRequests()),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`Price RPC returned ${response.status}`);

    return NextResponse.json(parseRobinhoodPriceResults(await response.json()), {
      headers: {
        "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=120",
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
