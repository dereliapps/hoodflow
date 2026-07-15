import { Contract, JsonRpcProvider, getAddress } from "ethers";

import { evaluateReleaseEnvironment, MAINNET_CHAIN_ID, ZERO_ADDRESS } from "./lib/mainnet-release.js";

try {
  process.loadEnvFile?.();
} catch {
  // CI and release systems can inject the same values without a local .env file.
}

const ENGINE_ABI = [
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function paused() view returns (bool)",
  "function guardian() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function protocolFeeBps() view returns (uint16)",
  "function swapAdapter() view returns (address)",
  "function sequencerUptimeFeed() view returns (address)",
  "function sequencerGracePeriod() view returns (uint48)",
  "function keeperCount() view returns (uint256)",
  "function allowedTokenCount() view returns (uint256)",
  "function keepers(address) view returns (bool)",
  "function tokenConfigs(address) view returns (address priceFeed,uint48 heartbeat,uint8 tokenDecimals,uint8 feedDecimals,bool allowed,bool checkOraclePause)",
] as const;
const ADAPTER_ABI = [
  "function engine() view returns (address)",
  "function universalRouter() view returns (address)",
  "function permit2() view returns (address)",
] as const;
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
] as const;
const PERMIT2_ABI = [
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
] as const;

const report = evaluateReleaseEnvironment(process.env);
if (!report.ready) {
  throw new Error("Release environment is not complete; run npm run mainnet:preflight first");
}

const engineAddress = requiredAddress("HOODFLOW_CONTRACT_ADDRESS");
const adapterAddress = requiredAddress("HOODFLOW_ADAPTER_ADDRESS");
const provider = new JsonRpcProvider(report.config.primaryRpcUrl, MAINNET_CHAIN_ID, { staticNetwork: true });
const network = await provider.getNetwork();
if (Number(network.chainId) !== MAINNET_CHAIN_ID) {
  throw new Error(`Wrong network ${network.chainId}; expected ${MAINNET_CHAIN_ID}`);
}

const [engineCode, adapterCode] = await Promise.all([
  provider.getCode(engineAddress),
  provider.getCode(adapterAddress),
]);
if (engineCode === "0x" || adapterCode === "0x") throw new Error("Engine or adapter bytecode is missing");

const engine = new Contract(engineAddress, ENGINE_ABI, provider);
const adapter = new Contract(adapterAddress, ADAPTER_ABI, provider);
const permit2 = new Contract(report.config.permit2, PERMIT2_ABI, provider);
const checks: Array<{ label: string; passed: boolean; actual: string }> = [];
const check = (label: string, passed: boolean, actual: unknown) => {
  checks.push({ label, passed, actual: String(actual) });
};

const [
  owner,
  pendingOwner,
  paused,
  guardian,
  feeRecipient,
  protocolFeeBps,
  swapAdapter,
  sequencerFeed,
  sequencerGracePeriod,
  keeperCount,
  allowedTokenCount,
  adapterEngine,
  adapterRouter,
  adapterPermit2,
] = await Promise.all([
  engine.owner(),
  engine.pendingOwner(),
  engine.paused(),
  engine.guardian(),
  engine.feeRecipient(),
  engine.protocolFeeBps(),
  engine.swapAdapter(),
  engine.sequencerUptimeFeed(),
  engine.sequencerGracePeriod(),
  engine.keeperCount(),
  engine.allowedTokenCount(),
  adapter.engine(),
  adapter.universalRouter(),
  adapter.permit2(),
]);

check("ownership accepted by final owner", sameAddress(owner, report.config.finalOwner), owner);
check("no pending ownership transfer", sameAddress(pendingOwner, ZERO_ADDRESS), pendingOwner);
check("engine remains paused", paused === true, paused);
check("guardian", sameAddress(guardian, report.config.guardian), guardian);
check("fee recipient", sameAddress(feeRecipient, report.config.feeRecipient), feeRecipient);
check("protocol fee", Number(protocolFeeBps) === report.config.feeBps, protocolFeeBps);
check("engine adapter", sameAddress(swapAdapter, adapterAddress), swapAdapter);
check("sequencer feed", sameAddress(sequencerFeed, report.config.sequencerFeed), sequencerFeed);
check("sequencer grace period", Number(sequencerGracePeriod) === report.config.sequencerGracePeriod, sequencerGracePeriod);
check("keeper count", Number(keeperCount) === report.config.keepers.length, keeperCount);
check("allowed token count", Number(allowedTokenCount) === report.config.tokenConfigs.length, allowedTokenCount);
check("adapter engine", sameAddress(adapterEngine, engineAddress), adapterEngine);
check("adapter router", sameAddress(adapterRouter, report.config.universalRouter), adapterRouter);
check("adapter Permit2", sameAddress(adapterPermit2, report.config.permit2), adapterPermit2);

for (const keeper of report.config.keepers) {
  check(`keeper ${keeper}`, await engine.keepers(keeper), await engine.keepers(keeper));
}

for (const item of report.config.tokenConfigs) {
  const token = new Contract(item.token, ERC20_ABI, provider);
  const [config, engineBalance, adapterBalance, engineAllowance, adapterAllowance, permit2Allowance] = await Promise.all([
    engine.tokenConfigs(item.token),
    token.balanceOf(engineAddress),
    token.balanceOf(adapterAddress),
    token.allowance(engineAddress, adapterAddress),
    token.allowance(adapterAddress, report.config.permit2),
    permit2.allowance(adapterAddress, item.token, report.config.universalRouter),
  ]);
  check(`${item.token} feed`, sameAddress(config.priceFeed, item.feed), config.priceFeed);
  check(`${item.token} heartbeat`, Number(config.heartbeat) === item.heartbeat, config.heartbeat);
  check(`${item.token} allowed`, config.allowed === true, config.allowed);
  check(`${item.token} pause guard`, config.checkOraclePause === item.checkOraclePause, config.checkOraclePause);
  check(`${item.token} engine custody`, engineBalance === 0n, engineBalance);
  check(`${item.token} adapter custody`, adapterBalance === 0n, adapterBalance);
  check(`${item.token} engine allowance`, engineAllowance === 0n, engineAllowance);
  check(`${item.token} adapter allowance`, adapterAllowance === 0n, adapterAllowance);
  check(`${item.token} Permit2 allowance`, permit2Allowance.amount === 0n, permit2Allowance.amount);
}

const failed = checks.filter((item) => !item.passed);
console.log(JSON.stringify({
  ready: failed.length === 0,
  chainId: MAINNET_CHAIN_ID,
  engine: engineAddress,
  adapter: adapterAddress,
  passed: checks.length - failed.length,
  total: checks.length,
  checks,
}, null, 2));
if (failed.length > 0) process.exitCode = 1;

function requiredAddress(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  try {
    return getAddress(value);
  } catch {
    throw new Error(`${name} must be a valid address`);
  }
}

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}
