import robinhoodMainnet from "@/config/robinhood-mainnet.json";
import {
  CHAINLINK_ROBINHOOD_FEED_SOURCE,
  ROBINHOOD_PRICE_FEEDS,
  type RobinhoodPriceTicker,
} from "@/config/robinhood-price-feeds";
import { decodeBoolean, decodeLatestRoundData, scalePrice } from "@/lib/chainlink";

export const PUBLIC_ROBINHOOD_PRICE_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";

const LATEST_ROUND_DATA = "0xfeaf968c";
const ORACLE_PAUSED = "0x7706ba52";
const FEED_DECIMALS = 8;

export type PriceStatus = "live" | "stale" | "paused" | "unavailable";

export type PricePoint = {
  price: number | null;
  updatedAt: number | null;
  ageSeconds: number | null;
  heartbeat: number;
  oraclePaused: boolean | null;
  status: PriceStatus;
};

export type PriceResponse = {
  chainId: number;
  source: string;
  sourceUrl: string;
  priceMeaning: string;
  fetchedAt: string;
  availableCount: number;
  liveCount: number;
  prices: Record<RobinhoodPriceTicker, PricePoint>;
};

export type PriceRpcRequest = {
  jsonrpc: "2.0";
  id: string;
  method: "eth_call";
  params: [{ to: string; data: string }, "latest"];
};

export type PriceRpcResult = {
  id: string;
  result?: string;
  error?: { message?: string };
};

function feedEntries() {
  return Object.entries(ROBINHOOD_PRICE_FEEDS) as Array<
    [RobinhoodPriceTicker, (typeof ROBINHOOD_PRICE_FEEDS)[RobinhoodPriceTicker]]
  >;
}

export function buildRobinhoodPriceRequests(): PriceRpcRequest[] {
  return feedEntries().flatMap(([ticker, config]) => {
    const token = robinhoodMainnet.tokens[ticker];
    const calls: PriceRpcRequest[] = [{
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
}

export function parseRobinhoodPriceResults(payload: unknown, now = Math.floor(Date.now() / 1_000)): PriceResponse {
  if (!Array.isArray(payload)) throw new Error("Price RPC returned a non-batch response");
  const results = payload as PriceRpcResult[];
  const byId = new Map(results.filter((item) => item && typeof item.id === "string").map((item) => [item.id, item]));
  const prices = Object.fromEntries(feedEntries().map(([ticker, config]) => {
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
    else if (roundValid && pauseResult === false && ageSeconds !== null && ageSeconds > config.heartbeat) status = "stale";
    else if (roundValid && pauseResult === false) status = "live";

    return [ticker, {
      price: roundValid ? price : null,
      updatedAt: roundValid && round ? round.updatedAt : null,
      ageSeconds,
      heartbeat: config.heartbeat,
      oraclePaused: pauseResult,
      status,
    } satisfies PricePoint];
  })) as Record<RobinhoodPriceTicker, PricePoint>;
  const values = Object.values(prices);

  if (!values.some((item) => item.price !== null || item.oraclePaused !== null)) {
    throw new Error("Price RPC returned no usable results");
  }

  return {
    chainId: 4_663,
    source: "Chainlink Data Feeds on Robinhood Chain",
    sourceUrl: CHAINLINK_ROBINHOOD_FEED_SOURCE,
    priceMeaning: "Multiplier-adjusted onchain token price, not the underlying headline share price",
    fetchedAt: new Date(now * 1_000).toISOString(),
    availableCount: values.filter((item) => item.price !== null).length,
    liveCount: values.filter((item) => item.status === "live").length,
    prices,
  };
}
