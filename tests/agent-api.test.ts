import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentQuoteUnavailableError,
  AgentQuoteValidationError,
  buildAgentMarketUrl,
  canonicalSiteOrigin,
  evaluateOracleDeviation,
  listAgentMarkets,
  parseAgentQuoteRequest,
} from "../lib/hoodflow-agent.js";
import {
  AgentApiBodyTimeoutError,
  AgentApiBodyTooLargeError,
  readCappedJson,
} from "../lib/agent-api-guard.js";

test("publishes only route-reviewed HoodFlow markets", () => {
  const markets = listAgentMarkets();
  assert.equal(markets.length, 14);
  assert.ok(markets.every((market) => market.status === "route-reviewed"));
  assert.ok(markets.every((market) => market.settlementTicker === "USDG"));
  assert.equal(markets.find((market) => market.ticker === "SGOV"), undefined);
  assert.equal(markets.find((market) => market.ticker === "SLV")?.route, "Uniswap V3");
  assert.equal(markets.find((market) => market.ticker === "AAPL")?.route, "Uniswap V4");
});

test("normalizes bounded quote requests", () => {
  assert.deepEqual(parseAgentQuoteRequest({ asset: "aapl", side: "BUY", amount: "25.5" }), {
    asset: "AAPL",
    side: "buy",
    amount: "25.5",
    slippageBps: 50,
  });
  assert.deepEqual(parseAgentQuoteRequest({ asset: "SPY", side: "sell", amount: "0.125", slippageBps: 25 }), {
    asset: "SPY",
    side: "sell",
    amount: "0.125",
    slippageBps: 25,
  });
});

test("builds a canonical handoff that preserves the exact preflight intent", () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://hoodflow.app";
  try {
    assert.equal(canonicalSiteOrigin(), "https://hoodflow.app");
    const handoff = buildAgentMarketUrl({ asset: "AAPL", side: "buy", amount: "25.5", slippageBps: 50 });
    assert.equal(handoff.origin, "https://hoodflow.app");
    assert.equal(handoff.searchParams.get("asset"), "AAPL");
    assert.equal(handoff.searchParams.get("agentSide"), "buy");
    assert.equal(handoff.searchParams.get("agentAmount"), "25.5");
    assert.equal(handoff.searchParams.get("agentSlippageBps"), "50");
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
});

test("rejects unreviewed assets and unsafe quote bounds", () => {
  assert.throws(() => parseAgentQuoteRequest({ asset: "MSFT", side: "buy", amount: "10" }), AgentQuoteValidationError);
  assert.throws(() => parseAgentQuoteRequest({ asset: "SGOV", side: "buy", amount: "10" }), AgentQuoteValidationError);
  assert.throws(() => parseAgentQuoteRequest({ asset: "AAPL", side: "buy", amount: "0" }), AgentQuoteValidationError);
  assert.throws(() => parseAgentQuoteRequest({ asset: "AAPL", side: "buy", amount: "10", slippageBps: 501 }), AgentQuoteValidationError);
  assert.throws(() => parseAgentQuoteRequest({ asset: "AAPL", side: "buy", amount: "100001" }), AgentQuoteValidationError);
  assert.throws(() => parseAgentQuoteRequest({ asset: "AAPL", side: "buy", amount: "1.0000001" }), AgentQuoteValidationError);
});

test("enforces the DEX-to-oracle deviation boundary for both sides", () => {
  const buy = evaluateOracleDeviation({ side: "buy", inputAmount: "100", outputAmount: "0.5", oraclePrice: 201 });
  assert.equal(buy.impliedDexPrice, 200);
  assert.ok(buy.deviationBps < 100);
  const sell = evaluateOracleDeviation({ side: "sell", inputAmount: "0.5", outputAmount: "100", oraclePrice: 199 });
  assert.equal(sell.impliedDexPrice, 200);
  assert.ok(sell.deviationBps < 100);
  assert.throws(
    () => evaluateOracleDeviation({ side: "buy", inputAmount: "100", outputAmount: "1", oraclePrice: 200 }),
    AgentQuoteUnavailableError,
  );
});

test("reads the actual request stream with a hard byte cap", async () => {
  const request = new Request("https://hoodflow.app/api/agents/quote", {
    method: "POST",
    body: JSON.stringify({ asset: "AAPL", side: "buy", amount: "10" }),
  });
  assert.deepEqual(await readCappedJson(request), { asset: "AAPL", side: "buy", amount: "10" });

  const oversized = new Request("https://hoodflow.app/api/agents/quote", {
    method: "POST",
    body: JSON.stringify({ padding: "x".repeat(5_000) }),
  });
  await assert.rejects(() => readCappedJson(oversized), AgentApiBodyTooLargeError);
});

test("cancels a stalled request stream after the total read deadline", async () => {
  let cancelled = false;
  const stalledBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("{"));
    },
    cancel() {
      cancelled = true;
    },
  });
  const stalled = new Request("https://hoodflow.app/api/agents/quote", {
    method: "POST",
    body: stalledBody,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  await assert.rejects(() => readCappedJson(stalled, 4_096, 25), AgentApiBodyTimeoutError);
  assert.equal(cancelled, true);
});
