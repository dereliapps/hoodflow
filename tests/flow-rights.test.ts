import assert from "node:assert/strict";
import test from "node:test";

import robinhoodMainnet from "../config/robinhood-mainnet.json" with { type: "json" };
import {
  buildMultiplierPreview,
  clearPaydayCache,
  getPaydayData,
  normalizePaydayTicker,
  PaydayValidationError,
} from "../lib/flow-rights.js";
import {
  paydayAction,
  paydayAsset,
  paydayFetch,
  paydayOnchain,
  PAYDAY_FIXTURE_TIME,
} from "./fixtures/payday.js";

const NOW = () => new Date(PAYDAY_FIXTURE_TIME);

function assertReadOnly(result: Awaited<ReturnType<typeof getPaydayData>>) {
  assert.equal(result.handoffAllowed, false);
  assert.equal(result.handoff, null);
  assert.equal(result.executionHandoff, null);
  assert.match(result.safety, /No transaction/);
  assert.equal(result.capabilities.signs, false);
  assert.equal(result.capabilities.submitsTransaction, false);
  assert.equal(result.capabilities.requestsWalletPermission, false);
  assert.equal(result.capabilities.createsClaimToken, false);
  assert.equal(result.capabilities.controlsFunds, false);
  assert.equal(result.capabilities.createsEntitlement, false);
  assert.equal(result.integrity.authenticating, false);
  assert.match(result.integrity.checksum, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.integrity.notice, /not a signature/i);
}

test("uses exact 18-decimal BigInt math and rounds retained principal up", () => {
  const preview = buildMultiplierPreview(
    "1.000000000000000000",
    "1.500000000000000000",
  );
  assert.ok(preview);
  assert.equal(preview.principalPreservingRawBalance, "0.666666666666666667");
  assert.equal(preview.harvestRawAmount, "0.333333333333333333");
  assert.match(preview.formula, /ceil/);
  assert.match(preview.rounding, /rounded up/);
  assert.equal(buildMultiplierPreview("1", "1"), null);
  assert.equal(buildMultiplierPreview("2", "1"), null);
});

test("accepts only an indexed ticker and never client evidence", () => {
  assert.equal(normalizePaydayTicker(" aapl "), "AAPL");
  assert.throws(() => normalizePaydayTicker("NOT_REAL"), PaydayValidationError);
  assert.throws(() => normalizePaydayTicker("AAPL&evidence=forged"), PaydayValidationError);
});

test("marks an exact canonical in-progress cash dividend eligible", async () => {
  clearPaydayCache();
  const result = await getPaydayData("AAPL", {
    fetchImpl: paydayFetch(),
    now: NOW,
    useCache: false,
    readOnchainState: paydayOnchain(),
  });
  assert.equal(result.asset.contractAddress, robinhoodMainnet.tokens.AAPL.toLowerCase());
  assert.equal(result.asset.chainId, 4663);
  assert.equal(result.eligibility.state, "eligible");
  assert.equal(result.eligibility.code, "CONCURRENT_MULTIPLIER_TRANSITION_READY");
  assert.equal(
    result.corporateAction?.classification,
    "multiplier-transition-concurrent-with-cash-dividend-process-date",
  );
  assert.equal(result.corporateAction?.processDate, "2026-08-13");
  assert.equal("effectiveAt" in (result.corporateAction ?? {}), false);
  assert.match(result.eligibility.reason, /temporal correlation, not proof/i);
  assert.equal(result.preview?.harvestRawAmount, "0.333333333333333333");
  assert.equal(result.preview?.estimatedUsdg, null);
  assertReadOnly(result);
});

test("keeps completed dividends reference-only without a proven pre-event multiplier", async () => {
  clearPaydayCache();
  const result = await getPaydayData("AAPL", {
    fetchImpl: paydayFetch(
      paydayAsset({ pendingMultiplier: "", pendingMultiplierEffectiveTime: null }),
      [paydayAction({ status: "CORPORATE_ACTION_STATUS_COMPLETED" })],
    ),
    now: NOW,
    useCache: false,
    readOnchainState: paydayOnchain({
      pendingMultiplier: "1.000000000000000000",
      effectiveAt: null,
    }),
  });
  assert.equal(result.eligibility.state, "pending");
  assert.equal(result.eligibility.code, "HISTORICAL_MULTIPLIER_BASELINE_UNAVAILABLE");
  assert.equal(result.corporateAction?.classification, "cash-dividend-record-only");
  assert.equal(result.preview, null);
  assertReadOnly(result);
});

test("never classifies a split, stock dividend, name change, or unknown action as yield", async () => {
  for (const type of [
    "CORPORATE_ACTION_TYPE_FORWARD_SPLIT",
    "CORPORATE_ACTION_TYPE_STOCK_DIVIDEND",
    "CORPORATE_ACTION_TYPE_NAME_CHANGE",
    "CORPORATE_ACTION_TYPE_UNKNOWN_FUTURE_EVENT",
  ]) {
    clearPaydayCache();
    const result = await getPaydayData("AAPL", {
      fetchImpl: paydayFetch(paydayAsset(), [paydayAction({ type })]),
      now: NOW,
      useCache: false,
      readOnchainState: paydayOnchain(),
    });
    assert.equal(result.eligibility.state, "blocked", type);
    assert.equal(result.eligibility.code, "NOT_CASH_DIVIDEND", type);
    assert.equal(result.corporateAction?.classification, "not-qualified", type);
    assert.equal(result.preview, null, type);
    assertReadOnly(result);
  }
});

test("fails closed when corporate-action UID or chain 4663 deployment differs", async () => {
  const cases = [
    paydayAction({ id: `0x${"22".repeat(32)}` }),
    paydayAction({
      deployments: [{
        chainId: 4663,
        contractAddress: "0x0000000000000000000000000000000000000001",
      }],
    }),
  ];
  for (const action of cases) {
    clearPaydayCache();
    const result = await getPaydayData("AAPL", {
      fetchImpl: paydayFetch(paydayAsset(), [action]),
      now: NOW,
      useCache: false,
      readOnchainState: paydayOnchain(),
    });
    assert.equal(result.eligibility.state, "blocked");
    assert.equal(result.eligibility.code, "ACTION_IDENTITY_MISMATCH");
    assert.equal(result.corporateAction?.classification, "not-qualified");
    assert.equal(result.preview, null);
    assertReadOnly(result);
  }
});

test("fails closed when multiplier timing is not concurrent with the process date", async () => {
  clearPaydayCache();
  const result = await getPaydayData("AAPL", {
    fetchImpl: paydayFetch(paydayAsset({
      pendingMultiplierEffectiveTime: "2026-08-14T13:30:00.000Z",
    })),
    now: NOW,
    useCache: false,
    readOnchainState: paydayOnchain({
      effectiveAt: "2026-08-14T13:30:00.000Z",
    }),
  });
  assert.equal(result.eligibility.state, "pending");
  assert.equal(result.eligibility.code, "MULTIPLIER_TRANSITION_PENDING");
  assert.equal(result.preview, null);
  assertReadOnly(result);
});

test("returns an unavailable refusal preview when either official source fails", async () => {
  clearPaydayCache();
  const result = await getPaydayData("AAPL", {
    fetchImpl: (async () => new Response(null, { status: 503 })) as typeof fetch,
    now: NOW,
    useCache: false,
    readOnchainState: paydayOnchain(),
  });
  assert.equal(result.eligibility.state, "unavailable");
  assert.equal(result.eligibility.code, "OFFICIAL_SOURCE_UNAVAILABLE");
  assert.equal(result.preview, null);
  assertReadOnly(result);
});

test("requires canonical onchain UID and multiplier state to match the official API", async () => {
  for (const readOnchainState of [
    paydayOnchain({ chainId: 1 }),
    paydayOnchain({ uid: `0x${"33".repeat(32)}` }),
    paydayOnchain({ currentMultiplier: "1.01" }),
    paydayOnchain({ pendingMultiplier: "1.6" }),
    paydayOnchain({ effectiveAt: "2026-08-14T13:30:00.000Z" }),
  ]) {
    clearPaydayCache();
    const result = await getPaydayData("AAPL", {
      fetchImpl: paydayFetch(),
      now: NOW,
      useCache: false,
      readOnchainState,
    });
    assert.equal(result.eligibility.state, "blocked");
    assert.equal(result.eligibility.code, "ONCHAIN_STATE_MISMATCH");
    assert.equal(result.preview, null);
    assertReadOnly(result);
  }
});

test("rejects same-date corporate-action ambiguity instead of inferring causality", async () => {
  clearPaydayCache();
  const result = await getPaydayData("AAPL", {
    fetchImpl: paydayFetch(paydayAsset(), [
      paydayAction(),
      paydayAction({
        id: `0x${"44".repeat(32)}`,
        type: "CORPORATE_ACTION_TYPE_FORWARD_SPLIT",
        details: {},
      }),
    ]),
    now: NOW,
    useCache: false,
    readOnchainState: paydayOnchain(),
  });
  assert.equal(result.eligibility.state, "blocked");
  assert.equal(result.eligibility.code, "AMBIGUOUS_ACTIVE_ACTIONS");
  assert.equal(result.corporateAction?.classification, "not-qualified");
  assert.equal(result.preview, null);
  assertReadOnly(result);
});

test("rejects a non-cash action on the same process date", async () => {
  clearPaydayCache();
  const result = await getPaydayData("AAPL", {
    fetchImpl: paydayFetch(paydayAsset(), [
      paydayAction(),
      paydayAction({
        id: `0x${"55".repeat(32)}`,
        status: "CORPORATE_ACTION_STATUS_COMPLETED",
        type: "CORPORATE_ACTION_TYPE_FORWARD_SPLIT",
        details: {},
      }),
    ]),
    now: NOW,
    useCache: false,
    readOnchainState: paydayOnchain(),
  });
  assert.equal(result.eligibility.state, "blocked");
  assert.equal(result.eligibility.code, "AMBIGUOUS_PROCESS_DATE_ACTIONS");
  assert.equal(result.corporateAction?.classification, "not-qualified");
  assert.equal(result.preview, null);
  assertReadOnly(result);
});

test("starts official and onchain evidence collection concurrently", async () => {
  clearPaydayCache();
  let releaseOfficial!: () => void;
  const officialGate = new Promise<void>((resolve) => { releaseOfficial = resolve; });
  const baseFetch = paydayFetch();
  const onchainFixture = paydayOnchain();
  let onchainStarted = false;
  const pending = getPaydayData("AAPL", {
    fetchImpl: (async (input, init) => {
      await officialGate;
      return baseFetch(input, init);
    }) as typeof fetch,
    now: NOW,
    useCache: false,
    readOnchainState: async () => {
      onchainStarted = true;
      return onchainFixture();
    },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(onchainStarted, true);
  releaseOfficial();
  const result = await pending;
  assert.equal(result.eligibility.state, "eligible");
  assertReadOnly(result);
});

test("fails unavailable rather than trusting API-only multiplier evidence", async () => {
  clearPaydayCache();
  const result = await getPaydayData("AAPL", {
    fetchImpl: paydayFetch(),
    now: NOW,
    useCache: false,
    readOnchainState: async () => { throw new Error("RPC offline"); },
  });
  assert.equal(result.eligibility.state, "unavailable");
  assert.equal(result.eligibility.code, "ONCHAIN_STATE_UNAVAILABLE");
  assert.equal(result.preview, null);
  assert.equal(result.capabilities.signs, false);
  assert.equal(result.capabilities.submitsTransaction, false);
  assertReadOnly(result);
});
