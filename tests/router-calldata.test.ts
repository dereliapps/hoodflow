import assert from "node:assert/strict";
import test from "node:test";
import { AbiCoder } from "ethers";

import { buildV2ExactInputCalldata } from "../lib/hoodflow-mainnet.js";

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
