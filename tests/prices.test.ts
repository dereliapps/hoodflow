import assert from "node:assert/strict";
import test from "node:test";

import { AbiCoder } from "ethers";

import { ROBINHOOD_PRICE_FEEDS } from "../config/robinhood-price-feeds.js";
import { decodeBoolean, decodeLatestRoundData, scalePrice } from "../lib/chainlink.js";
import { buildRobinhoodPriceRequests, parseRobinhoodPriceResults } from "../lib/robinhood-prices.js";

test("indexes every HoodFlow asset and leaves an unavailable feed explicit", () => {
  assert.equal(Object.keys(ROBINHOOD_PRICE_FEEDS).length, 25);
  assert.equal(ROBINHOOD_PRICE_FEEDS.BE.feed, null);
  assert.equal(Object.values(ROBINHOOD_PRICE_FEEDS).filter((item) => item.feed).length, 24);
  assert.equal(ROBINHOOD_PRICE_FEEDS.CUSO.heartbeat, 86_400);
});

test("decodes a valid Chainlink round without losing its safety fields", () => {
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ["uint80", "int256", "uint256", "uint256", "uint80"],
    [201n, 32_432_000_000n, 1_784_124_600n, 1_784_124_664n, 201n],
  );
  const round = decodeLatestRoundData(encoded);
  assert.ok(round);
  assert.equal(round.answer, 32_432_000_000n);
  assert.equal(round.updatedAt, 1_784_124_664);
  assert.equal(round.answeredInRound, round.roundId);
  assert.equal(scalePrice(round.answer, 8), 324.32);
});

test("rejects malformed and non-positive price data", () => {
  assert.equal(decodeLatestRoundData("0x1234"), null);
  assert.equal(scalePrice(0n, 8), null);
  assert.equal(scalePrice(-1n, 8), null);
  assert.equal(decodeBoolean("0x1234"), null);
  assert.equal(decodeBoolean(`0x${"0".repeat(63)}1`), true);
});

test("builds one pause check per asset and one price call per configured feed", () => {
  const requests = buildRobinhoodPriceRequests();
  assert.equal(requests.filter((item) => item.id.startsWith("paused:")).length, 25);
  assert.equal(requests.filter((item) => item.id.startsWith("price:")).length, 24);
  assert.equal(requests.length, 49);
});

test("only marks a valid fresh round live after the token pause check succeeds", () => {
  const now = 1_784_124_700;
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ["uint80", "int256", "uint256", "uint256", "uint80"],
    [201n, 32_432_000_000n, 1_784_124_600n, 1_784_124_664n, 201n],
  );
  const clear = `0x${"0".repeat(64)}`;
  const withPauseCheck = parseRobinhoodPriceResults([
    { id: "price:AAPL", result: encoded },
    { id: "paused:AAPL", result: clear },
  ], now);
  assert.equal(withPauseCheck.prices.AAPL.status, "live");
  assert.equal(withPauseCheck.prices.AAPL.price, 324.32);

  const withoutPauseCheck = parseRobinhoodPriceResults([
    { id: "price:AAPL", result: encoded },
  ], now);
  assert.equal(withoutPauseCheck.prices.AAPL.status, "unavailable");
  assert.equal(withoutPauseCheck.prices.AAPL.price, 324.32);
  assert.equal(withoutPauseCheck.liveCount, 0);
});
