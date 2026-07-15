import { Contract, JsonRpcProvider, Wallet, getAddress, isAddress } from "ethers";

try {
  process.loadEnvFile?.();
} catch {
  // Environment variables may be injected by the service manager instead.
}

const ABI = [
  "function strategyCount() view returns (uint256)",
  "function isStrategyReady(uint256 strategyId) view returns (bool)",
  "function executeDCA(uint256 strategyId, bytes routeData) returns (uint256 amountOut)",
  "function keepers(address) view returns (bool)",
  "function paused() view returns (bool)",
] as const;

const REQUIRED_CHAIN_ID = 46_630n;
const dryRun = process.argv.includes("--dry-run");
const rpcUrl = required("ROBINHOOD_TESTNET_RPC_URL");
const contractAddress = checkedAddress(required("HOODFLOW_CONTRACT_ADDRESS"));
const pollInterval = boundedInteger("KEEPER_POLL_INTERVAL_MS", 15_000, 3_000, 300_000);
const confirmations = boundedInteger("KEEPER_CONFIRMATIONS", 1, 1, 20);
const maxStrategies = boundedInteger("KEEPER_MAX_STRATEGIES", 500, 1, 10_000);
const privateKey = process.env.ROBINHOOD_TESTNET_PRIVATE_KEY;

const provider = new JsonRpcProvider(rpcUrl, Number(REQUIRED_CHAIN_ID), {
  staticNetwork: true,
});
const signer = privateKey ? new Wallet(privateKey, provider) : null;
const contract = new Contract(contractAddress, ABI, signer ?? provider);

let stopping = false;
process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

await main();

async function main() {
  const network = await provider.getNetwork();
  if (network.chainId !== REQUIRED_CHAIN_ID) {
    throw new Error(`Wrong network: expected ${REQUIRED_CHAIN_ID}, received ${network.chainId}`);
  }

  const code = await provider.getCode(contractAddress);
  if (code === "0x") throw new Error("No contract code at HOODFLOW_CONTRACT_ADDRESS");

  if (!dryRun && !signer) {
    throw new Error("ROBINHOOD_TESTNET_PRIVATE_KEY is required outside dry-run mode");
  }
  if (signer && !(await contract.keepers(signer.address))) {
    throw new Error(`Configured wallet ${signer.address} is not an approved keeper`);
  }

  log("keeper_started", {
    mode: dryRun ? "dry-run" : "execute",
    contract: contractAddress,
    wallet: signer?.address ?? null,
    pollInterval,
  });

  do {
    try {
      await scanOnce();
    } catch (error) {
      log("scan_error", { error: readableError(error) });
    }
    if (!stopping) await delay(pollInterval);
  } while (!stopping);

  log("keeper_stopped", {});
}

async function scanOnce() {
  if (await contract.paused()) {
    log("scan_skipped", { reason: "protocol_paused" });
    return;
  }

  const strategyCount = Number(await contract.strategyCount());
  const scanThrough = Math.min(strategyCount, maxStrategies);
  let readyCount = 0;

  for (let strategyId = 1; strategyId <= scanThrough; strategyId++) {
    if (!(await contract.isStrategyReady(strategyId))) continue;
    readyCount++;

    if (dryRun || !signer) {
      log("strategy_ready", { strategyId, action: "no_broadcast" });
      continue;
    }

    try {
      // eth_call catches stale prices, insufficient allowance and adapter failures before broadcast.
      await contract.executeDCA.staticCall(strategyId, "0x");
      const estimatedGas: bigint = await contract.executeDCA.estimateGas(strategyId, "0x");
      const tx = await contract.executeDCA(strategyId, "0x", {
        gasLimit: (estimatedGas * 120n) / 100n,
      });
      log("transaction_submitted", { strategyId, hash: tx.hash });
      const receipt = await tx.wait(confirmations);
      log("transaction_confirmed", {
        strategyId,
        hash: tx.hash,
        blockNumber: receipt?.blockNumber ?? null,
      });
    } catch (error) {
      log("strategy_failed", { strategyId, error: readableError(error) });
    }
  }

  log("scan_complete", { strategyCount, scanned: scanThrough, readyCount });
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function checkedAddress(value: string) {
  if (!isAddress(value)) throw new Error(`Invalid address: ${value}`);
  return getAddress(value);
}

function boundedInteger(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function readableError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 500);
  return String(error).slice(0, 500);
}

function log(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...data }));
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
