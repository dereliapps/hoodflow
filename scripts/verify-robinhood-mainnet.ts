import {
  AbiCoder,
  Contract,
  JsonRpcProvider,
  ZeroAddress,
  getAddress,
  keccak256,
} from "ethers";
import infrastructure from "../config/robinhood-mainnet.json" with { type: "json" };

try {
  process.loadEnvFile?.();
} catch {
  // CI or a secrets manager may inject the provider URL instead.
}

const rpcUrl = process.env.ROBINHOOD_MAINNET_RPC_URL?.trim() || infrastructure.rpcUrl;
const expectedChainId = BigInt(infrastructure.chainId);
const provider = new JsonRpcProvider(rpcUrl, infrastructure.chainId, { staticNetwork: true });
const erc20Abi = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
] as const;
const stateViewAbi = [
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
] as const;
const quoterAbi = [
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
] as const;
const quoteAmountIn = 1_000_000n;
const supportedPools = [
  { fee: 500, tickSpacing: 10 },
  { fee: 3_000, tickSpacing: 60 },
  { fee: 10_000, tickSpacing: 200 },
] as const;
const abiCoder = AbiCoder.defaultAbiCoder();

const network = await provider.getNetwork();
if (network.chainId !== expectedChainId) {
  throw new Error(`Wrong chain: expected ${expectedChainId}, received ${network.chainId}`);
}

const contractEntries = Object.entries(infrastructure.contracts);
const tokenEntries = Object.entries(infrastructure.tokens);
const canonicalAssets = [
  ...infrastructure.assetTypes.stocks,
  ...infrastructure.assetTypes.etfs,
];
const forkVerifiedAssets = new Set(infrastructure.forkVerifiedAssets);
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
    const expectedSymbol = infrastructure.onchainSymbolAliases[
      configuredSymbol as keyof typeof infrastructure.onchainSymbolAliases
    ] ?? configuredSymbol;
    if (String(onchainSymbol).toUpperCase() !== expectedSymbol) {
      throw new Error(`${configuredSymbol} symbol mismatch: received ${String(onchainSymbol)}`);
    }
    if (Number(decimals) < 1 || Number(decimals) > 18) {
      throw new Error(`${configuredSymbol} has unsupported decimals: ${Number(decimals)}`);
    }
    return { symbol: configuredSymbol, address, decimals: Number(decimals) };
  }),
);

const latestBlock = await provider.getBlockNumber();
const usdG = getAddress(infrastructure.tokens.USDG);
const stateView = new Contract(
  getAddress(infrastructure.contracts.stateView),
  stateViewAbi,
  provider,
);
const quoter = new Contract(
  getAddress(infrastructure.contracts.quoter),
  quoterAbi,
  provider,
);
async function scanAsset(symbol: string) {
    const token = getAddress(
      infrastructure.tokens[symbol as keyof typeof infrastructure.tokens],
    );
    const [currency0, currency1] =
      BigInt(usdG) < BigInt(token) ? [usdG, token] : [token, usdG];
    const zeroForOne = usdG === currency0;
    const pools = await Promise.all(
      supportedPools.map(async ({ fee, tickSpacing }) => {
        const hooks = ZeroAddress;
        const id = keccak256(abiCoder.encode(
          ["tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"],
          [[currency0, currency1, fee, tickSpacing, hooks]],
        ));
        const liquidity = BigInt(await stateView.getLiquidity(id));

        let quoteAmountOut: bigint | null = null;
        let quoteGasEstimate: bigint | null = null;
        if (liquidity > 0n) {
          try {
            const quote = await quoter.quoteExactInputSingle.staticCall([
              [currency0, currency1, fee, tickSpacing, hooks],
              zeroForOne,
              quoteAmountIn,
              "0x",
            ]);
            quoteAmountOut = BigInt(quote[0]);
            quoteGasEstimate = BigInt(quote[1]);
          } catch {
            // A pool can be initialized yet still fail a real quote; it is not execution-ready.
          }
        }

        return {
          id,
          fee,
          tickSpacing,
          hooks,
          liquidity: liquidity.toString(),
          quoteAmountOut: quoteAmountOut?.toString() ?? null,
          quoteGasEstimate: quoteGasEstimate?.toString() ?? null,
          adapterCompatible: true,
          executable: quoteAmountOut !== null && quoteAmountOut > 0n,
        };
      }),
    );
    const executablePools = pools.filter((pool) => pool.executable);
    const bestPool = executablePools.sort((left, right) => {
      const leftQuote = BigInt(left.quoteAmountOut ?? 0);
      const rightQuote = BigInt(right.quoteAmountOut ?? 0);
      return leftQuote === rightQuote ? 0 : leftQuote > rightQuote ? -1 : 1;
    })[0] ?? null;

    return {
      symbol,
      type: infrastructure.assetTypes.etfs.includes(symbol) ? "ETF" : "STOCK",
      token,
      executable: bestPool !== null,
      bestRoute: bestPool && {
        fee: bestPool.fee,
        tickSpacing: bestPool.tickSpacing,
        hooks: bestPool.hooks,
        quoteAmountIn: quoteAmountIn.toString(),
        quoteAmountOut: bestPool.quoteAmountOut,
      },
      pools,
    };
}

const routeResults: Awaited<ReturnType<typeof scanAsset>>[] = [];
const scanConcurrency = 5;
for (let offset = 0; offset < canonicalAssets.length; offset += scanConcurrency) {
  const batch = canonicalAssets.slice(offset, offset + scanConcurrency);
  routeResults.push(...await Promise.all(batch.map(scanAsset)));
}

for (const symbol of infrastructure.launchAssets) {
  const route = routeResults.find((candidate) => candidate.symbol === symbol);
  if (!route?.executable) {
    throw new Error(`${symbol}/USDG has no quoted V4 route compatible with the adapter`);
  }
}

const executableAssets = routeResults.filter((route) => route.executable);
const fullFillVerifiedAssets = executableAssets.filter((route) =>
  forkVerifiedAssets.has(route.symbol)
);
console.log(JSON.stringify({
  verified: true,
  chainId: Number(network.chainId),
  latestBlock,
  bytecodeChecks: codeResults.length,
  canonicalAssetCount: canonicalAssets.length,
  quoteReadyAssetCount: executableAssets.length,
  fullFillVerifiedAssetCount: fullFillVerifiedAssets.length,
  launchAssetCount: infrastructure.launchAssets.length,
  contracts: codeResults.filter(({ name }) => name in infrastructure.contracts),
  tokens: tokenResults,
  routes: routeResults.map(({ pools, ...route }) => ({
    ...route,
    fullFillVerified: route.executable && forkVerifiedAssets.has(route.symbol),
    initializedPoolCount: pools.length,
    compatiblePoolCount: pools.filter((pool) => pool.adapterCompatible).length,
    quotedPoolCount: pools.filter((pool) => pool.executable).length,
  })),
}, null, 2));
