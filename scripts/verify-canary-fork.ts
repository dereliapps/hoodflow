/* eslint-disable @typescript-eslint/no-explicit-any -- Hardhat runtime ABI contracts are intentionally dynamic. */
import { Contract, JsonRpcProvider, MaxUint256, getAddress } from "ethers";
import { network } from "hardhat";
import infrastructure from "../config/robinhood-mainnet.json" with { type: "json" };

const { ethers, networkHelpers } = await network.create({
  network: "robinhoodMainnetFork",
  chainType: "l1",
});
const { time } = networkHelpers;
const localNetwork = await ethers.provider.getNetwork();
if (localNetwork.chainId !== 31_337n) {
  throw new Error(`Refusing to run: expected local fork chain 31337, received ${localNetwork.chainId}`);
}

const [owner, guardian, keeper, user, feeRecipient] = await ethers.getSigners();
const usdGAddress = getAddress(infrastructure.tokens.USDG);
const stockAddress = getAddress(infrastructure.tokens.AAPL);
const poolManagerAddress = getAddress(infrastructure.contracts.poolManager);
const universalRouterAddress = getAddress(infrastructure.contracts.universalRouter);
const permit2Address = getAddress(infrastructure.contracts.permit2);
const quoterAddress = getAddress(infrastructure.contracts.quoter);
const erc20Abi = [
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function transfer(address to,uint256 amount) returns (bool)",
] as const;
const permit2Abi = [
  "function allowance(address user,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
] as const;
const quoterAbi = [
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
] as const;
const supportedPools = [
  { fee: 500, tickSpacing: 10 },
  { fee: 3_000, tickSpacing: 60 },
  { fee: 10_000, tickSpacing: 200 },
] as const;
const forkBlockNumber = Number(process.env.ROBINHOOD_FORK_BLOCK_NUMBER ?? "10453077");

const grossTranche = 1_000_000n;
const totalBudget = 2_000_000n;
const protocolFeeBps = 10n;
const swapAmount = grossTranche - (grossTranche * protocolFeeBps) / 10_000n;

const usdG: any = new Contract(usdGAddress, erc20Abi, ethers.provider);
const stock: any = new Contract(stockAddress, erc20Abi, ethers.provider);

const bestRoute = await selectBestRoute();
const usdValue18 = swapAmount * 1_000_000_000_000n;
const impliedStockPrice8 = (usdValue18 * 100_000_000n) / bestRoute.amountOut;
if (impliedStockPrice8 <= 0n) throw new Error("Unable to derive a positive canary oracle price");

await ethers.provider.send("hardhat_setBalance", [
  poolManagerAddress,
  "0x56BC75E2D63100000",
]);
await ethers.provider.send("hardhat_impersonateAccount", [poolManagerAddress]);
const poolManagerSigner = await ethers.getSigner(poolManagerAddress);
const fundedUsdG: any = usdG.connect(poolManagerSigner);
if (BigInt(await fundedUsdG.balanceOf(poolManagerAddress)) < totalBudget) {
  throw new Error("PoolManager USDG balance is below the canary requirement");
}
await (await fundedUsdG.transfer(user.address, totalBudget)).wait();
await ethers.provider.send("hardhat_stopImpersonatingAccount", [poolManagerAddress]);

const usdGFeed = await ethers.deployContract("MockPriceFeed", [8, 100_000_000n]);
const stockFeed = await ethers.deployContract("MockPriceFeed", [8, impliedStockPrice8]);
const sequencerFeed = await ethers.deployContract("MockPriceFeed", [0, 0]);
const hoodFlow: any = await ethers.deployContract("HoodFlowDCA", [
  owner.address,
  guardian.address,
  ethers.ZeroAddress,
  feeRecipient.address,
  protocolFeeBps,
]);
const adapter: any = await ethers.deployContract("UniswapV4DirectAdapter", [
  await hoodFlow.getAddress(),
  universalRouterAddress,
  permit2Address,
]);

const oldSequencerStart = (await time.latest()) - 2 * 60 * 60;
await sequencerFeed.setAnswer(0, oldSequencerStart);
await hoodFlow.setSwapAdapter(await adapter.getAddress());
await hoodFlow.setSequencerConfig(await sequencerFeed.getAddress(), 60 * 60);
await hoodFlow.setKeeper(keeper.address, true);
await hoodFlow.setTokenConfig(
  usdGAddress,
  await usdGFeed.getAddress(),
  2 * 60 * 60,
  true,
  false,
);
await hoodFlow.setTokenConfig(
  stockAddress,
  await stockFeed.getAddress(),
  2 * 60 * 60,
  true,
  false,
);
await hoodFlow.unpauseEverything();

await usdG.connect(user).approve(await hoodFlow.getAddress(), MaxUint256);
const now = await time.latest();
await hoodFlow.connect(user).createStrategy(
  usdGAddress,
  stockAddress,
  grossTranche,
  totalBudget,
  60 * 60,
  0,
  now + 24 * 60 * 60,
  500,
);

const routeData = ethers.AbiCoder.defaultAbiCoder().encode(
  ["uint24", "int24", "address"],
  [bestRoute.fee, bestRoute.tickSpacing, ethers.ZeroAddress],
);
const userStockBefore = BigInt(await stock.balanceOf(user.address));
await hoodFlow.connect(keeper).executeDCA.staticCall(1, routeData);
await (await hoodFlow.connect(keeper).executeDCA(1, routeData)).wait();

let replayBlocked = false;
try {
  await hoodFlow.connect(keeper).executeDCA.staticCall(1, routeData);
} catch {
  replayBlocked = true;
}
if (!replayBlocked) throw new Error("Immediate canary replay was not blocked");

await time.increase(60 * 60 + 1);
const refreshedAt = await time.latest();
await usdGFeed.setAnswer(100_000_000n, refreshedAt);
await stockFeed.setAnswer(impliedStockPrice8, refreshedAt);
await (await hoodFlow.connect(keeper).executeDCA(1, routeData)).wait();

const strategy = await hoodFlow.strategies(1);
const permit2 = new Contract(permit2Address, permit2Abi, ethers.provider);
const permitAllowance = await permit2.allowance(
  await adapter.getAddress(),
  usdGAddress,
  universalRouterAddress,
);
const userStockReceived = BigInt(await stock.balanceOf(user.address)) - userStockBefore;
const expectedFees = (grossTranche * protocolFeeBps) / 10_000n * 2n;

assertEqual(BigInt(strategy.remainingBudget), 0n, "remaining budget");
assertEqual(BigInt(strategy.status), 3n, "strategy status");
assertEqual(BigInt(await usdG.balanceOf(await hoodFlow.getAddress())), 0n, "engine USDG balance");
assertEqual(BigInt(await usdG.balanceOf(await adapter.getAddress())), 0n, "adapter USDG balance");
assertEqual(BigInt(await stock.balanceOf(await adapter.getAddress())), 0n, "adapter AAPL balance");
assertEqual(
  BigInt(await usdG.allowance(await hoodFlow.getAddress(), await adapter.getAddress())),
  0n,
  "engine adapter allowance",
);
assertEqual(
  BigInt(await usdG.allowance(await adapter.getAddress(), permit2Address)),
  0n,
  "adapter Permit2 token allowance",
);
assertEqual(BigInt(permitAllowance.amount), 0n, "Permit2 router allowance");
assertEqual(BigInt(await usdG.balanceOf(feeRecipient.address)), expectedFees, "protocol fees");
if (userStockReceived <= 0n) throw new Error("Canary user received no AAPL output");

console.log(JSON.stringify({
  verified: true,
  environment: "local Robinhood mainnet fork",
  broadcast: false,
  canary: {
    pair: "AAPL/USDG",
    executions: 2,
    trancheUsdG: grossTranche.toString(),
    totalBudgetUsdG: totalBudget.toString(),
    fee: bestRoute.fee,
    tickSpacing: bestRoute.tickSpacing,
    quotedAmountOut: bestRoute.amountOut.toString(),
    receivedAmountOut: userStockReceived.toString(),
    replayBlocked,
    completed: BigInt(strategy.status) === 3n,
    engineCustodyAfter: "0",
    adapterCustodyAfter: "0",
    residualAllowances: "0",
  },
}, null, 2));

async function selectBestRoute() {
  const mainnetProvider = new JsonRpcProvider(
    process.env.ROBINHOOD_MAINNET_RPC_URL?.trim() || infrastructure.rpcUrl,
    infrastructure.chainId,
    { staticNetwork: true },
  );
  const quoter = new Contract(quoterAddress, quoterAbi, mainnetProvider);
  const [currency0, currency1] = BigInt(usdGAddress) < BigInt(stockAddress)
    ? [usdGAddress, stockAddress]
    : [stockAddress, usdGAddress];
  const zeroForOne = currency0 === usdGAddress;
  const quotes = await Promise.all(supportedPools.map(async ({ fee, tickSpacing }) => {
    try {
      const result = await quoter.quoteExactInputSingle.staticCall([
        [currency0, currency1, fee, tickSpacing, ethers.ZeroAddress],
        zeroForOne,
        swapAmount,
        "0x",
      ], { blockTag: forkBlockNumber });
      const amountOut = BigInt(result.amountOut);
      return amountOut > 0n ? { fee, tickSpacing, amountOut } : null;
    } catch {
      return null;
    }
  }));
  const available = quotes.filter((quote): quote is NonNullable<typeof quote> => quote !== null);
  if (available.length === 0) throw new Error("No quoted AAPL/USDG canary route");
  return available.reduce((best, quote) => quote.amountOut > best.amountOut ? quote : best);
}

function assertEqual(actual: bigint, expected: bigint, label: string) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, received ${actual}`);
  }
}
