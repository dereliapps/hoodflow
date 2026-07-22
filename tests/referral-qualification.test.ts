import assert from "node:assert/strict";
import test from "node:test";
import { AbiCoder, Interface, id, solidityPacked, zeroPadValue } from "ethers";
import {
  PERMIT2_ADDRESS,
  ROBINHOOD_TOKENS,
  UNIVERSAL_ROUTER_ABI,
  UNIVERSAL_ROUTER_ADDRESS,
  USDG_ADDRESS,
  V3_ROUTE_FEES,
} from "../lib/hoodflow-mainnet.js";
import { verifyEligibleReferralTrade } from "../lib/referral-qualification.js";

const coder = AbiCoder.defaultAbiCoder();
const router = new Interface(UNIVERSAL_ROUTER_ABI);
const wallet = "0x1111111111111111111111111111111111111111";
const stock = ROBINHOOD_TOKENS.SLV;

function v3Trade(tokenOut = stock, amountIn = 1_000_000n) {
  const permit = coder.encode([
    "tuple(tuple(address token,uint160 amount,uint48 expiration,uint48 nonce) details,address spender,uint256 sigDeadline)",
    "bytes",
  ], [{ details: { token: USDG_ADDRESS, amount: amountIn, expiration: 2_000_000_000, nonce: 0 }, spender: UNIVERSAL_ROUTER_ADDRESS, sigDeadline: 2_000_000_000 }, "0x1234"]);
  const path = solidityPacked(["address", "uint24", "address"], [USDG_ADDRESS, V3_ROUTE_FEES.SLV, tokenOut]);
  const swap = coder.encode(["address", "uint256", "uint256", "bytes", "bool"], [wallet, amountIn, 10n, path, true]);
  const transactionData = router.encodeFunctionData("execute", ["0x0a00", [permit, swap], 2_000_000_000]);
  const logs = [{
    address: tokenOut,
    topics: [id("Transfer(address,address,uint256)"), zeroPadValue("0x2222222222222222222222222222222222222222", 32), zeroPadValue(wallet, 32)],
    data: zeroPadValue("0x0a", 32),
  }];
  return { transactionData, logs };
}

test("accepts a value-bounded reviewed Stock Token settlement", () => {
  const result = verifyEligibleReferralTrade({ ...v3Trade(), wallet });
  assert.equal(result.protocol, "V3");
  assert.equal(result.ticker, "SLV");
});

test("rejects arbitrary tokens even when the public router and transfer shape match", () => {
  const arbitrary = "0x3333333333333333333333333333333333333333";
  assert.throws(() => verifyEligibleReferralTrade({ ...v3Trade(arbitrary), wallet }), /reviewed HoodFlow V3 route/);
});

test("rejects dust and output transfers from the wrong token contract", () => {
  assert.throws(() => verifyEligibleReferralTrade({ ...v3Trade(stock, 999_999n), wallet }), /at least 1 USDG/);
  const trade = v3Trade();
  assert.throws(() => verifyEligibleReferralTrade({ transactionData: trade.transactionData, wallet, logs: [{ ...trade.logs[0], address: PERMIT2_ADDRESS }] }), /not settled/);
});
