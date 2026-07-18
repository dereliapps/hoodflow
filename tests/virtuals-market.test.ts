import assert from "node:assert/strict";
import test from "node:test";
import {
  ROBINHOOD_VIRTUAL_ADDRESS,
  normalizeVirtualsToken,
  virtualsQuery,
} from "../lib/launchpads/virtuals";

test("normalizes every Robinhood Virtuals prototype as a bonding market", () => {
  const market = normalizeVirtualsToken({
    id: 113002,
    chain: "ROBINHOOD",
    name: "clusty.fun by Virtuals",
    symbol: "CLUSTY",
    status: "UNDERGRAD",
    preToken: "0x58F960199b27Eaf53F29570527eF5DF26C6A29c6",
    preTokenPair: "0x21c7597784f3b332D63e057507BecEb3c220b397",
    totalValueLocked: "5565",
    holderCount: 69,
    factory: "BONDING_V5",
  });

  assert.ok(market);
  assert.equal(market.lifecycle, "bonding");
  assert.equal(market.address, "0x58f960199b27eaf53f29570527ef5df26c6a29c6");
  assert.equal(market.bondedVirtual, 5565);
  assert.equal(market.externalUrl, "https://app.virtuals.io/virtuals/113002");
});

test("switches graduated Virtuals records to the post-graduation token", () => {
  const market = normalizeVirtualsToken({
    id: 42,
    chain: "ROBINHOOD",
    symbol: "AGENT",
    status: "AVAILABLE",
    preToken: "0x1111111111111111111111111111111111111111",
    tokenAddress: "0x2222222222222222222222222222222222222222",
    lpAddress: "0x3333333333333333333333333333333333333333",
  });

  assert.ok(market);
  assert.equal(market.lifecycle, "graduated");
  assert.equal(market.address, "0x2222222222222222222222222222222222222222");
  assert.equal(market.pairAddress, "0x3333333333333333333333333333333333333333");
});

test("rejects non-Robinhood and zero-address listings", () => {
  assert.equal(normalizeVirtualsToken({ chain: "BASE", symbol: "NOPE", preToken: "0x1111111111111111111111111111111111111111" }), null);
  assert.equal(normalizeVirtualsToken({ chain: "ROBINHOOD", symbol: "NOPE", preToken: "0x0000000000000000000000000000000000000000" }), null);
});

test("builds official API queries with a fixed Robinhood filter", () => {
  const url = new URL(virtualsQuery({ "sort[0]": "volume24h:desc" }));
  assert.equal(url.origin, "https://api.virtuals.io");
  assert.equal(url.searchParams.get("filters[chain]"), "ROBINHOOD");
  assert.equal(url.searchParams.get("sort[0]"), "volume24h:desc");
  assert.equal(ROBINHOOD_VIRTUAL_ADDRESS, "0xc6911796042b15d7fa4f6cde69e245ddcd3d9c31");
});
