import assert from "node:assert/strict";
import test from "node:test";

import {
  clearActionLockCache,
  createActionLockPassport,
  evaluateActionLock,
  fetchOfficialActionLockEvidence,
  stableActionLockFingerprint,
  type OfficialActionLockEvidence,
} from "../lib/action-lock.js";
import type { AgentQuote, AgentQuoteRequest } from "../lib/hoodflow-agent.js";
import { ROBINHOOD_TOKENS, fromUiAmount, toUiAmount } from "../lib/hoodflow-mainnet.js";

const OBSERVED_AT = "2026-08-07T12:00:00.000Z";
const EXPIRES_AT = "2026-08-07T12:01:15.000Z";
const REQUEST: AgentQuoteRequest = { asset: "AAPL", side: "buy", amount: "25", slippageBps: 50 };

function quote(): AgentQuote {
  return {
    quoteId: "hf-aapl-test",
    status: "indicative-preflight",
    chain: { id: 4663, name: "Robinhood Chain" },
    asset: "AAPL",
    side: "buy",
    pay: {
      ticker: "USDG",
      address: ROBINHOOD_TOKENS.USDG,
      amount: "25.0",
      rawAmount: "25000000",
      decimals: 6,
    },
    receive: {
      ticker: "AAPL",
      address: ROBINHOOD_TOKENS.AAPL,
      estimatedAmount: "0.25",
      indicativeMinimumAmount: "0.24875",
      rawEstimatedAmount: "125000000000000000",
      rawIndicativeMinimumAmount: "124375000000000000",
      decimals: 18,
    },
    route: { protocol: "Uniswap V4", fee: 500, feeBps: 5, tickSpacing: 10, gasEstimate: "150000" },
    protection: { slippageBps: 50, dataExpiresAt: EXPIRES_AT, executionBinding: "none-requote-required" },
    reference: {
      status: "live",
      price: 200,
      impliedDexPrice: 200,
      deviationBps: 0,
      maxDeviationBps: 100,
      updatedAt: 1_786_104_000,
      heartbeat: 86_400,
      oraclePaused: false,
    },
    uiScaling: {
      standard: "ERC-8056",
      multiplier: "2.0",
      multiplierRaw: "2000000000000000000",
      rawOperations: true,
    },
    custody: "self-custody",
    requiresUserSignature: true,
    executionHandoff: {
      marketPath: "/?asset=AAPL&agentSide=buy&agentAmount=25&agentSlippageBps=50",
      marketUrl: "https://hoodflow.app/?asset=AAPL&agentSide=buy&agentAmount=25&agentSlippageBps=50",
      intent: REQUEST,
      instruction: "Request a fresh execution-bound quote and confirm it in the user's wallet.",
    },
    quotedAt: OBSERVED_AT,
  };
}

function clearEvidence(): OfficialActionLockEvidence {
  return {
    asset: {
      status: "available",
      source: "https://api.robinhood.com/rhj/assets",
      fetchedAt: OBSERVED_AT,
      value: {
        uid: `0x${"1".repeat(64)}`,
        tokenSymbol: "AAPL",
        tokenName: "Apple • Robinhood Token",
        deployments: [{ chainId: 4663, contractAddress: ROBINHOOD_TOKENS.AAPL }],
        currentMultiplier: "2.000000000000000000",
        pendingMultiplier: null,
        pendingMultiplierEffectiveTime: null,
        status: "ASSET_STATUS_ACTIVE",
        tradingCapabilities: {
          fractionalTradability: "untradable",
          allDayTradability: "untradable",
          extendedHoursFractionalTradability: false,
          market: null,
          extended: null,
          overnight: null,
        },
      },
    },
    price: {
      status: "available",
      source: "https://api.robinhood.com/rhj/prices/AAPL",
      fetchedAt: OBSERVED_AT,
      value: {
        tokenSymbol: "AAPL",
        deployments: [{ chainId: 4663, contractAddress: ROBINHOOD_TOKENS.AAPL }],
        bid: "100.25",
        ask: "100.5",
        currency: "USD",
        isTradingHalt: false,
        generatedAt: OBSERVED_AT,
      },
    },
    corporateActions: {
      status: "available",
      source: "https://api.robinhood.com/rhj/corporate-actions",
      fetchedAt: OBSERVED_AT,
      value: [],
    },
    onchainMultiplier: {
      status: "available",
      source: "Robinhood Chain ERC-8056",
      fetchedAt: OBSERVED_AT,
      value: {
        currentMultiplier: "2.0",
        pendingMultiplier: "2.0",
        effectiveAt: null,
      },
    },
  };
}

function checkCode(evaluation: ReturnType<typeof evaluateActionLock>, code: string) {
  return evaluation.checks.find((check) => check.code === code);
}

test("returns a deterministic clear passport with multiplier-adjusted issuer prices", async () => {
  const evidence = clearEvidence();
  const evaluation = evaluateActionLock(quote(), evidence, OBSERVED_AT);
  assert.equal(evaluation.decision, "clear");
  assert.equal(evaluation.issuerState.officialBid, "100.25");
  assert.equal(evaluation.issuerState.adjustedBid, "200.5");
  assert.equal(evaluation.issuerState.adjustedAsk, "201");
  assert.equal(evaluation.issuerState.marketStatus, "ACTIVE");
  assert.equal(evaluation.issuerState.tradingCapabilities?.fractionalTradability, "untradable");
  assert.ok(evaluation.checks.every((check) => check.status === "pass"));

  const passport = await createActionLockPassport(REQUEST, quote(), evidence, OBSERVED_AT);
  assert.equal(passport.handoffAllowed, true);
  assert.equal(passport.feature, "HoodFlow ActionLock");
  assert.equal(passport.policyVersion, "1.0.0");
  assert.equal(passport.observedAt, OBSERVED_AT);
  assert.equal(passport.executionHandoff?.intent.asset, "AAPL");
  assert.match(passport.stateFingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.match(passport.fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(passport.capabilities, {
    signs: false,
    submitsTransaction: false,
    requestsWalletPermission: false,
  });
});

test("treats trading capabilities as context rather than a DEX execution rule", () => {
  const evaluation = evaluateActionLock(quote(), clearEvidence(), OBSERVED_AT);
  assert.equal(evaluation.issuerState.tradingCapabilities?.allDayTradability, "untradable");
  assert.equal(evaluation.decision, "clear");
});

test("blocks explicit inactive, halt, in-progress action, and canonical mismatch signals", () => {
  const cases: Array<[string, (evidence: OfficialActionLockEvidence) => void, string]> = [
    ["inactive", (evidence) => { evidence.asset.value!.status = "ASSET_STATUS_INACTIVE"; }, "TOKEN_INACTIVE"],
    ["halt", (evidence) => { evidence.price.value!.isTradingHalt = true; }, "TRADING_HALT"],
    ["deployment mismatch", (evidence) => {
      evidence.asset.value!.deployments[0]!.contractAddress = "0x0000000000000000000000000000000000000001";
    }, "CANONICAL_DEPLOYMENT_MISMATCH"],
    ["in-progress action", (evidence) => {
      evidence.corporateActions.value = [{
        id: `0x${"2".repeat(64)}`,
        tokenSymbol: "AAPL",
        type: "CORPORATE_ACTION_TYPE_FORWARD_SPLIT",
        status: "CORPORATE_ACTION_STATUS_IN_PROGRESS",
        effectiveAt: "2026-08-08T00:00:00.000Z",
        detailKind: "forwardSplit",
        detailValues: { underlyingSymbol: "AAPL", oldRate: "1", newRate: "4" },
      }];
    }, "CORPORATE_ACTION_IN_PROGRESS"],
  ];

  for (const [label, mutate, code] of cases) {
    const evidence = clearEvidence();
    mutate(evidence);
    const evaluation = evaluateActionLock(quote(), evidence, OBSERVED_AT);
    assert.equal(evaluation.decision, "blocked", label);
    assert.equal(checkCode(evaluation, code)?.status, "block", label);
  }
});

test("blocks a pending multiplier inside the quote TTL but clears one after it", async () => {
  const inside = clearEvidence();
  inside.asset.value!.pendingMultiplier = "4.000000000000000000";
  inside.asset.value!.pendingMultiplierEffectiveTime = "2026-08-07T12:01:00.000Z";
  const blocked = evaluateActionLock(quote(), inside, OBSERVED_AT);
  assert.equal(blocked.decision, "blocked");
  assert.equal(checkCode(blocked, "MULTIPLIER_CHANGES_DURING_TTL")?.status, "block");
  const blockedPassport = await createActionLockPassport(REQUEST, quote(), inside, OBSERVED_AT);
  assert.equal(blockedPassport.handoffAllowed, false);
  assert.equal(blockedPassport.executionHandoff, null);

  const outside = clearEvidence();
  outside.asset.value!.pendingMultiplier = "4.000000000000000000";
  outside.asset.value!.pendingMultiplierEffectiveTime = "2026-08-07T12:02:00.000Z";
  outside.onchainMultiplier.value = {
    currentMultiplier: "2.0",
    pendingMultiplier: "4.0",
    effectiveAt: "2026-08-07T12:02:00.000Z",
  };
  const aligned = evaluateActionLock(quote(), outside, OBSERVED_AT);
  assert.equal(aligned.decision, "clear");
  assert.equal(checkCode(aligned, "MULTIPLIER_STABLE_DURING_TTL")?.status, "pass");
});

test("blocks an explicit API-to-ERC-8056 current multiplier mismatch", () => {
  const evidence = clearEvidence();
  evidence.onchainMultiplier.value!.currentMultiplier = "3.0";
  evidence.onchainMultiplier.value!.pendingMultiplier = "3.0";
  const evaluation = evaluateActionLock(quote(), evidence, OBSERVED_AT);
  assert.equal(evaluation.decision, "blocked");
  assert.equal(checkCode(evaluation, "MULTIPLIER_SOURCE_MISMATCH")?.status, "block");
});

test("blocks a quote whose ERC-8056 display scaling is not bound to the verified multiplier", () => {
  const mismatchedQuote = quote();
  mismatchedQuote.uiScaling.multiplier = "1.0";
  mismatchedQuote.uiScaling.multiplierRaw = "1000000000000000000";
  const evaluation = evaluateActionLock(mismatchedQuote, clearEvidence(), OBSERVED_AT);
  assert.equal(evaluation.decision, "blocked");
  assert.equal(checkCode(evaluation, "MULTIPLIER_SOURCE_MISMATCH")?.status, "block");
});

test("watches stale official prices and blocks material adjusted-price divergence", () => {
  const stale = clearEvidence();
  stale.price.value!.generatedAt = "2026-08-07T11:50:00.000Z";
  const staleEvaluation = evaluateActionLock(quote(), stale, OBSERVED_AT);
  assert.equal(staleEvaluation.decision, "watch");
  assert.equal(checkCode(staleEvaluation, "OFFICIAL_PRICE_STALE")?.status, "watch");

  const divergedQuote = quote();
  divergedQuote.reference.price = 150;
  const divergence = evaluateActionLock(divergedQuote, clearEvidence(), OBSERVED_AT);
  assert.equal(divergence.decision, "blocked");
  assert.equal(checkCode(divergence, "OFFICIAL_PRICE_DIVERGENCE")?.status, "block");
});

test("converts between ERC-8056 raw and UI amounts without changing raw token operations", () => {
  const raw = 1_250_000_000_000_000_000n;
  const multiplier = 2_000_000_000_000_000_000n;
  const ui = toUiAmount(raw, multiplier);
  assert.equal(ui, 2_500_000_000_000_000_000n);
  assert.equal(fromUiAmount(ui, multiplier), raw);
});

test("returns watch, null-safe issuer data, and preserves the user-controlled handoff", async () => {
  const unavailable: OfficialActionLockEvidence = {
    asset: { status: "unavailable", source: "assets", fetchedAt: OBSERVED_AT, value: null },
    price: { status: "unavailable", source: "prices", fetchedAt: OBSERVED_AT, value: null },
    corporateActions: { status: "unavailable", source: "actions", fetchedAt: OBSERVED_AT, value: null },
    onchainMultiplier: { status: "unavailable", source: "erc8056", fetchedAt: OBSERVED_AT, value: null },
  };
  const evaluation = evaluateActionLock(quote(), unavailable, OBSERVED_AT);
  assert.equal(evaluation.decision, "watch");
  assert.equal(evaluation.issuerState.officialBid, null);
  assert.equal(evaluation.issuerState.adjustedBid, null);
  assert.equal(evaluation.corporateAction.status, "UNAVAILABLE");
  assert.ok(evaluation.reasons.some((reason) => reason.code === "OFFICIAL_ASSET_UNAVAILABLE"));
  assert.ok(evaluation.reasons.some((reason) => reason.code === "OFFICIAL_PRICE_UNAVAILABLE"));
  assert.ok(evaluation.reasons.some((reason) => reason.code === "CORPORATE_ACTIONS_UNAVAILABLE"));

  const passport = await createActionLockPassport(REQUEST, quote(), unavailable, OBSERVED_AT);
  assert.equal(passport.handoffAllowed, true);
  assert.equal(passport.executionHandoff?.intent.asset, "AAPL");
});

test("canonical fingerprint is stable across object key order", async () => {
  const left = await stableActionLockFingerprint({ b: 2, a: { d: 4, c: 3 } });
  const right = await stableActionLockFingerprint({ a: { c: 3, d: 4 }, b: 2 });
  assert.equal(left, right);
});

test("state fingerprint ignores per-quote identity while the full passport digest does not", async () => {
  const firstQuote = quote();
  const secondQuote = { ...quote(), quoteId: "hf-aapl-another-test" };
  const first = await createActionLockPassport(REQUEST, firstQuote, clearEvidence(), OBSERVED_AT);
  const second = await createActionLockPassport(REQUEST, secondQuote, clearEvidence(), OBSERVED_AT);
  assert.equal(first.stateFingerprint, second.stateFingerprint);
  assert.notEqual(first.fingerprint, second.fingerprint);
});

test("fetches fixed official endpoints and reuses successful conservative cache entries", async () => {
  clearActionLockCache();
  const calls: string[] = [];
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    if (url.endsWith("/rhj/assets")) {
      return Response.json({ assets: [{
        id: `0x${"3".repeat(64)}`,
        tokenSymbol: "AAPL",
        tokenName: "Apple • Robinhood Token",
        deployments: [{ chainId: 4663, contractAddress: ROBINHOOD_TOKENS.AAPL }],
        currentMultiplier: "1.000000000000000000",
        pendingMultiplier: "",
        status: "ASSET_STATUS_ACTIVE",
        tradingCapabilities: null,
      }] });
    }
    if (url.endsWith("/rhj/prices/AAPL")) {
      return Response.json({ quotes: [{
        tokenSymbol: "AAPL",
        deployments: [{ chainId: 4663, contractAddress: ROBINHOOD_TOKENS.AAPL }],
        bid: "200",
        ask: "201",
        currency: "USD",
        isTradingHalt: false,
        generatedAt: OBSERVED_AT,
      }] });
    }
    if (url.endsWith("/rhj/corporate-actions")) return Response.json({ corpActions: [] });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  const options = {
    fetchImpl: fakeFetch,
    now: () => new Date(OBSERVED_AT),
    timeoutMs: 50,
    readOnchainMultiplier: async () => ({
      currentMultiplier: "1.0",
      pendingMultiplier: "1.0",
      effectiveAt: null,
    }),
  };

  const first = await fetchOfficialActionLockEvidence("AAPL", options);
  const second = await fetchOfficialActionLockEvidence("AAPL", options);
  assert.equal(first.asset.status, "available");
  assert.equal(first.price.status, "available");
  assert.deepEqual(second, first);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.sort(), [
    "https://api.robinhood.com/rhj/assets",
    "https://api.robinhood.com/rhj/corporate-actions",
    "https://api.robinhood.com/rhj/prices/AAPL",
  ]);
  clearActionLockCache();
});

test("exposes only bounded diagnostics when an official source is unavailable", async () => {
  clearActionLockCache();
  const evidence = await fetchOfficialActionLockEvidence("AAPL", {
    fetchImpl: (async () => new Response(null, { status: 403 })) as typeof fetch,
    now: () => new Date(OBSERVED_AT),
    timeoutMs: 50,
    useCache: false,
    readOnchainMultiplier: async () => ({
      currentMultiplier: "1.0",
      pendingMultiplier: "1.0",
      effectiveAt: null,
    }),
  });
  assert.equal(evidence.asset.diagnostic, "http-4xx");
  assert.equal(evidence.price.diagnostic, "http-4xx");
  assert.equal(evidence.corporateActions.diagnostic, "http-4xx");
  assert.equal(evidence.onchainMultiplier.diagnostic, undefined);
});
