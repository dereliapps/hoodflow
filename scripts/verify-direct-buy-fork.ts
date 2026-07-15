import { Contract, formatUnits, getAddress, parseUnits } from "ethers";
import { network } from "hardhat";

import infrastructure from "../config/robinhood-mainnet.json" with { type: "json" };
import {
  ERC20_ABI,
  PERMIT2_ABI,
  PERMIT2_ADDRESS,
  PERMIT2_TYPES,
  ROBINHOOD_TOKENS,
  UNIVERSAL_ROUTER_ABI,
  UNIVERSAL_ROUTER_ADDRESS,
  USDG_ADDRESS,
  V3_QUOTER_ABI,
  V3_QUOTER_ADDRESS,
  V3_ROUTE_FEES,
  V4_POOL_CANDIDATES,
  V4_QUOTER_ABI,
  V4_QUOTER_ADDRESS,
  buildDirectBuyCalldata,
  buildV3DirectBuyCalldata,
  buildQuoteParams,
  type PermitSingle,
} from "../lib/hoodflow-mainnet.js";

const { ethers } = await network.create({
  network: "robinhoodMainnetFork",
  chainType: "l1",
});
const networkInfo = await ethers.provider.getNetwork();
if (networkInfo.chainId !== 31_337n) {
  throw new Error(`Refusing to run: expected local fork chain 31337, received ${networkInfo.chainId}`);
}

const [buyer] = await ethers.getSigners();
const poolManagerAddress = getAddress(infrastructure.contracts.poolManager);
const intelAddress = ROBINHOOD_TOKENS.INTC;
const amountIn = parseUnits("1", 6);
const fundingAmount = amountIn * 3n;

await ethers.provider.send("hardhat_setBalance", [poolManagerAddress, "0x56BC75E2D63100000"]);
await ethers.provider.send("hardhat_impersonateAccount", [poolManagerAddress]);
const poolManagerSigner = await ethers.getSigner(poolManagerAddress);
const fundedUsdG = new Contract(USDG_ADDRESS, ERC20_ABI, poolManagerSigner);
if (BigInt(await fundedUsdG.balanceOf(poolManagerAddress)) < fundingAmount) {
  throw new Error("PoolManager no longer has enough USDG for the direct-buy fork check");
}
await (await fundedUsdG.transfer(buyer.address, fundingAmount)).wait();
await ethers.provider.send("hardhat_stopImpersonatingAccount", [poolManagerAddress]);

const usdG = new Contract(USDG_ADDRESS, ERC20_ABI, buyer);
const intel = new Contract(intelAddress, ERC20_ABI, ethers.provider);
const quoter = new Contract(V4_QUOTER_ADDRESS, V4_QUOTER_ABI, ethers.provider);
const permit2 = new Contract(PERMIT2_ADDRESS, PERMIT2_ABI, ethers.provider);
const router = new Contract(UNIVERSAL_ROUTER_ADDRESS, UNIVERSAL_ROUTER_ABI, buyer);

const quotes = [];
for (const route of V4_POOL_CANDIDATES) {
  try {
    const result = await quoter.quoteExactInputSingle.staticCall(
      buildQuoteParams(intelAddress, amountIn, route),
    ) as readonly [bigint, bigint];
    const amountOut = BigInt(result[0]);
    if (amountOut > 0n) quotes.push({ route, amountOut });
  } catch {
    // An absent pool is expected; at least one reviewed pool must quote.
  }
}
if (quotes.length === 0) throw new Error("INTC/USDG returned no live V4 quote");
const best = quotes.reduce((current, quote) => quote.amountOut > current.amountOut ? quote : current);
const minAmountOut = best.amountOut * 9_950n / 10_000n;

await (await usdG.approve(PERMIT2_ADDRESS, amountIn)).wait();
const currentPermit = await permit2.allowance(
  buyer.address,
  USDG_ADDRESS,
  UNIVERSAL_ROUTER_ADDRESS,
) as { nonce?: bigint; 2?: bigint };
const nonce = BigInt(currentPermit.nonce ?? currentPermit[2] ?? 0n);
const latest = await ethers.provider.getBlock("latest");
if (!latest) throw new Error("Fork has no latest block");
const permit: PermitSingle = {
  details: {
    token: USDG_ADDRESS,
    amount: amountIn,
    expiration: latest.timestamp + 600,
    nonce,
  },
  spender: UNIVERSAL_ROUTER_ADDRESS,
  sigDeadline: latest.timestamp + 600,
};
const signature = await buyer.signTypedData(
  { name: "Permit2", chainId: networkInfo.chainId, verifyingContract: PERMIT2_ADDRESS },
  PERMIT2_TYPES,
  permit,
);
const calldata = buildDirectBuyCalldata({
  tokenOut: intelAddress,
  amountIn,
  minAmountOut,
  route: best.route,
  permit,
  signature,
});

const before = BigInt(await intel.balanceOf(buyer.address));
const transaction = await router.execute(
  calldata.commands,
  calldata.inputs,
  latest.timestamp + 300,
);
const receipt = await transaction.wait();
const received = BigInt(await intel.balanceOf(buyer.address)) - before;
if (!receipt || receipt.status !== 1 || received < minAmountOut) {
  throw new Error("Direct INTC buy did not satisfy the protected minimum output");
}
const erc20Allowance = BigInt(await usdG.allowance(buyer.address, PERMIT2_ADDRESS));
const permitAfter = await permit2.allowance(
  buyer.address,
  USDG_ADDRESS,
  UNIVERSAL_ROUTER_ADDRESS,
) as { amount?: bigint; 0?: bigint };
const permitAmountAfter = BigInt(permitAfter.amount ?? permitAfter[0] ?? 0n);
if (erc20Allowance !== 0n || permitAmountAfter !== 0n) {
  throw new Error("Exact direct-buy permissions were not fully consumed");
}

async function executeV3Buy(ticker: "SGOV" | "SLV") {
  const tokenAddress = ROBINHOOD_TOKENS[ticker];
  const fee = V3_ROUTE_FEES[ticker];
  const outputToken = new Contract(tokenAddress, ERC20_ABI, ethers.provider);
  const v3Quoter = new Contract(V3_QUOTER_ADDRESS, V3_QUOTER_ABI, ethers.provider);
  const quote = await v3Quoter.quoteExactInputSingle.staticCall({
    tokenIn: USDG_ADDRESS,
    tokenOut: tokenAddress,
    amountIn,
    fee,
    sqrtPriceLimitX96: 0,
  }) as readonly [bigint, bigint, bigint, bigint];
  const quotedOut = BigInt(quote[0]);
  if (quotedOut <= 0n) throw new Error(`${ticker}/USDG returned no V3 quote`);
  const protectedOut = quotedOut * 9_950n / 10_000n;

  await (await usdG.approve(PERMIT2_ADDRESS, amountIn)).wait();
  const currentV3Permit = await permit2.allowance(
    buyer.address,
    USDG_ADDRESS,
    UNIVERSAL_ROUTER_ADDRESS,
  ) as { nonce?: bigint; 2?: bigint };
  const currentBlock = await ethers.provider.getBlock("latest");
  if (!currentBlock) throw new Error("Fork has no latest block");
  const v3Permit: PermitSingle = {
    details: {
      token: USDG_ADDRESS,
      amount: amountIn,
      expiration: currentBlock.timestamp + 600,
      nonce: BigInt(currentV3Permit.nonce ?? currentV3Permit[2] ?? 0n),
    },
    spender: UNIVERSAL_ROUTER_ADDRESS,
    sigDeadline: currentBlock.timestamp + 600,
  };
  const v3Signature = await buyer.signTypedData(
    { name: "Permit2", chainId: networkInfo.chainId, verifyingContract: PERMIT2_ADDRESS },
    PERMIT2_TYPES,
    v3Permit,
  );
  const v3Calldata = buildV3DirectBuyCalldata({
    tokenOut: tokenAddress,
    recipient: buyer.address,
    amountIn,
    minAmountOut: protectedOut,
    fee,
    permit: v3Permit,
    signature: v3Signature,
  });
  const outputBefore = BigInt(await outputToken.balanceOf(buyer.address));
  const v3Transaction = await router.execute(
    v3Calldata.commands,
    v3Calldata.inputs,
    currentBlock.timestamp + 300,
  );
  const v3Receipt = await v3Transaction.wait();
  const outputReceived = BigInt(await outputToken.balanceOf(buyer.address)) - outputBefore;
  const inputAllowanceAfter = BigInt(await usdG.allowance(buyer.address, PERMIT2_ADDRESS));
  const routerAllowance = await permit2.allowance(
    buyer.address,
    USDG_ADDRESS,
    UNIVERSAL_ROUTER_ADDRESS,
  ) as { amount?: bigint; 0?: bigint };
  const routerAllowanceAfter = BigInt(routerAllowance.amount ?? routerAllowance[0] ?? 0n);
  if (!v3Receipt || v3Receipt.status !== 1 || outputReceived < protectedOut) {
    throw new Error(`${ticker} V3 buy did not satisfy the protected minimum output`);
  }
  if (inputAllowanceAfter !== 0n || routerAllowanceAfter !== 0n) {
    throw new Error(`${ticker} exact permissions were not fully consumed`);
  }
  return {
    pair: `${ticker}/USDG`,
    fee,
    amountIn: formatUnits(amountIn, 6),
    minimumOut: formatUnits(protectedOut, 18),
    received: formatUnits(outputReceived, 18),
    gasUsed: v3Receipt.gasUsed.toString(),
  };
}

const v3Results = [await executeV3Buy("SGOV"), await executeV3Buy("SLV")];

console.log(JSON.stringify({
  verified: true,
  environment: "local Robinhood mainnet fork",
  upstreamChainId: infrastructure.chainId,
  localChainId: Number(networkInfo.chainId),
  broadcast: false,
  pair: "INTC/USDG",
  amountIn: formatUnits(amountIn, 6),
  minimumOut: formatUnits(minAmountOut, 18),
  received: formatUnits(received, 18),
  route: best.route,
  erc20Permit2AllowanceAfter: erc20Allowance.toString(),
  routerPermitAllowanceAfter: permitAmountAfter.toString(),
  gasUsed: receipt.gasUsed.toString(),
  v3Routes: v3Results,
}, null, 2));
