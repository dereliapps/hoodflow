import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPercentage,
  formatTokenAmount,
  formatUsd,
} from "../lib/format-display-number.js";

test("never exposes scientific notation for tiny token values", () => {
  const values = [
    formatUsd(6.02e-5, { price: true }),
    formatTokenAmount("0.000000000000000001"),
    formatTokenAmount(1.23456789e-36),
    formatTokenAmount("19.260672"),
  ];

  assert.deepEqual(values, [
    "$0.0000602",
    "0.000000000000000001",
    "0.0000000000000000000000000000000000012345679",
    "19.260672",
  ]);
  assert.ok(values.every((value) => !/\d[eE][+-]?\d/.test(value)));
});

test("formats missing values, zero, compact money and bounded percentages", () => {
  assert.equal(formatUsd(null), "—");
  assert.equal(formatUsd(Number.NaN), "—");
  assert.equal(formatUsd(0), "$0.00");
  assert.equal(formatTokenAmount(-0), "0");
  assert.equal(formatUsd(1_250_000, { compact: true }), "$1.3M");
  assert.equal(formatPercentage(1_728.18), "+1,728.18%");
  assert.equal(formatPercentage(12_851.04), "+12.9K%");
  assert.equal(formatPercentage(-140), "-99.99%");
});
