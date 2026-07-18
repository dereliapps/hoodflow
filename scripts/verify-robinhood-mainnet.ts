import {
  Contract,
  Interface,
  JsonRpcProvider,
  ZeroAddress,
  getAddress,
  zeroPadValue,
} from "ethers";
import infrastructure from "../config/robinhood-mainnet.json" with { type: "json" };

try {
  process.loadEnvFile?.();
} catch {
  // A provider URL may also be supplied by CI or a secrets manager.
}

const rpcUrl = process.env.ROBINHOOD_MAINNET_RPC_URL?.trim() || infrastructure.rpcUrl;
const expectedChainId = BigInt(infrastructure.chainId);
const provider = new JsonRpcProvider(rpcUrl, infrastructure.chainId, { staticNetwork: true });
const erc20Abi = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
] as const;
const v3FactoryAbi = [
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
] as const;
const v2FactoryAbi = [
  "function getPair(address tokenA, address tokenB) view returns (address pair)",
] as const;
const v2PairAbi = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
] as const;
const v3PoolAbi = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function liquidity() view returns (uint128)",
] as const;
const canonicalV3Fees = [100, 500, 3_000, 10_000] as const;
const v4PoolManagerInterface = new Interface([
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
]);
const stateViewAbi = [
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
] as const;

const network = await provider.getNetwork();
if (network.chainId !== expectedChainId) {
  throw new Error(`Wrong chain: expected ${expectedChainId}, received ${network.chainId}`);
}

const contractEntries = Object.entries(infrastructure.contracts);
const tokenEntries = Object.entries(infrastructure.tokens);
const codeResults = await Promise.all(
  [...contractEntries, ...tokenEntries].map(async ([name, rawAddress]) => {
    const address = getAddress(rawAddress);
    const code = await provider.getCode(address);
    if (code === "0x") throw new Error(`${name} has no bytecode at ${address}`);
    return { name, address, bytecodeBytes: (code.length - 2) / 2 };
  }),
);

const tokenResults = await Promise.all(
  tokenEntries.map(async ([configuredSymbol, rawAddress]) => {
    const address = getAddress(rawAddress);
    const token = new Contract(address, erc20Abi, provider);
    const [onchainSymbol, decimals] = await Promise.all([token.symbol(), token.decimals()]);
    if (String(onchainSymbol).toUpperCase() !== configuredSymbol) {
      throw new Error(`${configuredSymbol} symbol mismatch: received ${String(onchainSymbol)}`);
    }
    if (Number(decimals) < 1 || Number(decimals) > 18) {
      throw new Error(`${configuredSymbol} has unsupported decimals: ${Number(decimals)}`);
    }
    return { symbol: configuredSymbol, address, decimals: Number(decimals) };
  }),
);

const usdG = getAddress(infrastructure.tokens.USDG);
const v3Factory = new Contract(
  getAddress(infrastructure.contracts.v3Factory),
  v3FactoryAbi,
  provider,
);
const v3RouteResults = await Promise.all(
  tokenEntries
    .filter(([symbol]) => symbol !== "USDG")
    .map(async ([symbol, rawAddress]) => {
      const token = getAddress(rawAddress);
      const pools = await Promise.all(
        canonicalV3Fees.map(async (fee) => {
          const poolAddress = getAddress(await v3Factory.getPool(usdG, token, fee));
          if (poolAddress === ZeroAddress) return null;

          const code = await provider.getCode(poolAddress);
          if (code === "0x") throw new Error(`${symbol}/${fee} pool has no bytecode`);
          const pool = new Contract(poolAddress, v3PoolAbi, provider);
          const [token0, token1, liquidity] = await Promise.all([
            pool.token0(),
            pool.token1(),
            pool.liquidity(),
          ]);
          const endpoints = new Set([getAddress(token0), getAddress(token1)]);
          if (!endpoints.has(usdG) || !endpoints.has(token)) {
            throw new Error(`${symbol}/${fee} pool endpoints do not match the configured route`);
          }
          return {
            fee,
            address: poolAddress,
            liquidity: liquidity.toString(),
            executable: liquidity > 0n,
          };
        }),
      );
      const deployedPools = pools.filter((pool) => pool !== null);
      const executablePools = deployedPools.filter((pool) => pool.executable);
      return {
        pair: `${symbol}/USDG`,
        executable: executablePools.length > 0,
        pools: deployedPools,
      };
    }),
);

const v2Factory = new Contract(
  getAddress(infrastructure.contracts.v2Factory),
  v2FactoryAbi,
  provider,
);
const v2RouteResults = await Promise.all(
  tokenEntries
    .filter(([symbol]) => symbol !== "USDG")
    .map(async ([symbol, rawAddress]) => {
      const token = getAddress(rawAddress);
      const pairAddress = getAddress(await v2Factory.getPair(usdG, token));
      if (pairAddress === ZeroAddress) {
        return { pair: `${symbol}/USDG`, executable: false, pool: null };
      }
      const code = await provider.getCode(pairAddress);
      if (code === "0x") throw new Error(`${symbol}/USDG V2 pair has no bytecode`);
      const pair = new Contract(pairAddress, v2PairAbi, provider);
      const [token0, token1, reserves] = await Promise.all([
        pair.token0(),
        pair.token1(),
        pair.getReserves(),
      ]);
      const endpoints = new Set([getAddress(token0), getAddress(token1)]);
      if (!endpoints.has(usdG) || !endpoints.has(token)) {
        throw new Error(`${symbol}/USDG V2 pair endpoints do not match the configured route`);
      }
      const reserve0 = BigInt(reserves[0]);
      const reserve1 = BigInt(reserves[1]);
      return {
        pair: `${symbol}/USDG`,
        executable: reserve0 > 0n && reserve1 > 0n,
        pool: {
          address: pairAddress,
          reserve0: reserve0.toString(),
          reserve1: reserve1.toString(),
        },
      };
    }),
);

const latestBlock = await provider.getBlockNumber();
const stateView = new Contract(
  getAddress(infrastructure.contracts.stateView),
  stateViewAbi,
  provider,
);
const initializeTopic = v4PoolManagerInterface.getEvent("Initialize")!.topicHash;
const v4RouteResults = await Promise.all(
  tokenEntries
    .filter(([symbol]) => symbol !== "USDG")
    .map(async ([symbol, rawAddress]) => {
      const token = getAddress(rawAddress);
      const [currency0, currency1] =
        BigInt(usdG) < BigInt(token) ? [usdG, token] : [token, usdG];
      const logs = await provider.getLogs({
        address: getAddress(infrastructure.contracts.poolManager),
        topics: [
          initializeTopic,
          null,
          zeroPadValue(currency0, 32),
          zeroPadValue(currency1, 32),
        ],
        fromBlock: 0,
        toBlock: latestBlock,
      });
      const pools = await Promise.all(
        logs.map(async (log) => {
          const parsed = v4PoolManagerInterface.parseLog(log);
          if (!parsed) throw new Error(`Unable to parse ${symbol}/USDG V4 initialization`);
          const poolId = String(parsed.args.id);
          const liquidity = BigInt(await stateView.getLiquidity(poolId));
          const fee = Number(parsed.args.fee);
          const tickSpacing = Number(parsed.args.tickSpacing);
          const hooks = getAddress(parsed.args.hooks);
          const adapterCompatible = hooks === ZeroAddress
            && ((fee === 500 && tickSpacing === 10)
              || (fee === 3_000 && tickSpacing === 60)
              || (fee === 10_000 && tickSpacing === 200));
          return {
            id: poolId,
            fee,
            tickSpacing,
            hooks,
            liquidity: liquidity.toString(),
            adapterCompatible,
            executable: liquidity > 0n && adapterCompatible,
            initializedAtBlock: log.blockNumber,
          };
        }),
      );
      return {
        pair: `${symbol}/USDG`,
        executable: pools.some((pool) => pool.executable),
        pools,
      };
    }),
);

for (const [index, token] of tokenEntries.filter(([symbol]) => symbol !== "USDG").entries()) {
  const symbol = token[0];
  if (!v4RouteResults[index].executable) {
    throw new Error(`${symbol}/USDG has no active V4 pool compatible with the bounded adapter`);
  }
}

console.log(JSON.stringify({
  verified: true,
  chainId: Number(network.chainId),
  latestBlock,
  bytecodeChecks: codeResults.length,
  contracts: codeResults.filter(({ name }) => name in infrastructure.contracts),
  tokens: tokenResults,
  directV2Routes: v2RouteResults,
  directV3Routes: v3RouteResults,
  directV4Routes: v4RouteResults,
}, null, 2));
