import assert from "node:assert/strict";
import test from "node:test";

import {
  BELL_LOCK_OBSERVATION_SCHEMA,
  BELL_LOCK_POLICY_SCHEMA,
  BELL_PROOF_SCHEMA,
  REFUSAL_PROOF_SCHEMA,
  bellLockDigest,
  canonicalBellLockJson,
  evaluateBellLock,
  sanitizeBellLockObservation,
  sanitizeBellLockPolicy,
  type BellLockObservation,
  type BellLockPolicy,
  type BellLockProvenance,
} from "../lib/bell-lock.js";

const NOW = "2026-08-11T12:00:20.000Z";

function source(
  id: string,
  kind: BellLockProvenance["kind"],
  assurance: BellLockProvenance["assurance"],
  observedAt = "2026-08-11T12:00:15.000Z",
): BellLockProvenance {
  const verifierReceipt = kind === "chainlink-data-streams"
    ? {
        verifier: "robinhood-chain-data-streams-verifier" as const,
        chainId: 4663 as const,
        subject: id.includes("session")
          ? "market-session" as const
          : id.includes("close")
            ? "previous-close" as const
            : "equity-price" as const,
        feedId: id.includes("session") ? `0x${"11".repeat(32)}` : `0x${"22".repeat(32)}`,
        reportId: `${id}-report`,
        reportDigest: bellLockDigest({ id, observedAt }),
        verifiedAt: observedAt,
        expiresAt: new Date(Date.parse(observedAt) + 120_000).toISOString(),
        priceDecimals: id.includes("session") ? null : 4,
      }
    : null;
  return {
    id,
    kind,
    assurance,
    label: id,
    reference: verifierReceipt?.reportDigest ?? `${id}:reference`,
    observedAt,
    verifierReceipt,
  };
}

function policy(): BellLockPolicy {
  return {
    schema: BELL_LOCK_POLICY_SCHEMA,
    policyId: "bell-aapl-001",
    chainId: 4663,
    asset: "AAPL",
    side: "buy",
    armedAt: "2026-08-11T11:00:00.000Z",
    expiresAt: "2026-08-11T13:00:00.000Z",
    input: {
      token: "USDG",
      decimals: 6,
      exactRaw: "100000000",
      stressRaw: "250000000",
    },
    thresholds: {
      sessionMaxAgeMs: 60_000,
      observationMaxAgeMs: 60_000,
      minObservationSpacingMs: 5_000,
      maxConvergenceBps: 20,
      maxOpeningGapBps: 200,
      maxSpreadBps: 30,
      maxOracleDexDeviationBps: 30,
      maxExactPriceImpactBps: 30,
      maxStressPriceImpactBps: 50,
      signatureWindowMs: 75_000,
    },
  };
}

function observation(): BellLockObservation {
  const chainlinkSession = source(
    "chainlink-session-1",
    "chainlink-data-streams",
    "cryptographically-verified",
  );
  const previousChainlinkSession = source(
    "chainlink-session-closed",
    "chainlink-data-streams",
    "cryptographically-verified",
    "2026-08-11T11:59:55.000Z",
  );
  const robinhoodAsset = source(
    "robinhood-asset-1",
    "robinhood-stock-token-api",
    "official-api-observation",
  );
  const multiplier = source("erc8056-aapl-1", "erc-8056", "onchain-read");
  const previousClose = source(
    "chainlink-close-1",
    "chainlink-data-streams",
    "cryptographically-verified",
    "2026-08-10T20:00:00.000Z",
  );
  const openingRouteScan = source(
    "route-scan-opening",
    "hoodflow-route-scan",
    "reviewed-route-evaluation",
    "2026-08-11T12:00:05.000Z",
  );
  const confirmationRouteScan = source(
    "route-scan-confirmation",
    "hoodflow-route-scan",
    "reviewed-route-evaluation",
  );
  const openingIssuerPrice = source(
    "robinhood-price-opening",
    "robinhood-stock-token-api",
    "official-api-observation",
    "2026-08-11T12:00:05.000Z",
  );
  const confirmationIssuerPrice = source(
    "robinhood-price-confirmation",
    "robinhood-stock-token-api",
    "official-api-observation",
  );
  const openingOracle = source(
    "chainlink-price-open",
    "chainlink-data-streams",
    "cryptographically-verified",
    "2026-08-11T12:00:05.000Z",
  );
  const confirmationOracle = source(
    "chainlink-price-confirm",
    "chainlink-data-streams",
    "cryptographically-verified",
  );
  return {
    schema: BELL_LOCK_OBSERVATION_SCHEMA,
    capturedAt: NOW,
    asset: "AAPL",
    chainId: 4663,
    priceDecimals: 4,
    assetEvidence: {
      status: "active",
      tradingHalt: false,
      corporateAction: "clear",
      pendingMultiplier: "none",
      source: robinhoodAsset,
      multiplierSource: multiplier,
    },
    sessionEvidence: {
      state: "open",
      transition: "offline-to-active",
      signatureVerified: true,
      reportId: chainlinkSession.verifierReceipt!.reportId,
      observedAt: "2026-08-11T12:00:15.000Z",
      openedAt: "2026-08-11T12:00:00.000Z",
      source: chainlinkSession,
      previousReport: {
        state: "closed",
        reportId: previousChainlinkSession.verifierReceipt!.reportId,
        observedAt: previousChainlinkSession.observedAt,
        source: previousChainlinkSession,
      },
    },
    previousClose: {
      priceRaw: "1000000",
      observedAt: "2026-08-10T20:00:00.000Z",
      source: previousClose,
    },
    prices: [
      {
        id: openingOracle.verifierReceipt!.reportId,
        observedAt: "2026-08-11T12:00:05.000Z",
        oraclePriceRaw: "1010000",
        dexPriceRaw: "1010100",
        bidRaw: "1009500",
        askRaw: "1010500",
        oracleSource: openingOracle,
        dexSource: openingRouteScan,
        issuerSource: openingIssuerPrice,
      },
      {
        id: confirmationOracle.verifierReceipt!.reportId,
        observedAt: "2026-08-11T12:00:15.000Z",
        oraclePriceRaw: "1010500",
        dexPriceRaw: "1010400",
        bidRaw: "1010000",
        askRaw: "1011000",
        oracleSource: confirmationOracle,
        dexSource: confirmationRouteScan,
        issuerSource: confirmationIssuerPrice,
      },
    ],
    depth: {
      exactSize: {
        status: "available",
        inputRaw: "100000000",
        priceImpactBps: 20,
        minimumOutputRaw: "298000000000000000",
        quoteExpiresAt: "2026-08-11T12:01:20.000Z",
        selectedRouteId: "uniswap-v4-aapl-usdg",
        reviewedRouteIds: ["uniswap-v3-aapl-usdg", "uniswap-v4-aapl-usdg"],
        source: confirmationRouteScan,
      },
      stressSize: {
        status: "available",
        inputRaw: "250000000",
        priceImpactBps: 35,
        minimumOutputRaw: "742000000000000000",
        quoteExpiresAt: "2026-08-11T12:01:20.000Z",
        selectedRouteId: "uniswap-v4-aapl-usdg",
        reviewedRouteIds: ["uniswap-v3-aapl-usdg", "uniswap-v4-aapl-usdg"],
        source: confirmationRouteScan,
      },
    },
  };
}

function checkCode(result: ReturnType<typeof evaluateBellLock>, code: string) {
  return result.checks.find((item) => item.code === code);
}

test("opens a bounded BellProof window only after every gate passes", () => {
  const result = evaluateBellLock({ policy: policy(), observation: observation(), evaluatedAt: NOW });
  assert.equal(result.state, "ready");
  assert.equal(result.proof.schema, BELL_PROOF_SCHEMA);
  assert.equal(result.proof.kind, "bell-proof");
  assert.equal(result.proof.executionScope.globalBestExecutionClaimed, false);
  assert.equal(result.proof.executionScope.claim, "selected-from-reviewed-route-set");
  assert.match(result.proof.executionScope.notice, /not a claim of global best execution/i);
  assert.equal(result.proof.capabilities.signs, false);
  assert.equal(result.proof.capabilities.submitsTransaction, false);
  assert.equal(result.proof.requiresFreshUserSignature, true);
  assert.equal(result.proof.integrity.authenticatesPublisher, false);
  assert.equal(result.metrics.openingGapBps, 100);
  assert.equal(result.metrics.openingGapAbsoluteBps, 100);
  assert.equal(result.metrics.convergenceBps, 5);
  assert.equal(result.metrics.spreadBps, 10);
  assert.equal(result.metrics.oracleDexDeviationBps, 1);
  assert.equal(result.proof.validUntil, "2026-08-11T12:01:20.000Z");
  assert.match(result.proof.integrity.digest, /^0x[a-f0-9]{64}$/);
});

test("BellProof and RefusalProof payloads are deterministic", () => {
  const first = evaluateBellLock({ policy: policy(), observation: observation(), evaluatedAt: NOW });
  const second = evaluateBellLock({ policy: policy(), observation: observation(), evaluatedAt: NOW });
  assert.deepEqual(second, first);
  assert.equal(second.proof.integrity.digest, first.proof.integrity.digest);
  assert.equal(
    canonicalBellLockJson({ z: 1, a: { y: 2, b: 3 } }),
    canonicalBellLockJson({ a: { b: 3, y: 2 }, z: 1 }),
  );
  assert.equal(bellLockDigest({ z: 1, a: 2 }), bellLockDigest({ a: 2, z: 1 }));
});

test("verified closed sessions stay armed without opening a signature window", () => {
  const evidence = observation();
  evidence.sessionEvidence.state = "closed";
  evidence.sessionEvidence.transition = "none";
  evidence.sessionEvidence.openedAt = null;
  const result = evaluateBellLock({ policy: policy(), observation: evidence, evaluatedAt: NOW });
  assert.equal(result.state, "armed");
  assert.equal(result.proof.schema, REFUSAL_PROOF_SCHEMA);
  assert.equal(result.proof.kind, "refusal-proof");
  assert.equal(checkCode(result, "SESSION_CLOSED")?.status, "wait");
});

test("a closed session cannot hide an issuer safety block", () => {
  const evidence = observation();
  evidence.sessionEvidence.state = "closed";
  evidence.sessionEvidence.transition = "none";
  evidence.sessionEvidence.openedAt = null;
  evidence.assetEvidence.tradingHalt = true;
  const result = evaluateBellLock({ policy: policy(), observation: evidence, evaluatedAt: NOW });
  assert.equal(result.state, "blocked");
  assert.equal(checkCode(result, "TRADING_HALT_CLEAR")?.status, "block");
});

test("an open session with only one fresh observation remains warming", () => {
  const evidence = observation();
  evidence.prices = evidence.prices.slice(0, 1);
  const result = evaluateBellLock({ policy: policy(), observation: evidence, evaluatedAt: NOW });
  assert.equal(result.state, "warming");
  assert.equal(checkCode(result, "TWO_FRESH_OBSERVATIONS")?.status, "wait");
  assert.equal(result.proof.kind, "refusal-proof");
});

test("duplicate reports and insufficient spacing do not satisfy warm-up", () => {
  const duplicate = observation();
  duplicate.prices[1].id = duplicate.prices[0].id;
  assert.equal(evaluateBellLock({ policy: policy(), observation: duplicate, evaluatedAt: NOW }).state, "warming");

  const tooClose = observation();
  tooClose.prices[1].observedAt = "2026-08-11T12:00:06.000Z";
  assert.equal(evaluateBellLock({ policy: policy(), observation: tooClose, evaluatedAt: NOW }).state, "warming");
});

test("issuer, halt, corporate-action, and multiplier uncertainty all fail closed", () => {
  const cases: Array<[string, (value: BellLockObservation) => void, string]> = [
    ["inactive asset", (value) => { value.assetEvidence.status = "inactive"; }, "ASSET_ACTIVE"],
    ["unknown halt", (value) => { value.assetEvidence.tradingHalt = null; }, "TRADING_HALT_CLEAR"],
    ["corporate action", (value) => { value.assetEvidence.corporateAction = "pending"; }, "CORPORATE_ACTION_CLEAR"],
    ["multiplier conflict", (value) => { value.assetEvidence.pendingMultiplier = "conflict"; }, "PENDING_MULTIPLIER_CLEAR"],
  ];
  for (const [label, mutate, code] of cases) {
    const evidence = observation();
    mutate(evidence);
    const result = evaluateBellLock({ policy: policy(), observation: evidence, evaluatedAt: NOW });
    assert.equal(result.state, "blocked", label);
    assert.equal(checkCode(result, code)?.status, "block", label);
  }
});

test("market session evidence must be signed, fresh, open, and transition-bound", () => {
  const unsigned = observation();
  unsigned.sessionEvidence.signatureVerified = false;
  assert.equal(evaluateBellLock({ policy: policy(), observation: unsigned, evaluatedAt: NOW }).state, "blocked");

  const stale = observation();
  stale.sessionEvidence.observedAt = "2026-08-11T11:58:00.000Z";
  assert.equal(checkCode(evaluateBellLock({ policy: policy(), observation: stale, evaluatedAt: NOW }), "SESSION_FRESHNESS")?.status, "block");

  const noTransition = observation();
  noTransition.sessionEvidence.transition = "active";
  assert.equal(checkCode(evaluateBellLock({ policy: policy(), observation: noTransition, evaluatedAt: NOW }), "SESSION_TRANSITION")?.status, "block");

  const missingClosedReport = observation();
  missingClosedReport.sessionEvidence.previousReport = null;
  assert.equal(checkCode(evaluateBellLock({ policy: policy(), observation: missingClosedReport, evaluatedAt: NOW }), "SESSION_TRANSITION")?.status, "block");

  const replayedTransition = observation();
  replayedTransition.sessionEvidence.openedAt = "2026-08-11T10:00:00.000Z";
  assert.equal(checkCode(evaluateBellLock({ policy: policy(), observation: replayedTransition, evaluatedAt: NOW }), "SESSION_TRANSITION_REPLAY")?.status, "block");
});

test("verifier receipts bind report identity, feed units, and the ready-window expiry", () => {
  const shortened = observation();
  shortened.prices[1].oracleSource.verifierReceipt!.expiresAt = "2026-08-11T12:00:45.000Z";
  const shortenedResult = evaluateBellLock({ policy: policy(), observation: shortened, evaluatedAt: NOW });
  assert.equal(shortenedResult.state, "ready");
  assert.equal(shortenedResult.proof.kind, "bell-proof");
  assert.equal(shortenedResult.proof.validUntil, "2026-08-11T12:00:45.000Z");

  const expired = observation();
  expired.prices[1].oracleSource.verifierReceipt!.expiresAt = NOW;
  const expiredResult = evaluateBellLock({ policy: policy(), observation: expired, evaluatedAt: NOW });
  assert.equal(expiredResult.state, "blocked");
  assert.equal(checkCode(expiredResult, "ORACLE_PROVENANCE")?.status, "block");

  const replayedDigest = observation();
  const firstReceipt = replayedDigest.prices[0].oracleSource.verifierReceipt!;
  replayedDigest.prices[1].oracleSource.verifierReceipt!.reportDigest = firstReceipt.reportDigest;
  replayedDigest.prices[1].oracleSource.reference = firstReceipt.reportDigest;
  assert.equal(checkCode(evaluateBellLock({ policy: policy(), observation: replayedDigest, evaluatedAt: NOW }), "PRICE_REPORT_BINDING")?.status, "block");

  const wrongFeed = observation();
  wrongFeed.previousClose.source.verifierReceipt!.feedId = `0x${"ff".repeat(32)}`;
  assert.equal(checkCode(evaluateBellLock({ policy: policy(), observation: wrongFeed, evaluatedAt: NOW }), "PRICE_REPORT_BINDING")?.status, "block");
});

test("semantic provenance cannot be swapped between otherwise valid source types", () => {
  const wrongDex = observation();
  wrongDex.prices[0].dexSource = source(
    "official-api-in-dex-slot",
    "robinhood-stock-token-api",
    "official-api-observation",
  );
  const result = evaluateBellLock({ policy: policy(), observation: wrongDex, evaluatedAt: NOW });
  assert.equal(result.state, "blocked");
  assert.equal(checkCode(result, "MARKET_PRICE_PROVENANCE")?.status, "block");

  const wrongDepth = observation();
  wrongDepth.depth.exactSize.source = source(
    "official-api-in-depth-slot",
    "robinhood-stock-token-api",
    "official-api-observation",
  );
  assert.equal(checkCode(evaluateBellLock({ policy: policy(), observation: wrongDepth, evaluatedAt: NOW }), "EXACT_SIZE_PROVENANCE")?.status, "block");
});

test("gap, convergence, spread, and oracle/DEX deviation thresholds fail independently", () => {
  const cases: Array<[string, (value: BellLockPolicy, evidence: BellLockObservation) => void]> = [
    ["OPENING_GAP", (value) => { value.thresholds.maxOpeningGapBps = 50; }],
    ["OBSERVATION_CONVERGENCE", (_value, evidence) => { evidence.prices[1].oraclePriceRaw = "1020000"; }],
    ["BID_ASK_SPREAD", (_value, evidence) => { evidence.prices[1].askRaw = "1020000"; }],
    ["ORACLE_DEX_DEVIATION", (_value, evidence) => { evidence.prices[1].dexPriceRaw = "1020000"; }],
  ];
  for (const [code, mutate] of cases) {
    const value = policy();
    const evidence = observation();
    mutate(value, evidence);
    const result = evaluateBellLock({ policy: value, observation: evidence, evaluatedAt: NOW });
    assert.equal(result.state, "blocked", code);
    assert.equal(checkCode(result, code)?.status, "block", code);
  }
});

test("exact-size and stress-size depth gates are both mandatory", () => {
  const exact = observation();
  exact.depth.exactSize.priceImpactBps = 31;
  assert.equal(checkCode(evaluateBellLock({ policy: policy(), observation: exact, evaluatedAt: NOW }), "EXACT_SIZE_PRICE_IMPACT")?.status, "block");

  const stress = observation();
  stress.depth.stressSize.priceImpactBps = 51;
  assert.equal(checkCode(evaluateBellLock({ policy: policy(), observation: stress, evaluatedAt: NOW }), "STRESS_SIZE_PRICE_IMPACT")?.status, "block");

  const missingRoute = observation();
  missingRoute.depth.exactSize.reviewedRouteIds = ["uniswap-v3-aapl-usdg"];
  assert.equal(checkCode(evaluateBellLock({ policy: policy(), observation: missingRoute, evaluatedAt: NOW }), "EXACT_SIZE_ROUTE_SCOPE_INVALID")?.status, "block");

  const expiredQuote = observation();
  expiredQuote.depth.stressSize.quoteExpiresAt = NOW;
  assert.equal(checkCode(evaluateBellLock({ policy: policy(), observation: expiredQuote, evaluatedAt: NOW }), "STRESS_SIZE_QUOTE_EXPIRED")?.status, "block");
});

test("expired policies return an expired RefusalProof", () => {
  const value = policy();
  value.expiresAt = NOW;
  const result = evaluateBellLock({ policy: value, observation: observation(), evaluatedAt: NOW });
  assert.equal(result.state, "expired");
  assert.equal(result.proof.schema, REFUSAL_PROOF_SCHEMA);
  assert.equal(checkCode(result, "POLICY_EXPIRED")?.status, "block");
});

test("sanitizers reject unknown fields, unsafe bounds, bad raw amounts, and false provenance", () => {
  assert.throws(
    () => sanitizeBellLockPolicy({ ...policy(), surprise: true }),
    /invalid fields/,
  );
  const longLived = policy();
  longLived.expiresAt = "2027-08-11T13:00:00.000Z";
  assert.throws(() => sanitizeBellLockPolicy(longLived), /lifetime/);

  const malformedRaw = policy();
  malformedRaw.input.exactRaw = "1e6";
  assert.throws(() => sanitizeBellLockPolicy(malformedRaw), /exact input/);

  const falseAssurance = observation();
  falseAssurance.sessionEvidence.source.assurance = "official-api-observation";
  assert.throws(() => sanitizeBellLockObservation(falseAssurance), /inconsistent source assurance/);

  const noVerifierReceipt = observation();
  noVerifierReceipt.prices[0].oracleSource.verifierReceipt = null;
  assert.throws(() => sanitizeBellLockObservation(noVerifierReceipt), /verifier receipt/);

  const excessivePrices = observation();
  excessivePrices.prices = Array.from({ length: 9 }, (_, index) => ({
    ...excessivePrices.prices[0],
    id: `price-${index}`,
  }));
  assert.throws(() => sanitizeBellLockObservation(excessivePrices), /bounded array/);
});

test("conflicting provenance cannot be hidden behind a reused source id", () => {
  const evidence = observation();
  evidence.prices[1].dexSource = {
    ...evidence.prices[1].dexSource,
    reference: "different-route-scan",
  };
  assert.throws(
    () => evaluateBellLock({ policy: policy(), observation: evidence, evaluatedAt: NOW }),
    /conflicting provenance/,
  );
});
