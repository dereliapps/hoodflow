import assert from "node:assert/strict";
import test from "node:test";

import {
  DEPTH_MAP_SAMPLE_AMOUNTS,
  DEPTH_MAP_SCAN_COOLDOWN_MS,
  depthMapCooldownRemaining,
  highestFreshDepthMapPass,
  isFreshDepthMapQuote,
  type DepthMapPoint,
} from "../lib/depth-map.js";

type Quote = { protection: { dataExpiresAt: string }; marker: string };

function quote(marker: string, expiresAt: number): Quote {
  return { marker, protection: { dataExpiresAt: new Date(expiresAt).toISOString() } };
}

test("DepthMap uses a fixed five-point USDG ladder", () => {
  assert.deepEqual(DEPTH_MAP_SAMPLE_AMOUNTS, ["10", "25", "100", "250", "1000"]);
  assert.equal(Object.isFrozen(DEPTH_MAP_SAMPLE_AMOUNTS), false);
});

test("quote freshness fails closed for missing, invalid and expired timestamps", () => {
  const now = 1_800_000_000_000;
  assert.equal(isFreshDepthMapQuote(undefined, now), false);
  assert.equal(isFreshDepthMapQuote({ protection: { dataExpiresAt: "not-a-date" } }, now), false);
  assert.equal(isFreshDepthMapQuote({ protection: { dataExpiresAt: new Date(now).toISOString() } }, now), false);
  assert.equal(isFreshDepthMapQuote({ protection: { dataExpiresAt: new Date(now + 1).toISOString() } }, now), true);
});

test("highest sampled pass ignores unavailable and expired points", () => {
  const now = 1_800_000_000_000;
  const points: Array<DepthMapPoint<Quote>> = [
    { amount: "10", status: "pass", quote: quote("ten", now + 60_000) },
    { amount: "25", status: "unavailable" },
    { amount: "100", status: "pass", quote: quote("expired", now - 1) },
    { amount: "250", status: "pass", quote: quote("two-fifty", now + 60_000) },
    { amount: "1000", status: "rate-limited" },
  ];
  assert.equal(highestFreshDepthMapPass(points, now)?.amount, "250");
  assert.equal(highestFreshDepthMapPass(points, now)?.quote?.marker, "two-fifty");
});

test("scan cooldown reaches zero exactly at the boundary", () => {
  const lastScanAt = 10_000;
  assert.equal(depthMapCooldownRemaining(null, lastScanAt), 0);
  assert.equal(depthMapCooldownRemaining(lastScanAt, lastScanAt), DEPTH_MAP_SCAN_COOLDOWN_MS);
  assert.equal(depthMapCooldownRemaining(lastScanAt, lastScanAt + DEPTH_MAP_SCAN_COOLDOWN_MS - 1), 1);
  assert.equal(depthMapCooldownRemaining(lastScanAt, lastScanAt + DEPTH_MAP_SCAN_COOLDOWN_MS), 0);
});
