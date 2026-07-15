import {
  AbiCoder,
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  isAddress,
} from "ethers";
import { createServer } from "node:http";

try {
  process.loadEnvFile?.();
} catch {
  // Environment variables may be injected by the service manager instead.
}

const ENGINE_ABI = [
  "function strategyCount() view returns (uint256)",
  "function strategies(uint256 strategyId) view returns (address owner,address tokenIn,address tokenOut,uint128 amountPerExecution,uint128 totalBudget,uint128 remainingBudget,uint48 interval,uint48 nextExecution,uint48 expiresAt,uint16 maxSlippageBps,uint8 status)",
  "function protocolFeeBps() view returns (uint16)",
  "function isStrategyReady(uint256 strategyId) view returns (bool)",
  "function executeDCA(uint256 strategyId, bytes routeData) returns (uint256 amountOut)",
  "function keepers(address) view returns (bool)",
  "function paused() view returns (bool)",
] as const;

const QUOTER_ABI = [
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
] as const;

const SUPPORTED_POOLS = [
  { fee: 500, tickSpacing: 10 },
  { fee: 3_000, tickSpacing: 60 },
  { fee: 10_000, tickSpacing: 200 },
] as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BPS_DENOMINATOR = 10_000n;
const UINT128_MAX = (1n << 128n) - 1n;

const chainId = requiredBigInt("HOODFLOW_CHAIN_ID");
const dryRun = process.argv.includes("--dry-run");
const rpcUrl = required("HOODFLOW_RPC_URL");
const contractAddress = checkedAddress(required("HOODFLOW_CONTRACT_ADDRESS"));
const quoterAddress = checkedAddress(required("HOODFLOW_V4_QUOTER"));
const pollInterval = boundedInteger("KEEPER_POLL_INTERVAL_MS", 15_000, 3_000, 300_000);
const confirmations = boundedInteger("KEEPER_CONFIRMATIONS", 1, 1, 20);
const maxStrategies = boundedInteger("KEEPER_MAX_STRATEGIES", 500, 1, 10_000);
const healthHost = process.env.KEEPER_HEALTH_HOST?.trim() || "127.0.0.1";
const healthPort = boundedInteger("KEEPER_HEALTH_PORT", 8_787, 1_024, 65_535);
const privateKey = process.env.HOODFLOW_KEEPER_PRIVATE_KEY?.trim();

const provider = new JsonRpcProvider(rpcUrl, Number(chainId), { staticNetwork: true });
const signer = privateKey ? new Wallet(privateKey, provider) : null;
const contract = new Contract(contractAddress, ENGINE_ABI, signer ?? provider);
const quoter = new Contract(quoterAddress, QUOTER_ABI, provider);
const abiCoder = AbiCoder.defaultAbiCoder();

let stopping = false;
const health = {
  ready: false,
  lastScanAt: null as string | null,
  lastSuccessAt: null as string | null,
  lastError: null as string | null,
};
const healthServer = createServer((request, response) => {
  if (request.method !== "GET" || request.url !== "/healthz") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  const ready = health.ready && !stopping;
  response.writeHead(ready ? 200 : 503, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify({
    mode: dryRun ? "dry-run" : "execute",
    chainId: chainId.toString(),
    contract: contractAddress,
    ...health,
    ready,
  }));
});
process.once("SIGINT", () => {
  stopping = true;
  health.ready = false;
});
process.once("SIGTERM", () => {
  stopping = true;
  health.ready = false;
});

await main();

async function main() {
  const network = await provider.getNetwork();
  if (network.chainId !== chainId) {
    throw new Error(`Wrong network: expected ${chainId}, received ${network.chainId}`);
  }

  const [engineCode, quoterCode] = await Promise.all([
    provider.getCode(contractAddress),
    provider.getCode(quoterAddress),
  ]);
  if (engineCode === "0x") throw new Error("No contract code at HOODFLOW_CONTRACT_ADDRESS");
  if (quoterCode === "0x") throw new Error("No contract code at HOODFLOW_V4_QUOTER");

  if (!dryRun && !signer) {
    throw new Error("HOODFLOW_KEEPER_PRIVATE_KEY is required outside dry-run mode");
  }
  if (signer && !(await contract.keepers(signer.address))) {
    throw new Error(`Configured wallet ${signer.address} is not an approved keeper`);
  }

  await new Promise<void>((resolve, reject) => {
    healthServer.once("error", reject);
    healthServer.listen(healthPort, healthHost, () => resolve());
  });
  health.ready = true;

  log("keeper_started", {
    mode: dryRun ? "dry-run" : "execute",
    chainId: chainId.toString(),
    contract: contractAddress,
    quoter: quoterAddress,
    wallet: signer?.address ?? null,
    pollInterval,
    health: `http://${healthHost}:${healthPort}/healthz`,
  });

  do {
    try {
      health.lastScanAt = new Date().toISOString();
      await scanOnce();
      health.lastSuccessAt = new Date().toISOString();
      health.lastError = null;
    } catch (error) {
      health.lastError = readableError(error);
      log("scan_error", { error: health.lastError });
    }
    if (!stopping) await delay(pollInterval);
  } while (!stopping);

  health.ready = false;
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  log("keeper_stopped", {});
}

async function scanOnce() {
  if (await contract.paused()) {
    log("scan_skipped", { reason: "protocol_paused" });
    return;
  }

  const strategyCount = BigInt(await contract.strategyCount());
  const protocolFeeBps = BigInt(await contract.protocolFeeBps());
  const scanThrough = Number(strategyCount > BigInt(maxStrategies)
    ? BigInt(maxStrategies)
    : strategyCount);
  let readyCount = 0;
  let routedCount = 0;

  for (let strategyId = 1; strategyId <= scanThrough; strategyId++) {
    if (!(await contract.isStrategyReady(strategyId))) continue;
    readyCount++;

    const strategy = await contract.strategies(strategyId);
    const grossAmount = BigInt(strategy.amountPerExecution);
    const swapAmount = grossAmount - (grossAmount * protocolFeeBps) / BPS_DENOMINATOR;
    const routes = await quoteRoutes(strategy.tokenIn, strategy.tokenOut, swapAmount);
    if (routes.length === 0) {
      log("strategy_skipped", { strategyId, reason: "no_quoted_v4_route" });
      continue;
    }

    if (dryRun || !signer) {
      const route = routes[0];
      routedCount++;
      log("route_quoted", {
        strategyId,
        fee: route.fee,
        tickSpacing: route.tickSpacing,
        quotedAmountOut: route.amountOut.toString(),
        action: "no_broadcast",
      });
      continue;
    }

    let selectedRoute: (typeof routes)[number] | null = null;
    let estimatedGas = 0n;
    for (const route of routes) {
      try {
        await contract.executeDCA.staticCall(strategyId, route.data);
        estimatedGas = await contract.executeDCA.estimateGas(strategyId, route.data);
        selectedRoute = route;
        break;
      } catch (error) {
        log("route_preflight_failed", {
          strategyId,
          fee: route.fee,
          tickSpacing: route.tickSpacing,
          error: readableError(error),
        });
      }
    }
    if (!selectedRoute) {
      log("strategy_skipped", { strategyId, reason: "all_quoted_routes_failed_preflight" });
      continue;
    }
    routedCount++;
    log("route_selected", {
      strategyId,
      fee: selectedRoute.fee,
      tickSpacing: selectedRoute.tickSpacing,
      quotedAmountOut: selectedRoute.amountOut.toString(),
      action: "broadcast",
    });

    try {
      const tx = await contract.executeDCA(strategyId, selectedRoute.data, {
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

  log("scan_complete", {
    strategyCount: strategyCount.toString(),
    scanned: scanThrough,
    readyCount,
    routedCount,
  });
}

async function quoteRoutes(tokenIn: string, tokenOut: string, amountIn: bigint) {
  if (amountIn <= 0n || amountIn > UINT128_MAX) return [];

  const input = getAddress(tokenIn);
  const output = getAddress(tokenOut);
  const zeroForOne = BigInt(input) < BigInt(output);
  const currency0 = zeroForOne ? input : output;
  const currency1 = zeroForOne ? output : input;

  const quotes = await Promise.all(
    SUPPORTED_POOLS.map(async ({ fee, tickSpacing }) => {
      try {
        const result = await quoter.quoteExactInputSingle.staticCall([
          [currency0, currency1, fee, tickSpacing, ZERO_ADDRESS],
          zeroForOne,
          amountIn,
          "0x",
        ]);
        const amountOut = BigInt(result.amountOut);
        if (amountOut <= 0n) return null;
        return {
          fee,
          tickSpacing,
          amountOut,
          data: abiCoder.encode(
            ["uint24", "int24", "address"],
            [fee, tickSpacing, ZERO_ADDRESS],
          ),
        };
      } catch {
        return null;
      }
    }),
  );

  return quotes
    .filter((quote): quote is NonNullable<typeof quote> => quote !== null)
    .sort((left, right) => left.amountOut === right.amountOut
      ? 0
      : left.amountOut > right.amountOut ? -1 : 1);
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

function requiredBigInt(name: string) {
  const raw = required(name);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a positive integer`);
  const value = BigInt(raw);
  if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${name} is outside the supported range`);
  }
  return value;
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
