import { NextResponse } from "next/server";

import robinhoodMainnet from "@/config/robinhood-mainnet.json";
import {
  CHAINLINK_ROBINHOOD_FEED_SOURCE,
  ROBINHOOD_PRICE_FEEDS,
  type RobinhoodPriceTicker,
} from "@/config/robinhood-price-feeds";
import { decodeBoolean, decodeLatestRoundData, scalePrice } from "@/lib/chainlink";

const PUBLIC_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
const LATEST_ROUND_DATA = "0xfeaf968c";
const ORACLE_PAUSED = "0x7706ba52";
const FEED_DECIMALS = 8;
const REQUEST_TIMEOUT_MS = 8_000;

type RpcResult = {
  id: string;
  result?: string;
  error?: { message?: string };
};

type PriceStatus = "live" | "stale" | "paused" | "unavailable";

export async function GET() {
  const now = Math.floor(Date.now() / 1_000);
  const entries = Object.entries(ROBINHOOD_PRICE_FEEDS) as Array<
    [RobinhoodPriceTicker, (typeof ROBINHOOD_PRICE_FEEDS)[RobinhoodPriceTicker]]
  >;
  const requests = entries.flatMap(([ticker, config]) => {
    const token = robinhoodMainnet.tokens[ticker];
    const calls = [{
      jsonrpc: "2.0",
      id: `paused:${ticker}`,
      method: "eth_call",
      params: [{ to: token, data: ORACLE_PAUSED }, "latest"],
    }];
    if (config.feed) {
      calls.push({
        jsonrpc: "2.0",
        id: `price:${ticker}`,
        method: "eth_call",
        params: [{ to: config.feed, data: LATEST_ROUND_DATA }, "latest"],
      });
    }
    return calls;
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const response = await fetch(process.env.ROBINHOOD_PRICE_RPC_URL || PUBLIC_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requests),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`Price RPC returned ${response.status}`);

    const results = await response.json() as RpcResult[];
    const byId = new Map(results.map((result) => [result.id, result]));
    const prices = Object.fromEntries(entries.map(([ticker, config]) => {
      const pauseResult = decodeBoolean(byId.get(`paused:${ticker}`)?.result);
      const round = decodeLatestRoundData(byId.get(`price:${ticker}`)?.result);
      const price = round ? scalePrice(round.answer, FEED_DECIMALS) : null;
      const roundValid = Boolean(
        round
        && round.roundId > 0n
        && round.updatedAt > 0
        && round.updatedAt <= now
        && round.answeredInRound >= round.roundId
        && price,
      );
      const ageSeconds = roundValid && round ? now - round.updatedAt : null;
      let status: PriceStatus = "unavailable";
      if (roundValid && pauseResult === true) status = "paused";
      else if (roundValid && ageSeconds !== null && ageSeconds > config.heartbeat) status = "stale";
      else if (roundValid) status = "live";

      return [ticker, {
        price: roundValid ? price : null,
        updatedAt: roundValid && round ? round.updatedAt : null,
        ageSeconds,
        heartbeat: config.heartbeat,
        oraclePaused: pauseResult,
        status,
      }];
    }));
    const values = Object.values(prices);

    return NextResponse.json({
      chainId: 4_663,
      source: "Chainlink Data Feeds on Robinhood Chain",
      sourceUrl: CHAINLINK_ROBINHOOD_FEED_SOURCE,
      priceMeaning: "Multiplier-adjusted onchain token price, not the underlying headline share price",
      fetchedAt: new Date(now * 1_000).toISOString(),
      availableCount: values.filter((item) => item.price !== null).length,
      liveCount: values.filter((item) => item.status === "live").length,
      prices,
    }, {
      headers: {
        "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=120",
      },
    });
  } catch {
    return NextResponse.json({
      chainId: 4_663,
      source: "Chainlink Data Feeds on Robinhood Chain",
      sourceUrl: CHAINLINK_ROBINHOOD_FEED_SOURCE,
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
