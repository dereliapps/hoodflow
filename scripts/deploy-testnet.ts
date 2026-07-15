import { getAddress, isAddress } from "ethers";
import { network } from "hardhat";

try {
  process.loadEnvFile?.();
} catch {
  // CI or a secrets manager can inject the same variables.
}

type TokenConfig = {
  token: string;
  feed: string;
  heartbeat: number;
  checkOraclePause: boolean;
};

const REQUIRED_CHAIN_ID = 46_630n;
const finalOwner = addressEnv("HOODFLOW_INITIAL_OWNER");
const guardian = addressEnv("HOODFLOW_GUARDIAN");
const universalRouter = addressEnv("HOODFLOW_UNIVERSAL_ROUTER");
const permit2 = addressEnv("HOODFLOW_PERMIT2");
const feeRecipient = addressEnv("HOODFLOW_FEE_RECIPIENT");
const feeBps = integerEnv("HOODFLOW_INITIAL_FEE_BPS", 0, 100);
const keepers = csvAddresses("HOODFLOW_KEEPERS");
const tokenConfigs = parseTokenConfigs();
const sequencerFeed = addressEnv("HOODFLOW_SEQUENCER_UPTIME_FEED");
const sequencerGracePeriod = integerEnv(
  "HOODFLOW_SEQUENCER_GRACE_PERIOD_SECONDS",
  300,
  86_400,
);
const shouldUnpause = process.env.HOODFLOW_UNPAUSE_AFTER_DEPLOY === "true";

const { ethers } = await network.create({
  network: "robinhoodTestnet",
  chainType: "l1",
});
const [deployer] = await ethers.getSigners();
const currentNetwork = await ethers.provider.getNetwork();

if (currentNetwork.chainId !== REQUIRED_CHAIN_ID) {
  throw new Error(`Refusing deployment on chain ${currentNetwork.chainId}; expected ${REQUIRED_CHAIN_ID}`);
}
if ((await ethers.provider.getCode(universalRouter)) === "0x") {
  throw new Error("HOODFLOW_UNIVERSAL_ROUTER has no deployed bytecode");
}
if ((await ethers.provider.getCode(permit2)) === "0x") {
  throw new Error("HOODFLOW_PERMIT2 has no deployed bytecode");
}
if ((await ethers.provider.getCode(sequencerFeed)) === "0x") {
  throw new Error("HOODFLOW_SEQUENCER_UPTIME_FEED has no deployed bytecode");
}
if (shouldUnpause && (keepers.length === 0 || tokenConfigs.length < 2)) {
  throw new Error("Refusing to unpause without a keeper and at least two configured tokens");
}
if (shouldUnpause && deployer.address.toLowerCase() !== finalOwner.toLowerCase()) {
  throw new Error("Refusing to unpause before the final owner controls the deployment");
}

console.log(`Deploying from ${deployer.address} on Robinhood Chain Testnet...`);
const hoodFlow = await ethers.deployContract("HoodFlowDCA", [
  deployer.address,
  guardian,
  ethers.ZeroAddress,
  feeRecipient,
  feeBps,
]);
await hoodFlow.waitForDeployment();
const contractAddress = await hoodFlow.getAddress();
console.log(`HoodFlowDCA deployed at ${contractAddress}`);

const adapter = await ethers.deployContract("UniswapV4DirectAdapter", [
  contractAddress,
  universalRouter,
  permit2,
]);
await adapter.waitForDeployment();
const adapterAddress = await adapter.getAddress();
await (await hoodFlow.setSwapAdapter(adapterAddress)).wait();
console.log(`Bounded V4 adapter deployed at ${adapterAddress}`);

await (
  await hoodFlow.setSequencerConfig(sequencerFeed, sequencerGracePeriod)
).wait();
console.log(`Sequencer feed configured: ${sequencerFeed}`);

for (const keeper of keepers) {
  await (await hoodFlow.setKeeper(keeper, true)).wait();
  console.log(`Keeper enabled: ${keeper}`);
}
for (const config of tokenConfigs) {
  await (
    await hoodFlow.setTokenConfig(
      config.token,
      config.feed,
      config.heartbeat,
      true,
      config.checkOraclePause,
    )
  ).wait();
  console.log(`Token enabled: ${config.token}`);
}

if (shouldUnpause) {
  await (await hoodFlow.unpauseEverything()).wait();
  console.log("Execution enabled after configuration.");
} else {
  console.log("Deployment remains paused. Set HOODFLOW_UNPAUSE_AFTER_DEPLOY=true only after review.");
}

if (deployer.address.toLowerCase() !== finalOwner.toLowerCase()) {
  await (await hoodFlow.transferOwnership(finalOwner)).wait();
  console.log(`Ownership transfer pending acceptance by ${finalOwner}`);
}

function addressEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value || !isAddress(value)) throw new Error(`${name} must be a valid address`);
  return getAddress(value);
}

function integerEnv(name: string, min: number, max: number) {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function csvAddresses(name: string) {
  const raw = process.env[name]?.trim();
  if (!raw) return [];
  return raw.split(",").map((value) => {
    const trimmed = value.trim();
    if (!isAddress(trimmed)) throw new Error(`Invalid address in ${name}: ${trimmed}`);
    return getAddress(trimmed);
  });
}

function parseTokenConfigs(): TokenConfig[] {
  const raw = process.env.HOODFLOW_TOKEN_CONFIGS ?? "[]";
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("HOODFLOW_TOKEN_CONFIGS must be a JSON array");

  return parsed.map((item) => {
    if (typeof item !== "object" || item === null) {
      throw new Error("Every token config must be an object");
    }
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.token !== "string" || !isAddress(candidate.token)
      || typeof candidate.feed !== "string" || !isAddress(candidate.feed)
      || !Number.isInteger(candidate.heartbeat) || Number(candidate.heartbeat) <= 0
      || typeof candidate.checkOraclePause !== "boolean"
    ) {
      throw new Error("Invalid token config");
    }
    return {
      token: getAddress(candidate.token),
      feed: getAddress(candidate.feed),
      heartbeat: Number(candidate.heartbeat),
      checkOraclePause: candidate.checkOraclePause,
    };
  });
}
