import assert from "node:assert/strict";
import test from "node:test";

import {
  appendDepthMemory,
  clearDepthMemoryAsset,
  compareDepthMemory,
  createDepthMemoryScan,
  DEPTH_MEMORY_MAX_BYTES,
  DEPTH_MEMORY_SCHEMA,
  highestHistoricalPass,
  parseDepthMemory,
  pruneDepthMemory,
  sanitizeDepthMemoryScan,
  serializeDepthMemory,
  type DepthMemoryScan,
} from "../lib/depth-memory.js";

const now = Date.parse("2026-08-10T12:00:00.000Z");
const allowedAssets = new Set(["AAPL", "NVDA", "SPY"]);

function passPoint(amount: string, deviationBps = 20, estimatedAmount = "1.000000", quoteTime = now) {
  return {
    amount,
    status: "pass" as const,
    quote: {
      receive: { estimatedAmount, indicativeMinimumAmount: "0.995000" },
      route: { protocol: "Uniswap V4" as const, feeBps: 30, gasEstimate: "245000" },
      protection: { dataExpiresAt: new Date(quoteTime + 75_000).toISOString(), slippageBps: 50 },
      reference: {
        price: 100,
        impliedDexPrice: 100.2,
        deviationBps,
        maxDeviationBps: 500,
        updatedAt: Math.floor(quoteTime / 1_000) - 10,
        heartbeat: 86_400,
      },
      quotedAt: new Date(quoteTime).toISOString(),
    },
  };
}

function scan(asset = "AAPL", completedAt = now, passedAmounts = ["10", "25", "100"]): DepthMemoryScan {
  return createDepthMemoryScan(asset, completedAt - 1_000, completedAt, ["10", "25", "100", "250", "1000"].map((amount) => (
    passedAmounts.includes(amount) ? passPoint(amount, Number(amount) / 5, "1.000000", completedAt) : { amount, status: "unavailable" as const }
  )));
}

test("Depth Memory stores a fixed, sanitized five-point observation", () => {
  const created = scan();
  assert.equal(created.schema, DEPTH_MEMORY_SCHEMA);
  assert.deepEqual(created.points.map((point) => point.amount), ["10", "25", "100", "250", "1000"]);
  assert.equal(created.points[0].status, "passed-then");
  assert.equal(created.points[3].status, "no-signal");
  assert.equal("quoteId" in created.points[0], false);
  assert.equal("wallet" in created, false);
  assert.equal("txHash" in created, false);
});

test("parser rejects malformed, oversized and unknown-version storage without throwing", () => {
  assert.deepEqual(parseDepthMemory("not-json", allowedAssets, now), []);
  assert.deepEqual(parseDepthMemory("x".repeat(DEPTH_MEMORY_MAX_BYTES + 1), allowedAssets, now), []);
  assert.deepEqual(parseDepthMemory(JSON.stringify({ version: 2, scans: [scan()] }), allowedAssets, now), []);
});

test("sanitizer rejects unknown assets, duplicate amounts and impossible outputs", () => {
  const valid = scan();
  assert.equal(sanitizeDepthMemoryScan({ ...valid, asset: "FAKE" }, allowedAssets, now), null);
  assert.equal(sanitizeDepthMemoryScan({ ...valid, points: valid.points.map((point) => ({ ...point, amount: "10" })) }, allowedAssets, now), null);
  const impossible = {
    ...valid,
    points: valid.points.map((point, index) => index === 0
      ? { ...point, estimatedOutput: "1.0", minimumOutput: "2.0" }
      : point),
  };
  assert.equal(sanitizeDepthMemoryScan(impossible, allowedAssets, now), null);
});

test("sanitizer reconstructs known fields and drops injected properties", () => {
  const valid = scan();
  const poisoned = {
    ...valid,
    walletAddress: "0xdead",
    points: valid.points.map((point) => ({ ...point, calldata: "0xdead", nested: { unsafe: true } })),
  };
  const clean = sanitizeDepthMemoryScan(poisoned, allowedAssets, now);
  assert.ok(clean);
  assert.equal("walletAddress" in clean, false);
  assert.equal("calldata" in clean.points[0], false);
  assert.equal("nested" in clean.points[0], false);
});

test("sanitizer rejects quote and oracle timestamps that do not belong to the recorded scan", () => {
  const valid = scan();
  const staleQuoteTime = Date.parse("2020-01-01T00:00:00.000Z");
  const poisoned = {
    ...valid,
    points: valid.points.map((point) => point.status === "passed-then"
      ? {
          ...point,
          quotedAt: new Date(staleQuoteTime).toISOString(),
          expiresAt: new Date(staleQuoteTime + 75_000).toISOString(),
          oracleUpdatedAt: 1,
        }
      : point),
  };
  assert.equal(sanitizeDepthMemoryScan(poisoned, allowedAssets, now), null);

  const overlongQuote = {
    ...valid,
    points: valid.points.map((point) => point.status === "passed-then"
      ? { ...point, expiresAt: new Date(now + 10 * 60_000).toISOString() }
      : point),
  };
  assert.equal(sanitizeDepthMemoryScan(overlongQuote, allowedAssets, now), null);
});

test("sanitizer rejects an oracle round that was stale when the quote was observed", () => {
  const valid = scan();
  const poisoned = {
    ...valid,
    points: valid.points.map((point) => point.status === "passed-then"
      ? { ...point, oracleUpdatedAt: Math.floor(now / 1_000) - 86_402, oracleHeartbeat: 86_400 }
      : point),
  };
  assert.equal(sanitizeDepthMemoryScan(poisoned, allowedAssets, now), null);
});

test("round trip keeps only validated observations", () => {
  const valid = scan();
  const decoded = parseDepthMemory(serializeDepthMemory([valid]), allowedAssets, now);
  assert.equal(decoded.length, 1);
  assert.deepEqual(decoded[0], valid);
});

test("retention is capped at five observations per asset and twenty total", () => {
  const manyAssets = Array.from({ length: 6 }, (_, assetIndex) => Array.from({ length: 7 }, (_, index) => (
    scan(`ASSET${assetIndex}`, now - assetIndex * 100_000 - index * 1_000)
  ))).flat();
  const pruned = pruneDepthMemory(manyAssets);
  assert.equal(pruned.length, 20);
  for (const asset of new Set(pruned.map((item) => item.asset))) {
    assert.ok(pruned.filter((item) => item.asset === asset).length <= 5);
  }
});

test("append deduplicates observations and clear is asset-scoped", () => {
  const aapl = scan("AAPL", now);
  const nvda = scan("NVDA", now - 1_000);
  const appended = appendDepthMemory([aapl, nvda], aapl);
  assert.equal(appended.length, 2);
  assert.deepEqual(clearDepthMemoryAsset(appended, "AAPL").map((item) => item.asset), ["NVDA"]);
});

test("comparison uses only identical asset and exact sample amounts", () => {
  const previous = scan("AAPL", now - 60_000, ["10", "25", "100"]);
  const current = scan("AAPL", now, ["10", "100", "250"]);
  current.points = current.points.map((point) => point.amount === "10" && point.status === "passed-then"
    ? { ...point, deviationBps: 9, estimatedOutput: "1.010000" }
    : point);
  previous.points = previous.points.map((point) => point.amount === "10" && point.status === "passed-then"
    ? { ...point, deviationBps: 4, estimatedOutput: "1.000000" }
    : point);
  const comparison = compareDepthMemory(current, previous);
  assert.ok(comparison);
  assert.equal(comparison.appearedCount, 1);
  assert.equal(comparison.notReobservedCount, 1);
  assert.equal(comparison.comparableCount, 2);
  assert.equal(comparison.points.find((point) => point.amount === "25")?.transition, "unresolved");
  assert.equal(comparison.points[0].deviationDeltaBps, 5);
  assert.equal(comparison.points[0].outputDeltaBps, 100);
  assert.equal(compareDepthMemory(current, scan("NVDA", now - 1_000)), null);
});

test("rate limits and missing responses are never promoted to a lost-route transition", () => {
  const previous = scan("AAPL", now - 60_000, ["10", "25"]);
  const current = scan("AAPL", now, []);
  current.points = current.points.map((point) => point.amount === "10"
    ? { amount: point.amount, status: "rate-limited" as const }
    : point);
  const comparison = compareDepthMemory(current, previous);
  assert.ok(comparison);
  assert.equal(comparison.notReobservedCount, 2);
  assert.equal(comparison.points.find((point) => point.amount === "10")?.transition, "unresolved");
  assert.equal(comparison.points.find((point) => point.amount === "25")?.transition, "unresolved");
});

test("highest historical pass is explicitly a stored observation", () => {
  const historical = scan("AAPL", now, ["10", "250"]);
  assert.equal(highestHistoricalPass(historical)?.amount, "250");
  assert.equal(historical.points.some((point) => "requiresUserSignature" in point), false);
});
