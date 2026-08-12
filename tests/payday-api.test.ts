import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { GET, OPTIONS } from "../app/api/payday/route.js";

test("Payday GET rejects missing, duplicate, unknown, and client-evidence parameters", async () => {
  for (const query of [
    "",
    "?asset=AAPL&asset=NVDA",
    "?asset=NOT_REAL",
    "?asset=AAPL&evidence=client",
    "?asset=AAPL&multiplier=999",
  ]) {
    const response = await GET(new NextRequest(`https://hoodflow.app/api/payday${query}`));
    assert.equal(response.status, 422, query);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.ok, false);
    assert.deepEqual(Object.keys(body).sort(), [
      "capabilities",
      "error",
      "executionHandoff",
      "handoff",
      "handoffAllowed",
      "ok",
      "retryable",
      "safety",
    ]);
    assert.equal(body.retryable, false);
    assert.equal(body.handoffAllowed, false);
    assert.equal(body.handoff, null);
    assert.equal(body.executionHandoff, null);
    assert.deepEqual(body.capabilities, {
      readsOfficialSources: false,
      signs: false,
      submitsTransaction: false,
      requestsWalletPermission: false,
      createsClaimToken: false,
      controlsFunds: false,
      createsEntitlement: false,
    });
    assert.match(String(body.safety), /No transaction/);
  }
});

test("Payday preflight supports bounded CORS without enabling writes", async () => {
  const response = await OPTIONS();
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-methods"), "GET, OPTIONS");
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
});
