import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { Interface } from "ethers";

import {
  ROBINHOOD_PRICE_FEEDS,
  type RobinhoodPriceTicker,
} from "../config/robinhood-price-feeds";
import { decodeLatestRoundData, scalePrice } from "../lib/chainlink";

const BLOCKSCOUT_RPC_URL = "https://robinhoodchain.blockscout.com/api/eth-rpc";
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
const LATEST_ROUND_DATA = "0xfeaf968c";
const GET_ROUND_DATA = "0x9a6fc8f5";
const FEED_DECIMALS = 8;
const ROUND_COUNT = 32;
const PARALLEL_REQUESTS = 6;
const REQUEST_TIMEOUT_MS = 30_000;
const OUTPUT_PATH = resolve("generated/stock-price-history.json");
const multicallInterface = new Interface([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)",
]);

type RpcResult = { id: string; result?: string };
type MulticallResult = { success: boolean; returnData: string };

function rpcCall(id: string, to: string, data: string) {
  return {
    jsonrpc: "2.0" as const,
    id,
    method: "eth_call" as const,
    params: [{ to, data }, "latest"] as const,
  };
}

async function postRpc(body: ReturnType<typeof rpcCall>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(BLOCKSCOUT_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Blockscout RPC returned ${response.status}`);
    return await response.json() as RpcResult;
  } finally {
    clearTimeout(timeout);
  }
}

async function multicall(id: string, calls: Array<{ target: string; callData: string }>) {
  const data = multicallInterface.encodeFunctionData("aggregate3", [calls.map((call) => ({ ...call, allowFailure: true }))]);
  const payload = await postRpc(rpcCall(id, MULTICALL3_ADDRESS, data));
  if (!payload.result) throw new Error(`Multicall ${id} returned no result`);
  const decoded = multicallInterface.decodeFunctionResult("aggregate3", payload.result);
  return Array.from(decoded[0] as unknown as Array<{ success: boolean; returnData: string }>).map((item) => ({
    success: Boolean(item.success),
    returnData: String(item.returnData),
  })) satisfies MulticallResult[];
}

function chunk<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

async function main() {
  const entries = Object.entries(ROBINHOOD_PRICE_FEEDS)
    .filter((entry): entry is [RobinhoodPriceTicker, { feed: string; heartbeat: number }] => Boolean(entry[1].feed));
  const latestResults = await multicall("latest-rounds", entries.map(([, config]) => ({
    target: config.feed,
    callData: LATEST_ROUND_DATA,
  })));
  const latestByTicker = new Map(entries.flatMap(([ticker], index) => {
    const item = latestResults[index];
    const round = item?.success ? decodeLatestRoundData(item.returnData) : null;
    return round ? [[ticker, round] as const] : [];
  }));

  const assets: Record<string, { feed: string; points: Array<{ roundId: string; price: number; updatedAt: number }> }> = {};
  for (const group of chunk(entries, PARALLEL_REQUESTS)) {
    const payloads = await Promise.all(group.map(async ([ticker, config]) => {
      const latest = latestByTicker.get(ticker);
      if (!latest) return [ticker, config.feed, []] as const;
      const requests = Array.from({ length: ROUND_COUNT }, (_, index) => {
        const roundId = latest.roundId - BigInt(index);
        return {
          target: config.feed,
          callData: `${GET_ROUND_DATA}${roundId.toString(16).padStart(64, "0")}`,
        };
      });
      const results = await multicall(`history:${ticker}`, requests);
      const points = results.flatMap((item) => {
        const round = item.success ? decodeLatestRoundData(item.returnData) : null;
        const price = round ? scalePrice(round.answer, FEED_DECIMALS) : null;
        if (!round || !price || round.updatedAt <= 0) return [];
        return [{ roundId: round.roundId.toString(), price, updatedAt: round.updatedAt }];
      }).sort((left, right) => left.updatedAt - right.updatedAt);
      return [ticker, config.feed, points] as const;
    }));
    payloads.forEach(([ticker, feed, points]) => {
      if (points.length >= 2) assets[ticker] = { feed, points };
    });
  }

  if (Object.keys(assets).length < 20) throw new Error(`Only ${Object.keys(assets).length} asset histories were generated`);
  const output = {
    chainId: 4_663,
    source: "Chainlink Data Feeds on Robinhood Chain",
    generatedAt: new Date().toISOString(),
    assets,
  };
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output)}\n`, "utf8");
  console.log(`Generated ${Object.keys(assets).length} asset histories at ${OUTPUT_PATH}`);
}

await main();
