import assert from "node:assert/strict";
import test from "node:test";
import { Interface, id, toBeHex, zeroPadValue } from "ethers";

import {
  FILL_PROOF_SNAPSHOT_SCHEMA,
  canonicalJson,
  createFillProof,
  fillProofChecksum,
  isFillProofLocalSnapshot,
  rawDeltaBps,
  type FillProofSource,
} from "../lib/fill-proof.js";
import {
  PERMIT2_ADDRESS,
  ROBINHOOD_MAINNET,
  ROBINHOOD_TOKENS,
  UNIVERSAL_ROUTER_ABI,
  UNIVERSAL_ROUTER_ADDRESS,
  USDG_ADDRESS,
  V3_ROUTE_FEES,
  V4_POOL_CANDIDATES,
  buildV3ExactInputCalldata,
  buildV4ExactInputCalldata,
  type PermitSingle,
} from "../lib/hoodflow-mainnet.js";

const wallet = "0x1111111111111111111111111111111111111111";
const pool = "0x2222222222222222222222222222222222222222";
const router = new Interface(UNIVERSAL_ROUTER_ABI);
const transferTopic = id("Transfer(address,address,uint256)");
const deadline = 2_000_000_000;

function permit(token: string, amount: bigint): PermitSingle {
  return {
    details: { token, amount, expiration: deadline, nonce: 0n },
    spender: UNIVERSAL_ROUTER_ADDRESS,
    sigDeadline: deadline,
  };
}

function source(args: {
  protocol: "V3" | "V4";
  side: "buy" | "sell";
  amountIn?: bigint;
  minimumOut?: bigint;
  actualOut?: bigint;
  permitAmount?: bigint;
  generatedAt?: string;
}): FillProofSource {
  const ticker = args.protocol === "V3" ? "SLV" : "AAPL";
  const stock = ROBINHOOD_TOKENS[ticker];
  const tokenIn = args.side === "buy" ? USDG_ADDRESS : stock;
  const tokenOut = args.side === "buy" ? stock : USDG_ADDRESS;
  const amountIn = args.amountIn ?? (args.side === "buy" ? 1_000_000n : 1_000_000_000_000_000n);
  const minimumOut = args.minimumOut ?? (args.side === "buy" ? 900_000_000_000_000n : 900_000n);
  const actualOut = args.actualOut ?? minimumOut + minimumOut / 100n;
  const signedPermit = permit(tokenIn, args.permitAmount ?? amountIn);
  const calldata = args.protocol === "V3"
    ? buildV3ExactInputCalldata({
        tokenIn,
        tokenOut,
        recipient: wallet,
        amountIn,
        minAmountOut: minimumOut,
        fee: V3_ROUTE_FEES[ticker],
        permit: signedPermit,
        signature: "0x1234",
      })
    : buildV4ExactInputCalldata({
        tokenIn,
        tokenOut,
        amountIn,
        minAmountOut: minimumOut,
        route: V4_POOL_CANDIDATES[0],
        permit: signedPermit,
        signature: "0x1234",
      });
  const transactionData = router.encodeFunctionData("execute", [calldata.commands, calldata.inputs, deadline]);
  const txHash = `0x${"12".repeat(32)}`;
  return {
    chainId: ROBINHOOD_MAINNET.chainIdNumber,
    transaction: { hash: txHash, from: wallet, to: UNIVERSAL_ROUTER_ADDRESS, data: transactionData },
    receipt: {
      status: 1,
      hash: txHash,
      from: wallet,
      to: UNIVERSAL_ROUTER_ADDRESS,
      blockHash: `0x${"34".repeat(32)}`,
      blockNumber: 15_000_000,
      gasUsed: 250_000n,
      gasPrice: 2_000_000n,
      logs: [{
        address: tokenOut,
        topics: [transferTopic, zeroPadValue(pool, 32), zeroPadValue(wallet, 32)],
        data: zeroPadValue(toBeHex(actualOut), 32),
      }],
    },
    blockTimestamp: 1_800_000_000,
    uiMultiplierRaw: 1_000_000_000_000_000_000n,
    generatedAt: args.generatedAt,
  };
}

for (const protocol of ["V3", "V4"] as const) {
  for (const side of ["buy", "sell"] as const) {
    test(`reconstructs a protected ${protocol} ${side} fill`, () => {
      const proof = createFillProof(source({ protocol, side }));
      assert.equal(proof.route.protocol, protocol);
      assert.equal(proof.side, side);
      assert.equal(proof.amounts.output.minimumSatisfied, true);
      assert.equal(proof.amounts.output.minimumSurplusBps, 100);
      assert.equal(proof.checks.length, 6);
      assert.match(proof.integrity.digest, /^0x[a-f0-9]{64}$/);
    });
  }
}

test("rejects wrong sender, router and unrelated settlement logs", () => {
  const wrongSender = source({ protocol: "V4", side: "buy" });
  wrongSender.receipt.from = "0x3333333333333333333333333333333333333333";
  assert.throws(() => createFillProof(wrongSender), /sender/);

  const wrongRouter = source({ protocol: "V4", side: "buy" });
  wrongRouter.transaction.to = PERMIT2_ADDRESS;
  assert.throws(() => createFillProof(wrongRouter), /Universal Router/);

  const unrelatedLog = source({ protocol: "V4", side: "buy" });
  unrelatedLog.receipt.logs = unrelatedLog.receipt.logs.map((log) => ({ ...log, address: PERMIT2_ADDRESS }));
  assert.throws(() => createFillProof(unrelatedLog), /not settled/);
});

test("rejects a Permit2 amount wider than the exact swap input", () => {
  assert.throws(
    () => createFillProof(source({ protocol: "V4", side: "buy", amountIn: 1_000_000n, permitAmount: 2_000_000n })),
    /exceeds the exact HoodFlow input/,
  );
});

test("rejects zero-minimum calldata instead of calling it protected", () => {
  const fill = source({ protocol: "V3", side: "buy", minimumOut: 0n, actualOut: 1n });
  assert.throws(() => createFillProof(fill), /positive HoodFlow input and protection bounds/);
});

test("canonical checksum ignores object key order and generated time", () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, b: 3 } }), canonicalJson({ a: { b: 3, y: 2 }, z: 1 }));
  assert.equal(fillProofChecksum({ z: 1, a: 2 }), fillProofChecksum({ a: 2, z: 1 }));
  const first = createFillProof(source({ protocol: "V3", side: "sell", generatedAt: "2026-01-01T00:00:00.000Z" }));
  const second = createFillProof(source({ protocol: "V3", side: "sell", generatedAt: "2027-01-01T00:00:00.000Z" }));
  assert.notEqual(first.generatedAt, second.generatedAt);
  assert.equal(first.integrity.digest, second.integrity.digest);
});

test("raw delta comparison never uses rounded display values", () => {
  assert.equal(rawDeltaBps("101", "100"), 100);
  assert.equal(rawDeltaBps("99", "100"), -100);
  assert.equal(rawDeltaBps("1", "0"), null);
});

test("rejects malformed local quote snapshots before bigint comparison", () => {
  const snapshot = {
    schema: FILL_PROOF_SNAPSHOT_SCHEMA,
    capturedAt: "2026-08-10T12:00:00.000Z",
    asset: "AAPL",
    side: "buy",
    expectedRawOutput: "abc",
    expectedDisplayOutput: "1.25",
    minimumRawOutput: "100",
    minimumDisplayOutput: "1",
    quoteExpiresAt: "2026-08-10T12:01:00.000Z",
    protocol: "V4",
    feeTier: 3_000,
    uiMultiplierRaw: "1000000000000000000",
    actionLockDigest: `sha256:${"a".repeat(64)}`,
  } as const;
  assert.equal(isFillProofLocalSnapshot(snapshot), false);
  assert.equal(isFillProofLocalSnapshot({ ...snapshot, expectedRawOutput: "125" }), true);
});
