import { AbiCoder, ZeroAddress, getAddress, solidityPacked } from "ethers";

import infrastructure from "../config/robinhood-mainnet.json" with { type: "json" };

export const ROBINHOOD_MAINNET = {
  chainId: "0x1237",
  chainIdNumber: 4_663,
  chainName: "Robinhood Chain",
  rpcUrls: [infrastructure.rpcUrl],
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  blockExplorerUrls: [infrastructure.explorerUrl],
} as const;

export const ROBINHOOD_TOKENS = Object.fromEntries(
  Object.entries(infrastructure.tokens).map(([ticker, address]) => [ticker, getAddress(address)]),
) as Record<string, string>;

export const ROUTED_ASSETS = infrastructure.forkVerifiedAssets as readonly string[];
export const WATCH_ONLY_ASSETS = Object.keys(ROBINHOOD_TOKENS).filter(
  (ticker) => ticker !== "USDG" && !ROUTED_ASSETS.includes(ticker),
);

export const UNIVERSAL_ROUTER_ADDRESS = getAddress(infrastructure.contracts.universalRouter);
export const PERMIT2_ADDRESS = getAddress(infrastructure.contracts.permit2);
export const V4_QUOTER_ADDRESS = getAddress(infrastructure.contracts.quoter);
export const V3_QUOTER_ADDRESS = getAddress(infrastructure.contracts.v3Quoter);
export const USDG_ADDRESS = ROBINHOOD_TOKENS.USDG;
export const USDG_DECIMALS = 6;
export const STOCK_TOKEN_DECIMALS = 18;

export const V4_POOL_CANDIDATES = [
  { fee: 500, tickSpacing: 10 },
  { fee: 3_000, tickSpacing: 60 },
  { fee: 10_000, tickSpacing: 200 },
] as const;

export type PoolCandidate = (typeof V4_POOL_CANDIDATES)[number];

export const V3_ROUTE_FEES = infrastructure.v3VerifiedAssets as Readonly<Record<string, number>>;

export const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
] as const;

export const PERMIT2_ABI = [
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
] as const;

export const V4_QUOTER_ABI = [
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
] as const;

export const V3_QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
] as const;

export const UNIVERSAL_ROUTER_ABI = [
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
] as const;

export const HOODFLOW_ENGINE_ABI = [
  "function paused() view returns (bool)",
  "function settlementToken() view returns (address)",
  "function swapAdapter() view returns (address)",
  "function keeperCount() view returns (uint256)",
  "function allowedTokenCount() view returns (uint256)",
  "function maxTrancheAmount() view returns (uint128)",
  "function maxStrategyBudget() view returns (uint128)",
  "function tokenConfigs(address token) view returns (address priceFeed,uint48 heartbeat,uint8 tokenDecimals,uint8 feedDecimals,bool allowed,bool checkOraclePause)",
  "function createStrategy(address tokenIn,address tokenOut,uint128 amountPerExecution,uint128 totalBudget,uint48 interval,uint48 startAt,uint48 expiresAt,uint16 maxSlippageBps) returns (uint256 strategyId)",
  "function pauseStrategy(uint256 strategyId)",
  "function resumeStrategy(uint256 strategyId)",
  "function cancelStrategy(uint256 strategyId)",
  "event StrategyCreated(uint256 indexed strategyId,address indexed owner,address indexed tokenIn,address tokenOut,uint256 amountPerExecution,uint256 totalBudget,uint256 interval,uint256 startAt,uint256 expiresAt,uint256 maxSlippageBps)",
] as const;

export const PERMIT2_TYPES = {
  PermitDetails: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint160" },
    { name: "expiration", type: "uint48" },
    { name: "nonce", type: "uint48" },
  ],
  PermitSingle: [
    { name: "details", type: "PermitDetails" },
    { name: "spender", type: "address" },
    { name: "sigDeadline", type: "uint256" },
  ],
};

export type PermitSingle = {
  details: {
    token: string;
    amount: bigint;
    expiration: number;
    nonce: bigint;
  };
  spender: string;
  sigDeadline: number;
};

export function isRoutedAsset(ticker: string): boolean {
  return ROUTED_ASSETS.includes(ticker) && Boolean(ROBINHOOD_TOKENS[ticker]);
}

export function isV3RoutedAsset(ticker: string): boolean {
  return Number.isInteger(V3_ROUTE_FEES[ticker]) && V3_ROUTE_FEES[ticker] > 0;
}

export function buildQuoteParams(tokenOut: string, amountIn: bigint, route: PoolCandidate) {
  const normalizedOut = getAddress(tokenOut);
  const currency0 = USDG_ADDRESS.toLowerCase() < normalizedOut.toLowerCase()
    ? USDG_ADDRESS
    : normalizedOut;
  const currency1 = currency0 === USDG_ADDRESS ? normalizedOut : USDG_ADDRESS;

  return {
    poolKey: {
      currency0,
      currency1,
      fee: route.fee,
      tickSpacing: route.tickSpacing,
      hooks: ZeroAddress,
    },
    zeroForOne: currency0 === USDG_ADDRESS,
    exactAmount: amountIn,
    hookData: "0x",
  };
}

export function buildDirectBuyCalldata(args: {
  tokenOut: string;
  amountIn: bigint;
  minAmountOut: bigint;
  route: PoolCandidate;
  permit: PermitSingle;
  signature: string;
}) {
  const coder = AbiCoder.defaultAbiCoder();
  const quote = buildQuoteParams(args.tokenOut, args.amountIn, args.route);
  const swapParams = {
    poolKey: quote.poolKey,
    zeroForOne: quote.zeroForOne,
    amountIn: args.amountIn,
    amountOutMinimum: args.minAmountOut,
    minHopPriceX36: 0,
    hookData: "0x",
  };

  const actions = "0x060c0f";
  const actionParams = [
    coder.encode(
      ["tuple(tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)"],
      [swapParams],
    ),
    coder.encode(["address", "uint256"], [USDG_ADDRESS, args.amountIn]),
    coder.encode(["address", "uint256"], [getAddress(args.tokenOut), args.minAmountOut]),
  ];
  const swapInput = coder.encode(["bytes", "bytes[]"], [actions, actionParams]);
  const permitInput = coder.encode(
    ["tuple(tuple(address token,uint160 amount,uint48 expiration,uint48 nonce) details,address spender,uint256 sigDeadline)", "bytes"],
    [args.permit, args.signature],
  );

  return {
    commands: "0x0a10",
    inputs: [permitInput, swapInput],
  };
}

export function buildV3DirectBuyCalldata(args: {
  tokenOut: string;
  recipient: string;
  amountIn: bigint;
  minAmountOut: bigint;
  fee: number;
  permit: PermitSingle;
  signature: string;
}) {
  const coder = AbiCoder.defaultAbiCoder();
  const path = solidityPacked(
    ["address", "uint24", "address"],
    [USDG_ADDRESS, args.fee, getAddress(args.tokenOut)],
  );
  const swapInput = coder.encode(
    ["address", "uint256", "uint256", "bytes", "bool", "uint256[]"],
    [getAddress(args.recipient), args.amountIn, args.minAmountOut, path, true, []],
  );
  const permitInput = coder.encode(
    ["tuple(tuple(address token,uint160 amount,uint48 expiration,uint48 nonce) details,address spender,uint256 sigDeadline)", "bytes"],
    [args.permit, args.signature],
  );

  return {
    commands: "0x0a00",
    inputs: [permitInput, swapInput],
  };
}
