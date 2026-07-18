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
const REQUEST_TIMEOUT_MS = 8_000;
const ROUND_COUNT = 32;
const HISTORY_BATCH_SIZE = 8;

type RpcResult = {
  id: string;
  result?: string;
};

function rpcCall(id: string, to: string, data: string) {
  return {
    jsonrpc: "2.0" as const,
    id,
    method: "eth_call" as const,
    params: [{ to, data }, "latest"] as const,
  };
}

function chunkRequests<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size));
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

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const rpcUrl = process.env.ROBINHOOD_PRICE_RPC_URL || PUBLIC_ROBINHOOD_PRICE_RPC_URL;
    let latestPayload: RpcResult;
    try {
      const latestResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(rpcCall(`latest:${ticker}`, feed, LATEST_ROUND_DATA)),
        signal: controller.signal,
      });
      if (!latestResponse.ok) throw new Error(`Price RPC returned ${latestResponse.status}`);
      latestPayload = await latestResponse.json() as RpcResult;
    } finally {
      clearTimeout(timeout);
    }

    const latest = decodeLatestRoundData(latestPayload.result);
    if (!latest) throw new Error("Latest Chainlink round could not be decoded");

    const requests = Array.from({ length: ROUND_COUNT }, (_, index) => {
      const roundId = latest.roundId - BigInt(index);
      const encodedRound = roundId.toString(16).padStart(64, "0");
      return rpcCall(roundId.toString(), feed, `${GET_ROUND_DATA}${encodedRound}`);
    });
    const historyController = new AbortController();
    const historyTimeout = setTimeout(() => historyController.abort(), REQUEST_TIMEOUT_MS);
    const historyPayload: RpcResult[] = [];
    try {
      for (const batch of chunkRequests(requests, HISTORY_BATCH_SIZE)) {
        try {
          const historyResponse = await fetch(rpcUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(batch),
            signal: historyController.signal,
          });
          if (!historyResponse.ok) continue;
          const batchPayload = await historyResponse.json();
          if (Array.isArray(batchPayload)) historyPayload.push(...batchPayload as RpcResult[]);
        } catch (error) {
          if (historyController.signal.aborted) throw error;
        }
      }
    } finally {
      clearTimeout(historyTimeout);
    }
    if (historyPayload.length === 0) throw new Error("History RPC returned no usable batches");

    const points = historyPayload.flatMap((item) => {
      const round = decodeLatestRoundData(item.result);
      const price = round ? scalePrice(round.answer, FEED_DECIMALS) : null;
      if (!round || !price || round.updatedAt <= 0) return [];
      return [{ roundId: round.roundId.toString(), price, updatedAt: round.updatedAt }];
    }).sort((left, right) => left.updatedAt - right.updatedAt);

    return NextResponse.json({
      ticker,
      feed,
      points,
      fetchedAt: new Date().toISOString(),
    }, {
      headers: { "cache-control": "public, max-age=30, s-maxage=120, stale-while-revalidate=600" },
    });
  } catch {
    return NextResponse.json({ ticker, points: [], error: "Onchain price history is temporarily unavailable" }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
