/* eslint-disable @typescript-eslint/no-explicit-any -- Hardhat's generated contract types are dynamic here. */
import { getAddress, isAddress } from "ethers";
import { network } from "hardhat";

import infrastructure from "../config/robinhood-mainnet.json" with { type: "json" };
import { ROBINHOOD_PRICE_FEEDS } from "../config/robinhood-price-feeds.js";

try {
  process.loadEnvFile?.();
} catch {
  // A local secret manager or CI can inject the same values.
}

const REQUIRED_CHAIN_ID = 4_663n;
const REQUIRED_ACK = "DEPLOY_PAUSED_HOODFLOW_4663";
const confirmations = integerEnv("HOODFLOW_DEPLOY_CONFIRMATIONS", 1, 20, 2);
const finalOwner = addressEnv("HOODFLOW_INITIAL_OWNER");
const guardian = addressEnv("HOODFLOW_GUARDIAN");
const feeRecipient = addressEnv("HOODFLOW_FEE_RECIPIENT");
const feeBps = integerEnv("HOODFLOW_INITIAL_FEE_BPS", 0, 100);
const maxTrancheAmount = bigintEnv("HOODFLOW_MAX_TRANCHE_AMOUNT");
const maxStrategyBudget = bigintEnv("HOODFLOW_MAX_STRATEGY_BUDGET");
const keepers = csvAddresses("HOODFLOW_KEEPERS");
const universalRouter = getAddress(infrastructure.contracts.universalRouter);
const permit2 = getAddress(infrastructure.contracts.permit2);
const settlementToken = getAddress(infrastructure.tokens.USDG);

if (process.env.HOODFLOW_MAINNET_DEPLOY_ACK?.trim() !== REQUIRED_ACK) {
  throw new Error(`Refusing mainnet deployment. Set HOODFLOW_MAINNET_DEPLOY_ACK=${REQUIRED_ACK}`);
}
if (process.env.HOODFLOW_UNPAUSE_AFTER_DEPLOY === "true") {
  throw new Error("This script can only deploy a paused engine");
}
if ((process.env.HOODFLOW_SEQUENCER_MODE?.trim() || "none") !== "none") {
  throw new Error("The reviewed Robinhood deployment uses HOODFLOW_SEQUENCER_MODE=none");
}
if (maxStrategyBudget < maxTrancheAmount) {
  throw new Error("HOODFLOW_MAX_STRATEGY_BUDGET must be at least the tranche cap");
}

const roleSet = new Set([finalOwner, guardian, feeRecipient].map(lower));
if (roleSet.size !== 3) throw new Error("Owner, guardian and fee recipient must be distinct");
if (keepers.length === 0) throw new Error("HOODFLOW_KEEPERS must contain at least one address");
if (new Set(keepers.map(lower)).size !== keepers.length) {
  throw new Error("HOODFLOW_KEEPERS contains a duplicate address");
}
if (keepers.some((keeper) => roleSet.has(lower(keeper)))) {
  throw new Error("Keeper addresses must not overlap owner, guardian or fee recipient");
}

const v3Only = new Set(Object.keys(infrastructure.v3VerifiedAssets));
const dcaTickers = infrastructure.forkVerifiedAssets.filter((ticker) => !v3Only.has(ticker));
const tokenConfigs = dcaTickers.map((ticker) => {
  const token = infrastructure.tokens[ticker as keyof typeof infrastructure.tokens];
  const oracle = ROBINHOOD_PRICE_FEEDS[ticker as keyof typeof ROBINHOOD_PRICE_FEEDS];
  if (!token || !oracle?.feed) throw new Error(`Missing reviewed token/feed configuration for ${ticker}`);
  return {
    ticker,
    token: getAddress(token),
    feed: getAddress(oracle.feed),
    heartbeat: oracle.heartbeat,
  };
});

const { ethers } = await network.create({ network: "robinhoodMainnet", chainType: "l1" });
const [deployer] = await ethers.getSigners();
const activeNetwork = await ethers.provider.getNetwork();
if (activeNetwork.chainId !== REQUIRED_CHAIN_ID) {
  throw new Error(`Refusing deployment on chain ${activeNetwork.chainId}; expected ${REQUIRED_CHAIN_ID}`);
}

const deployerBalance = await ethers.provider.getBalance(deployer.address);
if (deployerBalance === 0n) throw new Error("The deployment wallet has no ETH for Robinhood gas");

const reviewedContracts = [
  ["Universal Router", universalRouter],
  ["Permit2", permit2],
  ["USDG", settlementToken],
  ...tokenConfigs.flatMap(({ ticker, token, feed }) => [
    [`${ticker} token`, token],
    [`${ticker} feed`, feed],
  ] as const),
] as Array<readonly [string, string]>;
const codes = await Promise.all(reviewedContracts.map(([, address]) => ethers.provider.getCode(address)));
for (let index = 0; index < reviewedContracts.length; index++) {
  if (codes[index] === "0x") throw new Error(`${reviewedContracts[index][0]} has no bytecode`);
}

console.log(JSON.stringify({
  event: "deployment_preflight_passed",
  chainId: activeNetwork.chainId.toString(),
  deployer: deployer.address,
  finalOwner,
  guardian,
  keepers,
  dcaAssets: dcaTickers,
  remainsPaused: true,
}));

const fixedUsdFeed: any = await ethers.deployContract("FixedUsdFeed");
await waitForDeployment(fixedUsdFeed, "FixedUsdFeed");

const hoodFlow: any = await ethers.deployContract("HoodFlowDCA", [
  deployer.address,
  guardian,
  ethers.ZeroAddress,
  feeRecipient,
  feeBps,
  settlementToken,
  maxTrancheAmount,
  maxStrategyBudget,
]);
await waitForDeployment(hoodFlow, "HoodFlowDCA");
const engineAddress = await hoodFlow.getAddress();

const adapter: any = await ethers.deployContract("UniswapV4DirectAdapter", [
  engineAddress,
  universalRouter,
  permit2,
]);
await waitForDeployment(adapter, "UniswapV4DirectAdapter");
const adapterAddress = await adapter.getAddress();

await send("bind_adapter", hoodFlow.setSwapAdapter(adapterAddress));
await send("disable_unpublished_sequencer_feed", hoodFlow.setSequencerConfig(ethers.ZeroAddress, 0));
for (const keeper of keepers) {
  await send(`enable_keeper_${keeper}`, hoodFlow.setKeeper(keeper, true));
}
await send(
  "enable_USDG",
  hoodFlow.setTokenConfig(settlementToken, await fixedUsdFeed.getAddress(), 604_800, true, false),
);
for (const config of tokenConfigs) {
  await send(
    `enable_${config.ticker}`,
    hoodFlow.setTokenConfig(config.token, config.feed, config.heartbeat, true, true),
  );
}

if (!(await hoodFlow.paused())) throw new Error("Invariant failed: deployed engine is not paused");
if (Number(await hoodFlow.keeperCount()) !== keepers.length) {
  throw new Error("Invariant failed: keeper count mismatch");
}
if (Number(await hoodFlow.allowedTokenCount()) !== tokenConfigs.length + 1) {
  throw new Error("Invariant failed: token configuration count mismatch");
}
if (lower(await hoodFlow.settlementToken()) !== lower(settlementToken)) {
  throw new Error("Invariant failed: settlement token mismatch");
}

if (lower(deployer.address) !== lower(finalOwner)) {
  await send("transfer_ownership", hoodFlow.transferOwnership(finalOwner));
}

const manifest = {
  chainId: Number(REQUIRED_CHAIN_ID),
  network: "Robinhood Chain mainnet",
  deployedAt: new Date().toISOString(),
  deployer: deployer.address,
  contracts: {
    engine: engineAddress,
    adapter: adapterAddress,
    fixedUsdFeed: await fixedUsdFeed.getAddress(),
    universalRouter,
    permit2,
  },
  configuration: {
    finalOwner,
    ownershipAcceptanceRequired: lower(deployer.address) !== lower(finalOwner),
    guardian,
    feeRecipient,
    feeBps,
    settlementToken,
    maxTrancheAmount: maxTrancheAmount.toString(),
    maxStrategyBudget: maxStrategyBudget.toString(),
    keepers,
    sequencerMode: "none",
    dcaAssets: dcaTickers,
    paused: true,
  },
};
console.log(JSON.stringify({ event: "paused_mainnet_deployment_complete", manifest }, null, 2));

async function waitForDeployment(contract: any, label: string) {
  await contract.waitForDeployment();
  const transaction = contract.deploymentTransaction();
  if (!transaction) throw new Error(`${label} deployment transaction is unavailable`);
  await transaction.wait(confirmations);
  console.log(JSON.stringify({
    event: "contract_deployed",
    label,
    address: await contract.getAddress(),
    transactionHash: transaction.hash,
  }));
}

async function send(label: string, transactionPromise: Promise<any>) {
  const transaction = await transactionPromise;
  const receipt = await transaction.wait(confirmations);
  if (!receipt || receipt.status !== 1) throw new Error(`${label} transaction failed`);
  console.log(JSON.stringify({ event: "configuration_confirmed", label, transactionHash: transaction.hash }));
}

function addressEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value || !isAddress(value) || value === "0x0000000000000000000000000000000000000000") {
    throw new Error(`${name} must be a non-zero address`);
  }
  return getAddress(value);
}

function csvAddresses(name: string) {
  const raw = process.env[name]?.trim();
  if (!raw) return [];
  return raw.split(",").map((value) => {
    const trimmed = value.trim();
    if (!isAddress(trimmed) || trimmed === "0x0000000000000000000000000000000000000000") {
      throw new Error(`Invalid address in ${name}: ${trimmed}`);
    }
    return getAddress(trimmed);
  });
}

function integerEnv(name: string, min: number, max: number, fallback?: number) {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isSafeInteger(value) || value! < min || value! > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value!;
}

function bigintEnv(name: string) {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) throw new Error(`${name} must be a positive integer`);
  const value = BigInt(raw);
  if (value <= 0n || value > (1n << 128n) - 1n) throw new Error(`${name} is out of uint128 range`);
  return value;
}

function lower(value: string) {
  return value.toLowerCase();
}
