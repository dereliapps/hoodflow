import {
  AbiCoder,
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  isAddress,
} from "ethers";

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

const chainId = BigInt(process.env.HOODFLOW_CHAIN_ID?.trim() || "46630");
const dryRun = process.argv.includes("--dry-run");
const rpcUrl = requiredEither("HOODFLOW_RPC_URL", "ROBINHOOD_TESTNET_RPC_URL");
const contractAddress = checkedAddress(required("HOODFLOW_CONTRACT_ADDRESS"));
const quoterAddress = checkedAddress(required("HOODFLOW_V4_QUOTER"));
const pollInterval = boundedInteger("KEEPER_POLL_INTERVAL_MS", 15_000, 3_000, 300_000);
const confirmations = boundedInteger("KEEPER_CONFIRMATIONS", 1, 1, 20);
const maxStrategies = boundedInteger("KEEPER_MAX_STRATEGIES", 500, 1, 10_000);
const privateKey =
  process.env.HOODFLOW_KEEPER_PRIVATE_KEY?.trim()
  || process.env.ROBINHOOD_TESTNET_PRIVATE_KEY?.trim();

const provider = new JsonRpcProvider(rpcUrl, Number(chainId), { staticNetwork: true });
const signer = privateKey ? new Wallet(privateKey, provider) : null;
const contract = new Contract(contractAddress, ENGINE_ABI, signer ?? provider);
const quoter = new Contract(quoterAddress, QUOTER_ABI, provider);
const abiCoder = AbiCoder.defaultAbiCoder();

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

  log("keeper_started", {
    mode: dryRun ? "dry-run" : "execute",
    chainId: chainId.toString(),
    contract: contractAddress,
    quoter: quoterAddress,
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
  const protocolFeeBps = BigInt(await contract.protocolFeeBps());
  const scanThrough = Math.min(strategyCount, maxStrategies);
  let readyCount = 0;
  let routedCount = 0;

  for (let strategyId = 1; strategyId <= scanThrough; strategyId++) {
    if (!(await contract.isStrategyReady(strategyId))) continue;
    readyCount++;

    const strategy = await contract.strategies(strategyId);
    const grossAmount = BigInt(strategy.amountPerExecution);
    const swapAmount = grossAmount - (grossAmount * protocolFeeBps) / BPS_DENOMINATOR;
    const route = await selectBestRoute(strategy.tokenIn, strategy.tokenOut, swapAmount);
    if (!route) {
      log("strategy_skipped", { strategyId, reason: "no_quoted_v4_route" });
      continue;
    }
    routedCount++;

    log("route_selected", {
      strategyId,
      fee: route.fee,
      tickSpacing: route.tickSpacing,
      quotedAmountOut: route.amountOut.toString(),
      action: dryRun || !signer ? "no_broadcast" : "preflight",
    });

    if (dryRun || !signer) continue;

    try {
      // eth_call catches oracle, allowance, balance and adapter failures before broadcast.
      await contract.executeDCA.staticCall(strategyId, route.data);
      const estimatedGas: bigint = await contract.executeDCA.estimateGas(strategyId, route.data);
      const tx = await contract.executeDCA(strategyId, route.data, {
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
    strategyCount,
    scanned: scanThrough,
    readyCount,
    routedCount,
  });
}

async function selectBestRoute(tokenIn: string, tokenOut: string, amountIn: bigint) {
  if (amountIn <= 0n || amountIn > UINT128_MAX) return null;

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
    .reduce<(NonNullable<(typeof quotes)[number]>) | null>(
      (best, quote) => (!best || quote.amountOut > best.amountOut ? quote : best),
      null,
    );
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredEither(primary: string, fallback: string) {
  const value = process.env[primary]?.trim() || process.env[fallback]?.trim();
  if (!value) throw new Error(`${primary} (or ${fallback}) is required`);
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
