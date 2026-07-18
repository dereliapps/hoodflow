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
  V4_POOL_CANDIDATES,
  V4_QUOTER_ABI,
  V4_QUOTER_ADDRESS,
  buildDirectBuyCalldata,
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

await ethers.provider.send("hardhat_setBalance", [poolManagerAddress, "0x56BC75E2D63100000"]);
await ethers.provider.send("hardhat_impersonateAccount", [poolManagerAddress]);
const poolManagerSigner = await ethers.getSigner(poolManagerAddress);
const fundedUsdG = new Contract(USDG_ADDRESS, ERC20_ABI, poolManagerSigner);
if (BigInt(await fundedUsdG.balanceOf(poolManagerAddress)) < amountIn) {
  throw new Error("PoolManager no longer has enough USDG for the direct-buy fork check");
}
await (await fundedUsdG.transfer(buyer.address, amountIn)).wait();
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
}, null, 2));
