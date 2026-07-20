import assert from "node:assert/strict";
import test from "node:test";
import { AbiCoder } from "ethers";

import { buildV2ExactInputCalldata, buildV3ExactInputCalldata, friendlyExecutionError } from "../lib/hoodflow-mainnet.js";

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const VIRTUAL = "0xc6911796042b15d7fa4f6cde69e245ddcd3d9c31";
const TOKEN = "0xb47f4702deb124cb4eb6286be83c9d84277c6239";
const RECIPIENT = "0x1111111111111111111111111111111111111111";

test("encodes an atomic V2 route through the selected market settlement token", () => {
  const permit = {
    details: { token: USDG, amount: 10_000_000n, expiration: 2_000_000_000, nonce: 0n },
    spender: "0x8876789976decbfcbbbe364623c63652db8c0904",
    sigDeadline: 2_000_000_000,
  };
  const calldata = buildV2ExactInputCalldata({
    tokenIn: USDG,
    tokenOut: TOKEN,
    recipient: RECIPIENT,
    amountIn: 10_000_000n,
    minAmountOut: 1n,
    path: [USDG, VIRTUAL, TOKEN],
    permit,
    signature: "0x1234",
  });

  assert.equal(calldata.commands, "0x0a08");
  const decoded = AbiCoder.defaultAbiCoder().decode(
    ["address", "uint256", "uint256", "address[]", "bool"],
    calldata.inputs[1],
  );
  assert.deepEqual(decoded[3].map((address: string) => address.toLowerCase()), [USDG, VIRTUAL, TOKEN].map((address) => address.toLowerCase()));
  assert.equal(decoded[4], true);
});

test("encodes the deployed router's five-field V3 exact-input payload", () => {
  const calldata = buildV3ExactInputCalldata({
    tokenIn: USDG,
    tokenOut: TOKEN,
    recipient: RECIPIENT,
    amountIn: 10_000_000n,
    minAmountOut: 1n,
    fee: 3_000,
    permit: {
      details: { token: USDG, amount: 10_000_000n, expiration: 2_000_000_000, nonce: 0n },
      spender: "0x8876789976decbfcbbbe364623c63652db8c0904",
      sigDeadline: 2_000_000_000,
    },
    signature: "0x1234",
  });

  const decoded = AbiCoder.defaultAbiCoder().decode(
    ["address", "uint256", "uint256", "bytes", "bool"],
    calldata.inputs[1],
  );
  assert.equal(decoded[0].toLowerCase(), RECIPIENT.toLowerCase());
  assert.equal(decoded[1], 10_000_000n);
  assert.equal(decoded[2], 1n);
  assert.equal(decoded[4], true);
});

test("maps the deployed router's SliceOutOfBounds selector to a safe user message", () => {
  const error = {
    code: "CALL_EXCEPTION",
    action: "estimateGas",
    data: "0x3b99b53d",
    message: "execution reverted (unknown custom error)",
  };
  assert.equal(
    friendlyExecutionError(error),
    "The router rejected outdated route data. Refresh the page and request a new quote.",
  );
});

test("never exposes raw estimateGas payloads to users", () => {
  const error = new Error("execution reverted while estimating gas: 0xdeadbeef");
  assert.equal(
    friendlyExecutionError(error),
    "Trade simulation failed before any transaction was sent. Refresh the quote; if it repeats, use the live pool link.",
  );
});

test("rejects a V2 path that does not match the selected output token", () => {
  assert.throws(() => buildV2ExactInputCalldata({
    tokenIn: USDG,
    tokenOut: TOKEN,
    recipient: RECIPIENT,
    amountIn: 1n,
    minAmountOut: 1n,
    path: [USDG, VIRTUAL],
    permit: {
      details: { token: USDG, amount: 1n, expiration: 2_000_000_000, nonce: 0n },
      spender: "0x8876789976decbfcbbbe364623c63652db8c0904",
      sigDeadline: 2_000_000_000,
    },
    signature: "0x1234",
  }), /does not match/);
});
