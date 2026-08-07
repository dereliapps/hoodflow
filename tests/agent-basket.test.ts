import assert from "node:assert/strict";
import test from "node:test";

import { formatUnits, parseUnits } from "ethers";

import { acquireLocalAgentQuoteCapacity } from "../lib/agent-api-guard.js";
import {
  AgentBasketUnavailableError,
  AgentBasketValidationError,
  allocateUsdGBudget,
  parseAgentBasketRequest,
  prepareAgentBasket,
} from "../lib/hoodflow-basket.js";
import type { AgentQuote, AgentQuoteRequest } from "../lib/hoodflow-agent.js";

const NOW = Date.parse("2026-07-26T12:00:00.000Z");
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const STOCK = "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9";

function quoteFor(request: AgentQuoteRequest, expiresAt = NOW + 60_000): AgentQuote {
  const rawAmount = parseUnits(request.amount, 6);
  const rawOutput = parseUnits("0.125", 18);
  const rawMinimum = rawOutput * BigInt(10_000 - request.slippageBps) / 10_000n;
  const handoff = `/?asset=${request.asset}&agentSide=buy&agentAmount=${encodeURIComponent(request.amount)}&agentSlippageBps=${request.slippageBps}`;
  return {
    quoteId: `hf-${request.asset.toLowerCase()}-test`,
    status: "indicative-preflight",
    chain: { id: 4663, name: "Robinhood Chain" },
    asset: request.asset,
    side: "buy",
    pay: {
      ticker: "USDG",
      address: USDG,
      amount: formatUnits(rawAmount, 6),
      rawAmount: rawAmount.toString(),
      decimals: 6,
    },
    receive: {
      ticker: request.asset,
      address: STOCK,
      estimatedAmount: formatUnits(rawOutput, 18),
      indicativeMinimumAmount: formatUnits(rawMinimum, 18),
      rawEstimatedAmount: rawOutput.toString(),
      rawIndicativeMinimumAmount: rawMinimum.toString(),
      decimals: 18,
    },
    route: {
      protocol: "Uniswap V4",
      fee: 3_000,
      feeBps: 30,
      tickSpacing: 60,
      gasEstimate: "100000",
    },
    protection: {
      slippageBps: request.slippageBps,
      dataExpiresAt: new Date(expiresAt).toISOString(),
      executionBinding: "none-requote-required",
    },
    reference: {
      status: "live",
      price: 200,
      impliedDexPrice: 200,
      deviationBps: 0,
      maxDeviationBps: 500,
      updatedAt: Math.floor(NOW / 1_000),
      heartbeat: 86_400,
      oraclePaused: false,
    },
    uiScaling: {
      standard: "ERC-8056",
      multiplier: "1.0",
      multiplierRaw: "1000000000000000000",
      rawOperations: true,
    },
    custody: "self-custody",
    requiresUserSignature: true,
    executionHandoff: {
      marketPath: handoff,
      marketUrl: `https://hoodflow.app${handoff}`,
      intent: request,
      instruction: "Request a fresh wallet quote.",
    },
    quotedAt: new Date(NOW).toISOString(),
  };
}

test("normalizes a bounded buy basket and applies fail-closed defaults", () => {
  assert.deepEqual(parseAgentBasketRequest({
    budgetUsdG: "100",
    legs: [
      { asset: "aapl", weightBps: 2_500 },
      { asset: "nvda", weightBps: 2_500 },
      { asset: "spy", weightBps: 5_000 },
    ],
  }), {
    budgetUsdG: "100.0",
    legs: [
      { asset: "AAPL", weightBps: 2_500 },
      { asset: "NVDA", weightBps: 2_500 },
      { asset: "SPY", weightBps: 5_000 },
    ],
    slippageBps: 50,
    failurePolicy: "all-or-nothing",
  });
});

test("rejects invalid leg counts, assets, weights, budget and policy", () => {
  const validLegs = [
    { asset: "AAPL", weightBps: 5_000 },
    { asset: "NVDA", weightBps: 5_000 },
  ];
  const invalid = [
    { budgetUsdG: "100", legs: [validLegs[0]] },
    { budgetUsdG: "100", legs: [
      { asset: "AAPL", weightBps: 1_500 },
      { asset: "AMD", weightBps: 1_500 },
      { asset: "AMZN", weightBps: 1_500 },
      { asset: "COIN", weightBps: 1_500 },
      { asset: "GOOGL", weightBps: 1_500 },
      { asset: "INTC", weightBps: 1_500 },
      { asset: "META", weightBps: 1_000 },
    ] },
    { budgetUsdG: "100", legs: [{ asset: "AAPL", weightBps: 5_000 }, { asset: "aapl", weightBps: 5_000 }] },
    { budgetUsdG: "100", legs: [{ asset: "MSFT", weightBps: 5_000 }, { asset: "AAPL", weightBps: 5_000 }] },
    { budgetUsdG: "100", legs: [{ asset: "SGOV", weightBps: 5_000 }, { asset: "AAPL", weightBps: 5_000 }] },
    { budgetUsdG: "100", legs: [{ asset: "AAPL", weightBps: 4_999 }, { asset: "NVDA", weightBps: 5_000 }] },
    { budgetUsdG: "100", legs: [{ asset: "AAPL", weightBps: 5_000.5 }, { asset: "NVDA", weightBps: 4_999.5 }] },
    { budgetUsdG: "0", legs: validLegs },
    { budgetUsdG: "1.0000001", legs: validLegs },
    { budgetUsdG: "100000.000001", legs: validLegs },
    { budgetUsdG: "100", legs: validLegs, slippageBps: 501 },
    { budgetUsdG: "100", legs: validLegs, failurePolicy: "best-effort" },
  ];
  for (const value of invalid) {
    assert.throws(() => parseAgentBasketRequest(value), AgentBasketValidationError);
  }
});

test("allocates every USDG micro-unit with deterministic Hamilton rounding", () => {
  const allocations = allocateUsdGBudget(parseUnits("1.000001", 6), [
    { asset: "AAPL", weightBps: 3_333 },
    { asset: "NVDA", weightBps: 3_333 },
    { asset: "SPY", weightBps: 3_334 },
  ]);
  assert.deepEqual(allocations.map((leg) => leg.amountRaw), [333_300n, 333_300n, 333_401n]);
  assert.equal(allocations.reduce((sum, leg) => sum + leg.amountRaw, 0n), 1_000_001n);
  assert.throws(
    () => allocateUsdGBudget(1n, [
      { asset: "AAPL", weightBps: 5_000 },
      { asset: "NVDA", weightBps: 5_000 },
    ]),
    AgentBasketValidationError,
  );
});

test("prepares all legs in parallel and uses the earliest leg expiry", async () => {
  const request = parseAgentBasketRequest({
    budgetUsdG: "100",
    legs: [
      { asset: "AAPL", weightBps: 2_500 },
      { asset: "NVDA", weightBps: 2_500 },
      { asset: "SPY", weightBps: 5_000 },
    ],
    slippageBps: 25,
  });
  let active = 0;
  let maximumActive = 0;
  const expiryByAsset: Record<string, number> = {
    AAPL: NOW + 70_000,
    NVDA: NOW + 50_000,
    SPY: NOW + 60_000,
  };
  const plan = await prepareAgentBasket(request, {
    now: () => NOW,
    createId: () => "test-full",
    prepareQuote: async (quoteRequest) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      return quoteFor(quoteRequest, expiryByAsset[quoteRequest.asset]);
    },
  });

  assert.equal(maximumActive, 3);
  assert.equal(plan.basketId, "hfb-test-full");
  assert.equal(plan.status, "indicative-preflight");
  assert.deepEqual(plan.progress, {
    requestedLegs: 3,
    preparedLegs: 3,
    rejectedLegs: 0,
    completeness: "full",
  });
  assert.equal(plan.protection.dataExpiresAt, new Date(NOW + 50_000).toISOString());
  assert.equal(plan.budget.rawRequestedAmount, "100000000");
  assert.equal(plan.budget.rawPlannedAmount, "100000000");
  assert.equal(plan.budget.rawUnallocatedAmount, "0");
  assert.deepEqual(plan.legs.map((leg) => leg.quote.pay.amount), ["25.0", "25.0", "50.0"]);
  assert.ok(plan.legs.every((leg) => leg.quote.side === "buy" && leg.quote.requiresUserSignature));
  assert.equal(plan.execution.atomic, false);
  assert.equal(plan.execution.minimumTradeConfirmations, 3);
});

test("all-or-nothing returns no plan when any runtime preflight is unsafe", async () => {
  const request = parseAgentBasketRequest({
    budgetUsdG: "100",
    legs: [
      { asset: "AAPL", weightBps: 5_000 },
      { asset: "NVDA", weightBps: 5_000 },
    ],
  });
  await assert.rejects(
    () => prepareAgentBasket(request, {
      now: () => NOW,
      prepareQuote: async (quoteRequest) => {
        if (quoteRequest.asset === "NVDA") throw new Error("private RPC detail");
        return quoteFor(quoteRequest);
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AgentBasketUnavailableError);
      assert.doesNotMatch(error.message, /private RPC detail/);
      return true;
    },
  );
});

test("omit-unsafe keeps original safe allocations and leaves failed budget unallocated", async () => {
  const request = parseAgentBasketRequest({
    budgetUsdG: "100",
    legs: [
      { asset: "AAPL", weightBps: 2_500 },
      { asset: "NVDA", weightBps: 2_500 },
      { asset: "SPY", weightBps: 5_000 },
    ],
    failurePolicy: "omit-unsafe",
  });
  const plan = await prepareAgentBasket(request, {
    now: () => NOW,
    createId: () => "test-partial",
    prepareQuote: async (quoteRequest) => {
      if (quoteRequest.asset === "NVDA") throw new Error("unavailable");
      return quoteFor(quoteRequest);
    },
  });

  assert.equal(plan.status, "partial-indicative-preflight");
  assert.deepEqual(plan.progress, {
    requestedLegs: 3,
    preparedLegs: 2,
    rejectedLegs: 1,
    completeness: "partial",
  });
  assert.deepEqual(plan.legs.map((leg) => [leg.asset, leg.allocation.amount]), [
    ["AAPL", "25.0"],
    ["SPY", "50.0"],
  ]);
  assert.deepEqual(plan.rejectedLegs.map((leg) => [leg.asset, leg.allocation.amount, leg.code]), [
    ["NVDA", "25.0", "preflight_unavailable"],
  ]);
  assert.equal(plan.budget.plannedAmount, "75.0");
  assert.equal(plan.budget.unallocatedAmount, "25.0");
  assert.equal(plan.execution.minimumTradeConfirmations, 2);
});

test("omit-unsafe still fails closed when fewer than two legs remain", async () => {
  const request = parseAgentBasketRequest({
    budgetUsdG: "100",
    legs: [
      { asset: "AAPL", weightBps: 5_000 },
      { asset: "NVDA", weightBps: 5_000 },
    ],
    failurePolicy: "omit-unsafe",
  });
  await assert.rejects(
    () => prepareAgentBasket(request, {
      now: () => NOW,
      prepareQuote: async (quoteRequest) => {
        if (quoteRequest.asset === "NVDA") throw new Error("unavailable");
        return quoteFor(quoteRequest);
      },
    }),
    AgentBasketUnavailableError,
  );
});

test("expired or request-mismatched quote results are omitted as generic unsafe legs", async () => {
  const request = parseAgentBasketRequest({
    budgetUsdG: "100",
    legs: [
      { asset: "AAPL", weightBps: 3_000 },
      { asset: "NVDA", weightBps: 3_000 },
      { asset: "SPY", weightBps: 4_000 },
    ],
    failurePolicy: "omit-unsafe",
  });
  const plan = await prepareAgentBasket(request, {
    now: () => NOW,
    prepareQuote: async (quoteRequest) => quoteFor(
      quoteRequest,
      quoteRequest.asset === "SPY" ? NOW - 1 : NOW + 60_000,
    ),
  });
  assert.deepEqual(plan.legs.map((leg) => leg.asset), ["AAPL", "NVDA"]);
  assert.deepEqual(plan.rejectedLegs.map((leg) => leg.asset), ["SPY"]);
  const serialized = JSON.stringify(plan);
  assert.doesNotMatch(serialized, /privateKey|transactionData|calldata|permitSignature/i);
});

test("shares weighted local quote capacity across single and basket requests", () => {
  const releaseFirst = acquireLocalAgentQuoteCapacity(6);
  assert.ok(releaseFirst);
  const releaseSecond = acquireLocalAgentQuoteCapacity(6);
  assert.ok(releaseSecond);
  try {
    assert.equal(acquireLocalAgentQuoteCapacity(1), null);
    releaseFirst();
    const releaseThird = acquireLocalAgentQuoteCapacity(1);
    assert.ok(releaseThird);
    releaseThird?.();
  } finally {
    releaseFirst();
    releaseSecond();
  }
});
