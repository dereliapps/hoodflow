import assert from "node:assert/strict";
import test from "node:test";

import { ROBINHOOD_PRICE_FEEDS } from "../config/robinhood-price-feeds.js";
import {
  RAGRET_FORMULA_VERSION,
  RagretDataUnavailableError,
  RagretValidationError,
  calculateRagretScenario,
  parseRagretScenarioRequest,
  type RagretScenarioInput,
} from "../lib/ragret.js";
import { resolveStockRollingWindow } from "../lib/ragret-sources.js";

const COMMUNITY_ADDRESS = "0xb47f4702deb124cb4eb6286be83c9d84277c6239";
const WINDOW_START = 1_800_000_000;
const WINDOW_END = WINDOW_START + 86_400;

function scenarioInput(overrides: Partial<RagretScenarioInput> = {}): RagretScenarioInput {
  return {
    request: parseRagretScenarioRequest({
      stock: "AAPL",
      communityAddress: COMMUNITY_ADDRESS,
      notionalUsdg: "100.00",
    }),
    stockName: "Apple Stock Token",
    stockStart: {
      priceE8: 10_000_000_000n,
      updatedAt: WINDOW_START,
      sourceId: "chainlink:aapl:start",
    },
    stockEnd: {
      priceE8: 12_000_000_000n,
      updatedAt: WINDOW_END,
      sourceId: "chainlink:aapl:end",
    },
    community: {
      address: COMMUNITY_ADDRESS,
      name: "Karma by Virtuals",
      symbol: "KARMA",
      returnBps: 500,
      liquidityUsd: 125_000,
      lifecycle: "graduated",
      pairUrl: "https://www.geckoterminal.com/robinhood/pools/0x1111111111111111111111111111111111111111",
      observedAt: WINDOW_END,
    },
    generatedAt: WINDOW_END + 60,
    ...overrides,
  };
}

test("parses and canonicalizes a bounded RAGRET scenario request", () => {
  assert.deepEqual(parseRagretScenarioRequest({
    stock: " aapl ",
    communityAddress: " 0xB47F4702DEB124CB4EB6286BE83C9D84277C6239 ",
    notionalUsdg: "250.5",
  }), {
    stock: "AAPL",
    communityAddress: COMMUNITY_ADDRESS,
    notionalUsdg: "250.5",
  });

  assert.throws(() => parseRagretScenarioRequest(null), RagretValidationError);
  assert.throws(() => parseRagretScenarioRequest({ stock: "BE", communityAddress: COMMUNITY_ADDRESS, notionalUsdg: "10" }), RagretValidationError);
  assert.throws(() => parseRagretScenarioRequest({ stock: "AAPL", communityAddress: "not-an-address", notionalUsdg: "10" }), RagretValidationError);
  assert.throws(() => parseRagretScenarioRequest({ stock: "AAPL", communityAddress: COMMUNITY_ADDRESS, notionalUsdg: "0" }), RagretValidationError);
  assert.throws(() => parseRagretScenarioRequest({ stock: "AAPL", communityAddress: COMMUNITY_ADDRESS, notionalUsdg: "10.001" }), RagretValidationError);
  assert.throws(() => parseRagretScenarioRequest({ stock: "AAPL", communityAddress: COMMUNITY_ADDRESS, notionalUsdg: "1000000" }), RagretValidationError);
});

test("calculates the scenario gap, verdict, severity, and disclosure flags", () => {
  const receipt = calculateRagretScenario(scenarioInput());

  assert.equal(receipt.formulaVersion, RAGRET_FORMULA_VERSION);
  assert.equal(receipt.status, "scenario-receipt");
  assert.equal(receipt.scenario, true);
  assert.equal(receipt.transactionProof, false);
  assert.equal(receipt.requiresUserSignature, false);
  assert.equal(receipt.verdict, "RAGRET");
  assert.equal(receipt.severity, "scar");
  assert.equal(receipt.winner, "AAPL");
  assert.equal(receipt.notionalUsdg, "100.00");
  assert.equal(receipt.windowHours, 24);
  assert.equal(receipt.stock.startPriceUsd, "100");
  assert.equal(receipt.stock.endPriceUsd, "120");
  assert.equal(receipt.stock.returnBps, 2_000);
  assert.equal(receipt.stock.scenarioValueUsdg, "120.00");
  assert.equal(receipt.community.returnBps, 500);
  assert.equal(receipt.community.scenarioValueUsdg, "105.00");
  assert.deepEqual(receipt.gap, {
    signedUsdg: "15.00",
    absoluteUsdg: "15.00",
    returnBps: 1_500,
    returnPct: "15.00",
  });
  assert.match(receipt.receiptId, /^hf-ragret-[a-f0-9]{16}$/);
  assert.match(receipt.shareText, /Scenario only\. Not a transaction receipt or financial advice\./);
  assert.equal(receipt.methodology.notice, "SCENARIO ONLY - NOT A TRANSACTION RECEIPT");
  assert.deepEqual(receipt.methodology.excludes, ["fees", "slippage", "taxes", "wallet activity", "execution feasibility"]);
});

test("distinguishes NO_RAGRETS and EVEN without changing the scenario flags", () => {
  const noRagrets = calculateRagretScenario(scenarioInput({
    stockEnd: {
      priceE8: 9_000_000_000n,
      updatedAt: WINDOW_END,
      sourceId: "chainlink:aapl:end",
    },
    community: {
      ...scenarioInput().community,
      returnBps: 5_000,
    },
  }));
  assert.equal(noRagrets.verdict, "NO_RAGRETS");
  assert.equal(noRagrets.severity, "legendary");
  assert.equal(noRagrets.winner, "KARMA");
  assert.equal(noRagrets.gap.signedUsdg, "-60.00");
  assert.equal(noRagrets.transactionProof, false);

  const even = calculateRagretScenario(scenarioInput({
    stockEnd: {
      priceE8: 10_500_000_000n,
      updatedAt: WINDOW_END,
      sourceId: "chainlink:aapl:end",
    },
  }));
  assert.equal(even.verdict, "EVEN");
  assert.equal(even.severity, "paper-cut");
  assert.equal(even.winner, "NEITHER");
  assert.equal(even.gap.signedUsdg, "0.00");
  assert.equal(even.scenario, true);
});

test("keeps the receipt identity and share facts deterministic", () => {
  const input = scenarioInput();
  const first = calculateRagretScenario(input);
  const repeated = calculateRagretScenario(input);
  assert.deepEqual(repeated, first);

  const presentationOnlyChanges = calculateRagretScenario(scenarioInput({
    stockName: "Different presentation name",
    community: {
      ...input.community,
      name: "Different presentation name",
      liquidityUsd: 999_999,
      pairUrl: "https://example.com/a-different-presentation-link",
      observedAt: WINDOW_END + 300,
    },
    generatedAt: WINDOW_END + 600,
  }));
  assert.equal(presentationOnlyChanges.receiptId, first.receiptId);
  assert.equal(presentationOnlyChanges.shareText, first.shareText);
  assert.deepEqual(presentationOnlyChanges.gap, first.gap);
  assert.equal(presentationOnlyChanges.stock.scenarioValueUsdg, first.stock.scenarioValueUsdg);
  assert.equal(presentationOnlyChanges.community.scenarioValueUsdg, first.community.scenarioValueUsdg);
});

test("fails closed when a comparison window or provider return is unusable", () => {
  assert.throws(() => calculateRagretScenario(scenarioInput({
    stockEnd: {
      priceE8: 0n,
      updatedAt: WINDOW_END,
      sourceId: "chainlink:aapl:end",
    },
  })), RagretDataUnavailableError);
  assert.throws(() => calculateRagretScenario(scenarioInput({
    stockEnd: {
      priceE8: 12_000_000_000n,
      updatedAt: WINDOW_START,
      sourceId: "chainlink:aapl:end",
    },
  })), RagretDataUnavailableError);
  assert.throws(() => calculateRagretScenario(scenarioInput({
    community: {
      ...scenarioInput().community,
      returnBps: -10_000,
    },
  })), RagretDataUnavailableError);
  assert.throws(() => calculateRagretScenario(scenarioInput({
    community: {
      ...scenarioInput().community,
      returnBps: 1_000_001,
    },
  })), RagretDataUnavailableError);
  assert.throws(() => calculateRagretScenario(scenarioInput({
    community: {
      ...scenarioInput().community,
      returnBps: 1.5,
    },
  })), RagretDataUnavailableError);
});

function encodedRound(roundId: bigint, answer: bigint, updatedAt: number) {
  return `0x${[roundId, answer, BigInt(updatedAt), BigInt(updatedAt), roundId]
    .map((word) => word.toString(16).padStart(64, "0"))
    .join("")}`;
}

test("finds a bounded public-RPC round when the bundled history cannot cover 24 hours", async () => {
  const now = 1_800_000_000;
  const latestRoundId = 1_000n;
  const feed = ROBINHOOD_PRICE_FEEDS.AAPL.feed;
  assert.ok(feed);
  let rpcCalls = 0;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/api/prices")) {
      return Response.json({ prices: { AAPL: { price: 120, updatedAt: now, oraclePaused: false, status: "live" } } });
    }
    if (url.includes("/api/history")) {
      return Response.json({ ticker: "AAPL", feed, points: [] });
    }
    rpcCalls += 1;
    const body = JSON.parse(String(init?.body)) as Array<{ id: string; params: [{ data: string }] }> | { id: string; params: [{ data: string }] };
    const requests = Array.isArray(body) ? body : [body];
    const response = requests.map((request) => {
      const roundId = request.params[0].data === "0xfeaf968c"
        ? latestRoundId
        : BigInt(`0x${request.params[0].data.slice(-64)}`);
      const secondsAgo = Number(latestRoundId - roundId) * 1_000;
      return { jsonrpc: "2.0", id: request.id, result: encodedRound(roundId, 12_000_000_000n, now - secondsAgo) };
    });
    return Response.json(Array.isArray(body) ? response : response[0]);
  }) as typeof fetch;

  const window = await resolveStockRollingWindow("AAPL", {
    origin: "https://hoodflow.test",
    nowSeconds: now,
    fetcher,
  });
  const elapsed = window.stockEnd.updatedAt - window.stockStart.updatedAt;
  assert.ok(Math.abs(elapsed - 86_400) <= 1_000, `expected a near-24h round, received ${elapsed}s`);
  assert.match(window.stockStart.sourceId, /chainlink-robinhood/);
  assert.ok(rpcCalls <= 11, `direct fallback exceeded its bounded call budget: ${rpcCalls}`);
});
