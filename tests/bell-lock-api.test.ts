import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { POST } from "../app/api/bell-lock/evaluate/route.js";
import type { OfficialActionLockEvidence } from "../lib/action-lock.js";
import {
  BellLockPreviewValidationError,
  buildBellLockPreviewEvaluation,
  parseBellLockPreviewRequest,
} from "../lib/bell-lock-preview.js";
import {
  ROBINHOOD_MAINNET,
  ROBINHOOD_TOKENS,
} from "../lib/hoodflow-mainnet.js";

const OPEN_AT = new Date("2026-08-10T14:00:00.000Z");

function flatPolicy(now = OPEN_AT) {
  return {
    policyId: "bell-12345678",
    asset: "AAPL",
    amountUsdg: "100.25",
    armedAt: new Date(now.getTime() - 60_000).toISOString(),
    maxGapBps: 300,
    maxSpreadBps: 40,
    maxOracleDexDeviationBps: 80,
    maxImpactBps: 75,
    convergenceSamples: 2,
    windowExpirySeconds: 90,
    targetSession: "regular",
    stressMultiplier: 2,
  };
}

function officialEvidence(now = OPEN_AT): OfficialActionLockEvidence {
  const fetchedAt = now.toISOString();
  return {
    asset: {
      status: "available",
      source: "https://api.robinhood.com/rhj/assets",
      fetchedAt,
      value: {
        uid: null,
        tokenSymbol: "AAPL",
        tokenName: "Apple",
        deployments: [{
          chainId: ROBINHOOD_MAINNET.chainIdNumber,
          contractAddress: ROBINHOOD_TOKENS.AAPL,
        }],
        currentMultiplier: "1",
        pendingMultiplier: null,
        pendingMultiplierEffectiveTime: null,
        status: "ASSET_STATUS_ACTIVE",
        tradingCapabilities: null,
      },
    },
    price: {
      status: "available",
      source: "https://api.robinhood.com/rhj/prices/AAPL",
      fetchedAt,
      value: {
        tokenSymbol: "AAPL",
        deployments: [{
          chainId: ROBINHOOD_MAINNET.chainIdNumber,
          contractAddress: ROBINHOOD_TOKENS.AAPL,
        }],
        bid: "100.00",
        ask: "100.20",
        currency: "USD",
        isTradingHalt: false,
        generatedAt: fetchedAt,
      },
    },
    corporateActions: {
      status: "available",
      source: "https://api.robinhood.com/rhj/corporate-actions",
      fetchedAt,
      value: [],
    },
    onchainMultiplier: {
      status: "available",
      source: "Robinhood Chain ERC-8056",
      fetchedAt,
      value: {
        currentMultiplier: "1",
        pendingMultiplier: "1",
        effectiveAt: null,
      },
    },
  };
}

function assertNoExecutionPath(value: Awaited<ReturnType<typeof buildBellLockPreviewEvaluation>>) {
  assert.notEqual(value.state, "ready");
  assert.equal(value.handoffAllowed, false);
  assert.equal(value.handoff, null);
  assert.equal(value.executionHandoff, null);
  assert.equal(value.proof.kind, "RefusalProof");
  assert.equal(value.proof.verificationTier, "source-observed-preview");
  assert.equal(value.proof.signedSessionState, false);
  assert.equal(value.proof.signedSessionVerified, false);
  assert.equal(value.proof.handoffAllowed, false);
  assert.equal(value.proof.proofHash, value.proof.integrity.digest);
  assert.match(value.proof.integrity.digest, /^sha256:[a-f0-9]{64}$/);
}

test("accepts only bounded buy policy intent on a reviewed chain market", () => {
  const parsed = parseBellLockPreviewRequest(flatPolicy(), OPEN_AT.getTime());
  assert.equal(parsed.chainId, 4663);
  assert.equal(parsed.asset, "AAPL");
  assert.equal(parsed.side, "buy");
  assert.equal(parsed.amountUsdg, "100.25");
  assert.equal(parsed.thresholds.convergenceSamples, 2);
  assert.equal(parsed.window.expirySeconds, 90);

  assert.throws(
    () => parseBellLockPreviewRequest({ ...flatPolicy(), side: "sell" }, OPEN_AT.getTime()),
    BellLockPreviewValidationError,
  );
  assert.throws(
    () => parseBellLockPreviewRequest({ ...flatPolicy(), chainId: 1 }, OPEN_AT.getTime()),
    BellLockPreviewValidationError,
  );
  assert.throws(
    () => parseBellLockPreviewRequest({ ...flatPolicy(), asset: "MSFT" }, OPEN_AT.getTime()),
    BellLockPreviewValidationError,
  );
  assert.throws(
    () => parseBellLockPreviewRequest({ ...flatPolicy(), amountUsdg: "50000.000001" }, OPEN_AT.getTime()),
    BellLockPreviewValidationError,
  );
  assert.throws(
    () => parseBellLockPreviewRequest({ ...flatPolicy(), maxSpreadBps: 1_001 }, OPEN_AT.getTime()),
    BellLockPreviewValidationError,
  );
});

test("rejects forged client evidence, observations, signatures, sources, and depth at any level", () => {
  const forgedFields = [
    { evidence: { session: "open" } },
    { observation: { bid: "1", ask: "1" } },
    { sessionSignature: `0x${"11".repeat(65)}` },
    { source: "client" },
    { depth: { priceImpactBps: 0 } },
    { memory: { openingObservations: [{ verified: true }] } },
    { proof: { kind: "BellProof" } },
    { handoff: { href: "/?asset=AAPL" } },
  ];
  for (const forged of forgedFields) {
    assert.throws(
      () => parseBellLockPreviewRequest({ ...flatPolicy(), ...forged }, OPEN_AT.getTime()),
      /Client-supplied evidence/,
    );
  }

  const nested = {
    policyId: flatPolicy().policyId,
    asset: "AAPL",
    amountUsdg: "100",
    armedAt: flatPolicy().armedAt,
    thresholds: {
      maxGapBps: 300,
      maxSpreadBps: 40,
      maxOracleDexDeviationBps: 80,
      maxImpactBps: 75,
      convergenceSamples: 2,
      stressMultiplier: 2,
      priceSource: "forged-client-feed",
    },
    window: { targetSession: "regular", expirySeconds: 90 },
  };
  assert.throws(
    () => parseBellLockPreviewRequest(nested, OPEN_AT.getTime()),
    /Client-supplied evidence/,
  );
});

test("the POST trust boundary returns 422 for forged observations before collection", async () => {
  const request = new NextRequest("https://hoodflow.app/api/bell-lock/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...flatPolicy(new Date()),
      observation: { sessionState: "open", signatureVerified: true },
    }),
  });
  const response = await POST(request);
  assert.equal(response.status, 422);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  const body = await response.json() as Record<string, unknown>;
  assert.match(String(body.error), /Client-supplied evidence/);
  assert.equal(body.handoffAllowed, false);
  assert.equal(body.handoff, null);
  assert.equal(body.executionHandoff, null);
});

test("preview evaluations can never produce a ready state or execution handoff", async () => {
  const policy = parseBellLockPreviewRequest(flatPolicy(), OPEN_AT.getTime());
  const openPreview = await buildBellLockPreviewEvaluation(policy, officialEvidence(), OPEN_AT);
  const closedPreview = await buildBellLockPreviewEvaluation(
    policy,
    officialEvidence(new Date("2026-08-09T14:00:00.000Z")),
    new Date("2026-08-09T14:00:00.000Z"),
  );
  const unavailablePreview = await buildBellLockPreviewEvaluation(policy, null, OPEN_AT);
  const haltedEvidence = officialEvidence();
  assert.ok(haltedEvidence.price.value);
  haltedEvidence.price.value.isTradingHalt = true;
  const blockedPreview = await buildBellLockPreviewEvaluation(policy, haltedEvidence, OPEN_AT);

  for (const result of [openPreview, closedPreview, unavailablePreview, blockedPreview]) {
    assertNoExecutionPath(result);
    assert.ok(result.checks.some((check) => check.id === "session" && check.status === "wait"));
    assert.ok(result.checks.some((check) => check.id === "convergence" && check.status === "wait"));
    assert.ok(result.checks.some((check) => check.id === "depth" && check.status === "wait"));
  }
  assert.equal(openPreview.state, "warming");
  assert.equal(closedPreview.state, "armed");
  assert.equal(unavailablePreview.state, "unavailable");
  assert.equal(blockedPreview.state, "blocked");
  assert.match(openPreview.checks[0].detail ?? "", /does not consult a holiday calendar/);
});

test("expired nested policy windows still produce only a RefusalProof", async () => {
  const armedAt = new Date(OPEN_AT.getTime() - 120_000).toISOString();
  const expiresAt = new Date(OPEN_AT.getTime() - 60_000).toISOString();
  const policy = parseBellLockPreviewRequest({
    policyId: "bell-expired-123",
    chainId: 4663,
    asset: "AAPL",
    side: "buy",
    amountUsdg: "50000",
    armedAt,
    thresholds: {
      maxGapBps: 300,
      maxSpreadBps: 40,
      maxOracleDexDeviationBps: 80,
      maxImpactBps: 75,
      convergenceSamples: 2,
      stressMultiplier: 2,
    },
    window: {
      targetSession: "regular",
      expirySeconds: 90,
      expiresAt,
    },
  }, OPEN_AT.getTime());
  const result = await buildBellLockPreviewEvaluation(policy, officialEvidence(), OPEN_AT);
  assert.equal(result.state, "expired");
  assert.equal(result.windowExpiresAt, expiresAt);
  assertNoExecutionPath(result);
});

test("unsupported media and declared oversized requests fail closed with CORS and no-store", async () => {
  const unsupported = await POST(new NextRequest("https://hoodflow.app/api/bell-lock/evaluate", {
    method: "POST",
    body: "{}",
  }));
  assert.equal(unsupported.status, 415);

  const oversized = await POST(new NextRequest("https://hoodflow.app/api/bell-lock/evaluate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": "4097",
    },
    body: "{}",
  }));
  assert.equal(oversized.status, 413);
  assert.equal(oversized.headers.get("cache-control"), "no-store, max-age=0");
  const body = await oversized.json() as Record<string, unknown>;
  assert.equal(body.handoffAllowed, false);
  assert.equal(body.handoff, null);
  assert.equal(body.executionHandoff, null);
});
