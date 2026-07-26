import assert from "node:assert/strict";
import test from "node:test";
import { buildScanWindow, evaluateReadiness } from "../keeper/reliability.js";

test("scan windows roll across all strategy IDs and wrap around", () => {
  const first = buildScanWindow(1_200n, 500, 1n);
  const second = buildScanWindow(1_200n, 500, first.nextStrategyId);
  const third = buildScanWindow(1_200n, 500, second.nextStrategyId);

  assert.equal(first.startStrategyId, 1n);
  assert.equal(first.endStrategyId, 500n);
  assert.equal(second.startStrategyId, 501n);
  assert.equal(second.endStrategyId, 1_000n);
  assert.equal(third.startStrategyId, 1_001n);
  assert.equal(third.endStrategyId, 300n);
  assert.equal(third.nextStrategyId, 301n);

  const visited = new Set(
    [...first.strategyIds, ...second.strategyIds, ...third.strategyIds]
      .map((strategyId) => strategyId.toString()),
  );
  assert.equal(visited.size, 1_200);
});

test("scan windows handle an empty registry and normalize a stale cursor", () => {
  assert.deepEqual(buildScanWindow(0n, 500, 900n), {
    strategyIds: [],
    startStrategyId: null,
    endStrategyId: null,
    nextStrategyId: 1n,
  });

  const normalized = buildScanWindow(3n, 2, 9n);
  assert.deepEqual(normalized.strategyIds, [3n, 1n]);
  assert.equal(normalized.nextStrategyId, 2n);
});

test("readiness requires a recent successful scan", () => {
  const base = {
    started: true,
    stopping: false,
    consecutiveFailures: 0,
    maxSuccessAgeMs: 60_000,
    failureThreshold: 3,
    nowMs: 100_000,
  };

  assert.deepEqual(evaluateReadiness({ ...base, lastSuccessAt: null }), {
    ready: false,
    reason: "no_successful_scan",
    successAgeMs: null,
    successFresh: false,
    failuresWithinBudget: true,
  });

  const fresh = evaluateReadiness({
    ...base,
    lastSuccessAt: new Date(70_000).toISOString(),
  });
  assert.equal(fresh.ready, true);
  assert.equal(fresh.reason, "ready");
  assert.equal(fresh.successAgeMs, 30_000);

  const stale = evaluateReadiness({
    ...base,
    lastSuccessAt: new Date(39_999).toISOString(),
  });
  assert.equal(stale.ready, false);
  assert.equal(stale.reason, "successful_scan_stale");
});

test("readiness fails at the configured consecutive failure threshold", () => {
  const input = {
    started: true,
    stopping: false,
    lastSuccessAt: new Date(90_000).toISOString(),
    maxSuccessAgeMs: 60_000,
    failureThreshold: 3,
    nowMs: 100_000,
  };

  assert.equal(evaluateReadiness({ ...input, consecutiveFailures: 2 }).ready, true);
  const failed = evaluateReadiness({ ...input, consecutiveFailures: 3 });
  assert.equal(failed.ready, false);
  assert.equal(failed.reason, "failure_threshold_exceeded");
});
