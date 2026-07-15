import { Contract, MaxUint256, getAddress } from "ethers";
import { network } from "hardhat";
import infrastructure from "../config/robinhood-mainnet.json" with { type: "json" };

const { ethers } = await network.create({
  network: "robinhoodMainnetFork",
  chainType: "l1",
});
const localNetwork = await ethers.provider.getNetwork();
if (localNetwork.chainId !== 31_337n) {
  throw new Error(`Refusing to run: expected local fork chain 31337, received ${localNetwork.chainId}`);
}

const [recipient] = await ethers.getSigners();
const poolManagerAddress = getAddress(infrastructure.contracts.poolManager);
const usdGAddress = getAddress(infrastructure.tokens.USDG);
const universalRouterAddress = getAddress(infrastructure.contracts.universalRouter);
const permit2Address = getAddress(infrastructure.contracts.permit2);
const erc20Abi = [
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
] as const;

await ethers.provider.send("hardhat_setBalance", [
  poolManagerAddress,
  "0x56BC75E2D63100000",
]);
await ethers.provider.send("hardhat_impersonateAccount", [poolManagerAddress]);
const poolManagerSigner = await ethers.getSigner(poolManagerAddress);
const usdG = new Contract(usdGAddress, erc20Abi, poolManagerSigner);

const engine = await ethers.deployContract("MockAdapterEngine");
await engine.waitForDeployment();
const adapter = await ethers.deployContract("UniswapV4DirectAdapter", [
  await engine.getAddress(),
  universalRouterAddress,
  permit2Address,
]);
await adapter.waitForDeployment();

const routeAmount = 1_000_000n;
const routes = [
  { symbol: "AAPL", fee: 500, tickSpacing: 10 },
  { symbol: "AMD", fee: 10_000, tickSpacing: 200 },
  { symbol: "AMZN", fee: 3_000, tickSpacing: 60 },
  { symbol: "GOOGL", fee: 3_000, tickSpacing: 60 },
  { symbol: "INTC", fee: 10_000, tickSpacing: 200 },
  { symbol: "META", fee: 3_000, tickSpacing: 60 },
  { symbol: "MU", fee: 10_000, tickSpacing: 200 },
  { symbol: "NVDA", fee: 3_000, tickSpacing: 60 },
  { symbol: "SNDK", fee: 10_000, tickSpacing: 200 },
  { symbol: "SPCX", fee: 10_000, tickSpacing: 200 },
  { symbol: "TSLA", fee: 3_000, tickSpacing: 60 },
  { symbol: "QQQ", fee: 10_000, tickSpacing: 200 },
  { symbol: "SPY", fee: 3_000, tickSpacing: 60 },
] as const;
const requiredUsdG = routeAmount * BigInt(routes.length);
const poolManagerBalance = BigInt(await usdG.balanceOf(poolManagerAddress));
if (poolManagerBalance < requiredUsdG) {
  throw new Error(`PoolManager USDG balance is below the ${requiredUsdG} fork test requirement`);
}

await (await usdG.transfer(await engine.getAddress(), requiredUsdG)).wait();
await ethers.provider.send("hardhat_stopImpersonatingAccount", [poolManagerAddress]);
await (
  await engine.approveToken(usdGAddress, await adapter.getAddress(), MaxUint256)
).wait();

const results = [];
for (const route of routes) {
  const outputAddress = getAddress(infrastructure.tokens[route.symbol]);
  const outputToken = new Contract(outputAddress, erc20Abi, ethers.provider);
  const before = BigInt(await outputToken.balanceOf(recipient.address));
  const block = await ethers.provider.getBlock("latest");
  if (!block) throw new Error("Local fork has no latest block");
  const routeData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint24", "int24", "address"],
    [route.fee, route.tickSpacing, ethers.ZeroAddress],
  );

  const transaction = await engine.executeSwap(
    await adapter.getAddress(),
    usdGAddress,
    outputAddress,
    routeAmount,
    1,
    recipient.address,
    block.timestamp + 300,
    routeData,
  );
  const receipt = await transaction.wait();
  const amountOut = BigInt(await outputToken.balanceOf(recipient.address)) - before;
  if (amountOut <= 0n) throw new Error(`${route.symbol}/USDG fork swap returned no output`);
  results.push({
    pair: `${route.symbol}/USDG`,
    fee: route.fee,
    tickSpacing: route.tickSpacing,
    amountIn: routeAmount.toString(),
    amountOut: amountOut.toString(),
    gasUsed: receipt?.gasUsed.toString(),
  });
  console.log(`fork route passed: ${route.symbol}`);
}

console.log(JSON.stringify({
  verified: true,
  environment: "local Robinhood mainnet fork",
  upstreamChainId: infrastructure.chainId,
  localChainId: Number(localNetwork.chainId),
  broadcast: false,
  universalRouter: universalRouterAddress,
  permit2: permit2Address,
  routes: results,
}, null, 2));
