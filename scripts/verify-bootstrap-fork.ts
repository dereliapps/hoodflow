/* eslint-disable @typescript-eslint/no-explicit-any -- Hardhat runtime contracts are dynamic. */
import { getAddress } from "ethers";
import { network } from "hardhat";

import infrastructure from "../config/robinhood-mainnet.json" with { type: "json" };

const { ethers } = await network.create({ network: "robinhoodMainnetFork", chainType: "l1" });
const [owner, guardian, feeRecipient, keeper] = await ethers.getSigners();

const bootstrap: any = await ethers.deployContract("HoodFlowMainnetBootstrap", [
  owner.address,
  guardian.address,
  feeRecipient.address,
  keeper.address,
]);
await bootstrap.waitForDeployment();

const engineAddress = await bootstrap.engine();
const adapterAddress = await bootstrap.adapter();
const fixedFeedAddress = await bootstrap.fixedUsdFeed();
const engine: any = await ethers.getContractAt("HoodFlowDCA", engineAddress);
const adapter: any = await ethers.getContractAt("UniswapV4DirectAdapter", adapterAddress);

const checks = {
  paused: await engine.paused(),
  ownerIsBootstrap: getAddress(await engine.owner()) === getAddress(await bootstrap.getAddress()),
  pendingOwner: getAddress(await engine.pendingOwner()) === getAddress(owner.address),
  guardian: getAddress(await engine.guardian()) === getAddress(guardian.address),
  feeRecipient: getAddress(await engine.feeRecipient()) === getAddress(feeRecipient.address),
  keeper: await engine.keepers(keeper.address),
  keeperCount: Number(await engine.keeperCount()) === 1,
  tokenCount: Number(await engine.allowedTokenCount()) === 14,
  settlement: getAddress(await engine.settlementToken()) === getAddress(infrastructure.tokens.USDG),
  adapter: getAddress(await engine.swapAdapter()) === getAddress(adapterAddress),
  adapterEngine: getAddress(await adapter.engine()) === getAddress(engineAddress),
  router: getAddress(await adapter.universalRouter()) === getAddress(infrastructure.contracts.universalRouter),
  permit2: getAddress(await adapter.permit2()) === getAddress(infrastructure.contracts.permit2),
  fixedUsd: BigInt((await (await ethers.getContractAt("FixedUsdFeed", fixedFeedAddress)).latestRoundData()).answer) === 100_000_000n,
};

if (Object.values(checks).some((value) => value !== true)) {
  throw new Error(`Bootstrap invariant failed: ${JSON.stringify(checks)}`);
}

await (await engine.connect(owner).acceptOwnership()).wait();
if (getAddress(await engine.owner()) !== getAddress(owner.address)) {
  throw new Error("Final owner did not accept ownership");
}
if (!(await engine.paused())) throw new Error("Bootstrap unexpectedly unpaused the engine");

console.log(JSON.stringify({
  verified: true,
  environment: "local Robinhood mainnet fork",
  broadcast: false,
  bootstrap: await bootstrap.getAddress(),
  engine: engineAddress,
  adapter: adapterAddress,
  fixedUsdFeed: fixedFeedAddress,
  configuredAssets: 13,
  ownershipAccepted: true,
  paused: true,
}, null, 2));
