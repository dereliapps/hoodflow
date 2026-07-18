/* eslint-disable @next/next/no-img-element -- token artwork is supplied by live market-data providers. */
"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  ZeroAddress,
  formatUnits,
  getAddress,
  parseUnits,
  type Eip1193Provider,
} from "ethers";
import {
  ERC20_ABI,
  PERMIT2_ABI,
  PERMIT2_ADDRESS,
  PERMIT2_TYPES,
  ROBINHOOD_MAINNET,
  UNIVERSAL_ROUTER_ABI,
  UNIVERSAL_ROUTER_ADDRESS,
  USDG_ADDRESS,
  USDG_DECIMALS,
  V2_FACTORY_ABI,
  V2_FACTORY_ADDRESS,
  V2_PAIR_ABI,
  V3_QUOTER_ABI,
  V3_QUOTER_ADDRESS,
  V4_POOL_CANDIDATES,
  V4_QUOTER_ABI,
  V4_QUOTER_ADDRESS,
  WETH_ADDRESS,
  WETH_DECIMALS,
  buildExactInputQuoteParams,
  buildV2ExactInputCalldata,
  buildV3ExactInputCalldata,
  buildV4ExactInputCalldata,
  type PermitSingle,
  type PoolCandidate,
} from "@/lib/hoodflow-mainnet";
import { track } from "@/lib/analytics-client";
import { ROBINHOOD_VIRTUAL_ADDRESS } from "@/lib/launchpads/virtuals";

type Token = { address: string; name: string; symbol: string; decimals: number };
type Route =
  | { protocol: "V2"; pair: string; feeBps: number; amountOut: bigint }
  | { protocol: "V3"; fee: number; amountOut: bigint }
  | { protocol: "V4"; route: PoolCandidate; amountOut: bigint };
type RecentToken = Token & { route: string };
type Settlement = { address: string; symbol: string; decimals: number };
type CommunityMarket = {
  address: string;
  name: string;
  symbol: string;
  category: string;
  imageUrl: string | null;
  priceUsd: number | null;
  priceChange24h: number | null;
  volume24h: number;
  liquidityUsd: number;
  marketCapUsd: number | null;
  transactions24h: number;
  pairAddress: string;
  pairUrl: string;
  quoteAddress: string;
  quoteSymbol: string;
  quoteDecimals: number;
  dex: string;
  poolCreatedAt: string | null;
  discovery: string[];
  canonical: boolean;
  trendingRank: number | null;
  launchpad: "virtuals" | null;
  lifecycle: "bonding" | "graduated" | "dex";
  executionVenue: "dex" | "virtuals-bonding";
  externalUrl: string | null;
  holderCount: number | null;
  bondedVirtual: number | null;
  fdvInVirtual: number | null;
};
type MarketSort = "trending" | "volume" | "gainers" | "losers" | "liquidity" | "new";
type Props = {
  walletAddress: string;
  walletProvider: Eip1193Provider | null;
  onWallet: () => void;
  notify: (message: string) => void;
  onTradeConfirmed: (txHash: string, wallet: string) => void;
};

const V3_FEES = [100, 500, 3_000, 10_000] as const;
const RECENT_KEY = "hoodflow-community-imports-v1";
const MAX_UINT128 = (1n << 128n) - 1n;
const USDG_SETTLEMENT: Settlement = { address: USDG_ADDRESS, symbol: "USDG", decimals: USDG_DECIMALS };
const WETH_SETTLEMENT: Settlement = { address: WETH_ADDRESS, symbol: "WETH", decimals: WETH_DECIMALS };
const VIRTUAL_SETTLEMENT: Settlement = { address: ROBINHOOD_VIRTUAL_ADDRESS, symbol: "VIRTUAL", decimals: 18 };
const MARKET_CATEGORIES = ["All", "Virtuals Agents", "Memes", "RWA", "DeFi", "AI & Agents", "Infrastructure", "Stablecoins", "Community"] as const;

function message(error: unknown) {
  if (error instanceof Error) return error.message.replace("execution reverted: ", "");
  return "The request could not be completed.";
}

function compact(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function prettyAmount(value: bigint, decimals: number) {
  const formatted = formatUnits(value, decimals);
  const numeric = Number(formatted);
  if (!Number.isFinite(numeric)) return formatted;
  if (numeric === 0) return "0";
  if (numeric < 0.0001) return numeric.toExponential(3);
  return numeric.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function compactMoney(value: number | null, price = false) {
  if (value === null || !Number.isFinite(value)) return "—";
  if (price && value > 0 && value < 0.0001) return `$${value.toExponential(2)}`;
  if (price && value < 1) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: value >= 1_000 ? 1 : 2 }).format(value);
}

function percent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  const bounded = Math.max(-99.99, Math.min(999_999, value));
  return `${bounded >= 0 ? "+" : ""}${bounded.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function poolAge(value: string | null) {
  if (!value) return "Unknown";
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "New";
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(elapsed / 60_000))}m`;
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

class RouteUnavailableError extends Error {}

function routeName(route: Route) {
  if (route.protocol === "V2") return "Uniswap V2 · 0.30%";
  if (route.protocol === "V3") return `Uniswap V3 · ${route.fee / 10_000}%`;
  return `Uniswap V4 · ${route.route.fee / 10_000}%`;
}

async function quoteV2(provider: JsonRpcProvider | BrowserProvider, tokenIn: string, tokenOut: string, amountIn: bigint): Promise<Route | null> {
  try {
    const factory = new Contract(V2_FACTORY_ADDRESS, V2_FACTORY_ABI, provider);
    const pairAddress = getAddress(await factory.getPair(tokenIn, tokenOut) as string);
    if (pairAddress === ZeroAddress) return null;
    const pair = new Contract(pairAddress, V2_PAIR_ABI, provider);
    const [token0, reserves] = await Promise.all([
      pair.token0() as Promise<string>,
      pair.getReserves() as Promise<{ reserve0?: bigint; reserve1?: bigint; 0?: bigint; 1?: bigint }>,
    ]);
    const reserve0 = BigInt(reserves.reserve0 ?? reserves[0] ?? 0n);
    const reserve1 = BigInt(reserves.reserve1 ?? reserves[1] ?? 0n);
    const inputIsToken0 = getAddress(token0) === getAddress(tokenIn);
    const reserveIn = inputIsToken0 ? reserve0 : reserve1;
    const reserveOut = inputIsToken0 ? reserve1 : reserve0;
    if (reserveIn <= 0n || reserveOut <= 0n) return null;
    const amountInWithFee = amountIn * 997n;
    const amountOut = amountInWithFee * reserveOut / (reserveIn * 1_000n + amountInWithFee);
    return amountOut > 0n ? { protocol: "V2", pair: pairAddress, feeBps: 30, amountOut } : null;
  } catch { return null; }
}

async function bestRoute(provider: JsonRpcProvider | BrowserProvider, tokenIn: string, tokenOut: string, amountIn: bigint): Promise<Route> {
  const v3 = new Contract(V3_QUOTER_ADDRESS, V3_QUOTER_ABI, provider);
  const v4 = new Contract(V4_QUOTER_ADDRESS, V4_QUOTER_ABI, provider);
  const checks: Array<Promise<Route | null>> = [
    quoteV2(provider, tokenIn, tokenOut, amountIn),
    ...V3_FEES.map(async (fee) => {
      try {
        const result = await v3.quoteExactInputSingle.staticCall({ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0 }) as readonly [bigint, bigint, bigint, bigint];
        return result[0] > 0n ? { protocol: "V3" as const, fee, amountOut: BigInt(result[0]) } : null;
      } catch { return null; }
    }),
    ...V4_POOL_CANDIDATES.map(async (route) => {
      try {
        const result = await v4.quoteExactInputSingle.staticCall(buildExactInputQuoteParams(tokenIn, tokenOut, amountIn, route)) as readonly [bigint, bigint];
        return result[0] > 0n ? { protocol: "V4" as const, route, amountOut: BigInt(result[0]) } : null;
      } catch { return null; }
    }),
  ];
  const routes = (await Promise.all(checks)).filter((route): route is Route => Boolean(route));
  routes.sort((left, right) => left.amountOut > right.amountOut ? -1 : left.amountOut < right.amountOut ? 1 : 0);
  if (!routes[0]) throw new RouteUnavailableError("No executable pool is available for this settlement pair.");
  return routes[0];
}

export default function CommunityTokens({ walletAddress, walletProvider, onWallet, notify, onTradeConfirmed }: Props) {
  const [contractAddress, setContractAddress] = useState("");
  const [token, setToken] = useState<Token | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("20");
  const [slippage, setSlippage] = useState("1");
  const [quote, setQuote] = useState<Route | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [routeError, setRouteError] = useState("");
  const [routeUnavailable, setRouteUnavailable] = useState(false);
  const [settlement, setSettlement] = useState<Settlement>(USDG_SETTLEMENT);
  const [activeMarket, setActiveMarket] = useState<CommunityMarket | null>(null);
  const [recent, setRecent] = useState<RecentToken[]>([]);
  const [markets, setMarkets] = useState<CommunityMarket[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [marketsError, setMarketsError] = useState("");
  const [marketsUpdatedAt, setMarketsUpdatedAt] = useState<number | null>(null);
  const [marketCategory, setMarketCategory] = useState<(typeof MARKET_CATEGORIES)[number]>("All");
  const [marketSort, setMarketSort] = useState<MarketSort>("volume");
  const [marketSearch, setMarketSearch] = useState("");
  const [marketSearchResults, setMarketSearchResults] = useState<CommunityMarket[]>([]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") as RecentToken[];
        setRecent(Array.isArray(saved) ? saved.slice(0, 8) : []);
      } catch { setRecent([]); }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const query = marketSearch.trim();
    if (query.length < 2) {
      setMarketSearchResults([]);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/community-markets?search=${encodeURIComponent(query)}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as { markets?: CommunityMarket[] };
        if (response.ok && Array.isArray(payload.markets)) setMarketSearchResults(payload.markets);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setMarketSearchResults([]);
      }
    }, 300);
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [marketSearch]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/community-markets", { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as { markets?: CommunityMarket[]; updatedAt?: number; error?: string };
        if (!response.ok || !Array.isArray(payload.markets)) throw new Error(payload.error || "Market feed is temporarily unavailable.");
        setMarkets(payload.markets);
        setMarketsUpdatedAt(payload.updatedAt ?? Date.now());
        setMarketsError("");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setMarketsError(message(error));
      } finally {
        if (!controller.signal.aborted) setMarketsLoading(false);
      }
    };
    const start = window.setTimeout(() => void load(), 0);
    const refresh = window.setInterval(() => void load(), 60_000);
    return () => { controller.abort(); window.clearTimeout(start); window.clearInterval(refresh); };
  }, []);

  const categoryCounts = useMemo(() => Object.fromEntries(MARKET_CATEGORIES.map((category) => [
    category,
    category === "All" ? markets.length : markets.filter((market) => market.category === category).length,
  ])) as Record<(typeof MARKET_CATEGORIES)[number], number>, [markets]);

  const visibleMarkets = useMemo(() => {
    const query = marketSearch.trim().toLowerCase();
    const candidates = [...markets, ...marketSearchResults].filter((market, index, all) => all.findIndex((item) => item.address === market.address) === index);
    const filtered = candidates.filter((market) => (marketCategory === "All" || market.category === marketCategory)
      && (!query || market.name.toLowerCase().includes(query) || market.symbol.toLowerCase().includes(query) || market.address.includes(query)));
    return [...filtered].sort((left, right) => {
      if (marketSort === "gainers") return (right.priceChange24h ?? -Infinity) - (left.priceChange24h ?? -Infinity);
      if (marketSort === "losers") return (left.priceChange24h ?? Infinity) - (right.priceChange24h ?? Infinity);
      if (marketSort === "liquidity") return right.liquidityUsd - left.liquidityUsd;
      if (marketSort === "new") return new Date(right.poolCreatedAt ?? 0).getTime() - new Date(left.poolCreatedAt ?? 0).getTime();
      if (marketSort === "trending") return (left.trendingRank ?? 10_000) - (right.trendingRank ?? 10_000) || right.volume24h - left.volume24h;
      return right.volume24h - left.volume24h;
    });
  }, [marketCategory, marketSearch, marketSearchResults, marketSort, markets]);

  const marketStats = useMemo(() => ({
    volume: markets.reduce((total, market) => total + market.volume24h, 0),
    liquidity: markets.reduce((total, market) => total + market.liquidityUsd, 0),
    newPools: markets.filter((market) => market.discovery.includes("New pool")).length,
  }), [markets]);

  const outputLabel = useMemo(() => {
    if (!token || !quote) return "—";
    return side === "buy" ? `${prettyAmount(quote.amountOut, token.decimals)} ${token.symbol}` : `${prettyAmount(quote.amountOut, settlement.decimals)} ${settlement.symbol}`;
  }, [quote, settlement, side, token]);

  function settlementFor(market: CommunityMarket | null): Settlement {
    if (!market?.quoteAddress || !/^0x[a-fA-F0-9]{40}$/.test(market.quoteAddress) || market.quoteAddress === ZeroAddress) return USDG_SETTLEMENT;
    const symbol = market.quoteSymbol.toUpperCase();
    if (symbol === "USDG") return USDG_SETTLEMENT;
    if (symbol === "WETH") return WETH_SETTLEMENT;
    if (symbol === "VIRTUAL") return VIRTUAL_SETTLEMENT;
    return { address: getAddress(market.quoteAddress), symbol: market.quoteSymbol.slice(0, 16), decimals: market.quoteDecimals };
  }

  async function discover(event?: FormEvent, requestedAddress?: string, requestedMarket?: CommunityMarket) {
    event?.preventDefault();
    const rawAddress = requestedAddress || contractAddress;
    if (requestedAddress) setContractAddress(requestedAddress);
    setBusy(true);
    setStep("Reading contract bytecode and ERC-20 metadata…");
    setQuote(null);
    setRouteError("");
    setRouteUnavailable(false);
    try {
      const address = getAddress(rawAddress.trim());
      let market = requestedMarket ?? markets.find((item) => item.address.toLowerCase() === address.toLowerCase()) ?? null;
      if (!market) {
        setStep("Locating this token's deepest live pool…");
        try {
          const marketResponse = await fetch(`/api/community-markets?token=${address}`, { cache: "no-store" });
          const marketPayload = await marketResponse.json() as { markets?: CommunityMarket[] };
          market = marketPayload.markets?.[0] ?? null;
        } catch { market = null; }
      }
      const nextSettlement = settlementFor(market);
      if (address.toLowerCase() === nextSettlement.address.toLowerCase()) throw new Error(`${nextSettlement.symbol} is this market's settlement asset. Select the other token in the pair.`);
      const provider = new JsonRpcProvider(ROBINHOOD_MAINNET.rpcUrls[0], ROBINHOOD_MAINNET.chainIdNumber, { staticNetwork: true });
      const code = await provider.getCode(address);
      if (code === "0x") throw new Error("No contract bytecode exists at this address on Robinhood Chain.");
      const contract = new Contract(address, ERC20_ABI, provider);
      const [name, symbol, decimalsValue] = await Promise.all([contract.name(), contract.symbol(), contract.decimals()]);
      const decimals = Number(decimalsValue);
      if (!name || !symbol || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("This contract does not expose standard ERC-20 metadata.");
      const found = { address, name: String(name).slice(0, 80), symbol: String(symbol).slice(0, 20), decimals };
      setActiveMarket(market);
      setSettlement(nextSettlement);
      setAmount(nextSettlement.symbol === "WETH" ? "0.01" : nextSettlement.symbol === "USDG" ? "20" : "10");
      setToken(found);
      track("community_token_imported", { ticker: found.symbol, address: found.address });
      setStep(market?.executionVenue === "virtuals-bonding"
        ? "Reading this token's Virtuals bonding lifecycle…"
        : `Checking ${nextSettlement.symbol} liquidity across Uniswap V2, V3 and V4…`);
      let routeLabel = `${nextSettlement.symbol} market link`;
      if (market?.executionVenue === "virtuals-bonding") {
        setRouteUnavailable(true);
        routeLabel = "Virtuals BondingV5";
        setStep("This token is still on the Virtuals bonding curve. HoodFlow will not pretend its empty DEX pair is executable; continue on the official Virtuals market.");
      } else try {
        const probeAmount = nextSettlement.symbol === "WETH" ? "0.001" : "1";
        const discovered = await bestRoute(provider, nextSettlement.address, address, parseUnits(probeAmount, nextSettlement.decimals));
        setQuote(discovered);
        routeLabel = routeName(discovered);
        setStep(`${nextSettlement.symbol} route ready. Enter an amount for a fresh executable quote.`);
      } catch (error) {
        if (!(error instanceof RouteUnavailableError)) setRouteError(message(error));
        setRouteUnavailable(true);
        setStep("Market found. Embedded execution is unavailable for this pool; the live pool link remains available.");
      }
      const next = [{ ...found, route: routeLabel }, ...recent.filter((item) => item.address.toLowerCase() !== address.toLowerCase())].slice(0, 8);
      setRecent(next);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch (error) {
      setToken(null);
      setRouteError(message(error));
      setStep("");
    } finally { setBusy(false); }
  }

  async function refreshQuote() {
    if (!token) return;
    setBusy(true);
    setRouteError("");
    setRouteUnavailable(false);
    setStep(`Quoting your exact input across ${settlement.symbol} pools…`);
    try {
      const amountIn = parseUnits(amount, side === "buy" ? settlement.decimals : token.decimals);
      if (amountIn <= 0n || amountIn > MAX_UINT128) throw new Error("Enter a valid amount.");
      const provider = new JsonRpcProvider(ROBINHOOD_MAINNET.rpcUrls[0], ROBINHOOD_MAINNET.chainIdNumber, { staticNetwork: true });
      const result = await bestRoute(provider, side === "buy" ? settlement.address : token.address, side === "buy" ? token.address : settlement.address, amountIn);
      setQuote(result);
      setStep("Fresh executable quote ready. It will be checked again before signing.");
      track("quote_received", { ticker: token.symbol, side, protocol: result.protocol });
    } catch (error) {
      setQuote(null);
      if (error instanceof RouteUnavailableError) {
        setRouteUnavailable(true);
        setStep("No embedded route is currently executable. Open the live pool to continue at the source.");
      } else {
        setRouteError(message(error));
        setStep("");
      }
    } finally { setBusy(false); }
  }

  async function trade() {
    if (!walletAddress || !walletProvider) return onWallet();
    if (!token) return;
    setBusy(true);
    setRouteError("");
    try {
      await walletProvider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ROBINHOOD_MAINNET.chainId }] });
      const provider = new BrowserProvider(walletProvider, "any");
      const signer = await provider.getSigner();
      const amountIn = parseUnits(amount, side === "buy" ? settlement.decimals : token.decimals);
      const slippageBps = Math.round(Number(slippage) * 100);
      if (amountIn <= 0n || amountIn > MAX_UINT128) throw new Error("Enter a valid amount.");
      if (!Number.isInteger(slippageBps) || slippageBps < 10 || slippageBps > 500) throw new Error("Slippage must be between 0.10% and 5.00%.");
      const tokenIn = side === "buy" ? settlement.address : token.address;
      const tokenOut = side === "buy" ? token.address : settlement.address;
      setStep("Refreshing the executable route…");
      const liveQuote = await bestRoute(provider, tokenIn, tokenOut, amountIn);
      setQuote(liveQuote);
      const minAmountOut = liveQuote.amountOut * BigInt(10_000 - slippageBps) / 10_000n;
      const input = new Contract(tokenIn, ERC20_ABI, signer);
      const [balance, gas] = await Promise.all([input.balanceOf(walletAddress) as Promise<bigint>, provider.getBalance(walletAddress)]);
      if (balance < amountIn) throw new Error(`Insufficient ${side === "buy" ? settlement.symbol : token.symbol} balance.`);
      if (gas === 0n) throw new Error("A small ETH balance is required for gas.");
      if (BigInt(await input.allowance(walletAddress, PERMIT2_ADDRESS)) < amountIn) {
        setStep("Confirm the exact Permit2 token approval…");
        const approval = await input.approve(PERMIT2_ADDRESS, amountIn);
        const approvalReceipt = await approval.wait();
        if (!approvalReceipt || approvalReceipt.status !== 1) throw new Error("Token approval was not confirmed.");
      }
      const permit2 = new Contract(PERMIT2_ADDRESS, PERMIT2_ABI, provider);
      const allowance = await permit2.allowance(walletAddress, tokenIn, UNIVERSAL_ROUTER_ADDRESS) as { nonce?: bigint; 2?: bigint };
      const now = Math.floor(Date.now() / 1_000);
      const permit: PermitSingle = { details: { token: tokenIn, amount: amountIn, expiration: now + 600, nonce: BigInt(allowance.nonce ?? allowance[2] ?? 0n) }, spender: UNIVERSAL_ROUTER_ADDRESS, sigDeadline: now + 600 };
      setStep("Sign the exact, ten-minute order permission…");
      const signature = await signer.signTypedData({ name: "Permit2", chainId: ROBINHOOD_MAINNET.chainIdNumber, verifyingContract: PERMIT2_ADDRESS }, PERMIT2_TYPES, permit);
      const calldata = liveQuote.protocol === "V2"
        ? buildV2ExactInputCalldata({ tokenIn, tokenOut, recipient: walletAddress, amountIn, minAmountOut, permit, signature })
        : liveQuote.protocol === "V3"
          ? buildV3ExactInputCalldata({ tokenIn, tokenOut, recipient: walletAddress, amountIn, minAmountOut, fee: liveQuote.fee, permit, signature })
          : buildV4ExactInputCalldata({ tokenIn, tokenOut, amountIn, minAmountOut, route: liveQuote.route, permit, signature });
      setStep("Confirm the protected mainnet trade in your wallet…");
      track("transaction_started", { ticker: token.symbol, side });
      const router = new Contract(UNIVERSAL_ROUTER_ADDRESS, UNIVERSAL_ROUTER_ABI, signer);
      const transaction = await router.execute(calldata.commands, calldata.inputs, now + 300);
      setStep("Waiting for Robinhood Chain confirmation…");
      const receipt = await transaction.wait();
      if (!receipt || receipt.status !== 1) throw new Error("The trade was not confirmed.");
      track("transaction_confirmed", { ticker: token.symbol, side });
      onTradeConfirmed(receipt.hash, walletAddress);
      notify(`${side === "buy" ? "Buy" : "Sell"} confirmed: ${token.symbol}`);
      setStep(`Confirmed on mainnet · ${compact(receipt.hash)}`);
    } catch (error) {
      setRouteError(message(error));
      setStep("");
      track("transaction_failed", { ticker: token.symbol, side });
    } finally { setBusy(false); }
  }

  function loadRecent(item: RecentToken) {
    document.getElementById("ca-import")?.scrollIntoView({ behavior: "smooth", block: "start" });
    void discover(undefined, item.address, markets.find((market) => market.address.toLowerCase() === item.address.toLowerCase()));
  }

  function inspectMarket(market: CommunityMarket) {
    track("community_market_opened", { ticker: market.symbol, category: market.category });
    document.getElementById("ca-import")?.scrollIntoView({ behavior: "smooth", block: "start" });
    void discover(undefined, market.address, market);
  }

  return <section className="page inner-page community-page">
    <div className="community-hero">
      <div><p className="eyebrow">ROBINHOOD CHAIN TOKEN TERMINAL</p><h1>Every market.<br /><span>One live tape.</span></h1><p>Follow Virtuals launches, meme tokens, canonical RWAs, DeFi, AI and live DEX pools from one screen. HoodFlow separates bonding curves from graduated markets before it checks executable V2, V3 and V4 liquidity.</p></div>
      <div className="community-hero-badge"><strong>24/7</strong><span>WHEN ONCHAIN<br />LIQUIDITY EXISTS</span></div>
    </div>
    <section className="market-pulse" aria-label="Robinhood Chain token market summary">
      <div><span>TRACKED TOKENS</span><strong>{marketsLoading ? "—" : markets.length}</strong><small>Across live discovery feeds</small></div>
      <div><span>24H POOL VOLUME</span><strong>{marketsLoading ? "—" : compactMoney(marketStats.volume)}</strong><small>Deduplicated token leaders</small></div>
      <div><span>TRACKED LIQUIDITY</span><strong>{marketsLoading ? "—" : compactMoney(marketStats.liquidity)}</strong><small>Best discovered pool per token</small></div>
      <div><span>NEW POOLS</span><strong>{marketsLoading ? "—" : marketStats.newPools}</strong><small>Latest Robinhood pool feed</small></div>
    </section>

    <section className="category-deck">
      <div className="market-section-title"><div><p className="eyebrow">MARKET CATEGORIES</p><h2>Choose your corner of the chain.</h2></div><p>Virtuals Agents come from Virtuals&apos; official Robinhood Chain feed. RWA status comes from HoodFlow&apos;s canonical registry; remaining categories are inferred from public metadata.</p></div>
      <div className="category-grid">{MARKET_CATEGORIES.map((category, index) => <button key={category} className={marketCategory === category ? "active" : ""} onClick={() => setMarketCategory(category)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{category}</strong><small>{categoryCounts[category]} tokens</small></button>)}</div>
    </section>

    <section className="market-board">
      <div className="market-board-head"><div><p className="eyebrow">LIVE TOKEN TAPE</p><h2>{marketCategory === "All" ? "Robinhood Chain markets" : marketCategory}</h2><span>{marketsUpdatedAt ? `Updated ${new Date(marketsUpdatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}` : "Connecting to market feeds"}</span></div><label><span>Q</span><input value={marketSearch} onChange={(event) => setMarketSearch(event.target.value)} placeholder="Token, ticker or CA" aria-label="Search community markets" /></label></div>
      <div className="market-rank-tabs">{(["trending", "volume", "gainers", "losers", "liquidity", "new"] as MarketSort[]).map((sort) => <button key={sort} className={marketSort === sort ? "active" : ""} onClick={() => setMarketSort(sort)}>{sort === "trending" ? "Trending" : sort === "volume" ? "Top volume" : sort === "gainers" ? "Top gainers" : sort === "losers" ? "Top losers" : sort === "liquidity" ? "Liquidity" : "New pools"}</button>)}</div>
      <div className="token-market-table">
        <div className="token-market-header"><span># / TOKEN</span><span>PRICE</span><span>24H</span><span>VOLUME</span><span>LIQUIDITY</span><span>MCAP / FDV</span><span>POOL</span><span /></div>
        {marketsLoading && <div className="market-loading"><i /><strong>Syncing Robinhood Chain pools…</strong><span>Top volume, trending, new pools and canonical RWA routes</span></div>}
        {!marketsLoading && marketsError && !markets.length && <div className="market-loading error"><strong>Market feed temporarily unavailable</strong><span>{marketsError}</span></div>}
        {!marketsLoading && visibleMarkets.map((market, index) => <article className="token-market-row" key={market.address}>
          <button className="token-market-identity" onClick={() => inspectMarket(market)}>{market.imageUrl ? <img src={market.imageUrl} alt="" width={40} height={40} loading="lazy" /> : <b>{market.symbol.slice(0, 2).toUpperCase()}</b>}<span>{String(index + 1).padStart(2, "0")}</span><p><strong>{market.symbol}</strong><small>{market.name}</small></p>{market.canonical && <em>CANONICAL</em>}{market.launchpad === "virtuals" && <em className="virtuals">VIRTUALS</em>}</button>
          <div className="market-number"><strong>{compactMoney(market.priceUsd, true)}</strong><small>{compact(market.address)}</small></div>
          <strong className={`market-change ${(market.priceChange24h ?? 0) >= 0 ? "up" : "down"}`}>{percent(market.priceChange24h)}</strong>
          <div className="market-number"><strong>{compactMoney(market.volume24h)}</strong><small>{market.transactions24h.toLocaleString("en-US")} txns</small></div>
          <div className="market-number"><strong>{compactMoney(market.liquidityUsd)}</strong><small>pool reserve</small></div>
          <div className="market-number"><strong>{market.fdvInVirtual !== null ? `${market.fdvInVirtual.toLocaleString("en-US", { maximumFractionDigits: 0 })} VIRTUAL` : compactMoney(market.marketCapUsd)}</strong><small>{market.holderCount !== null ? `${market.holderCount.toLocaleString("en-US")} holders` : market.category}</small></div>
          <div className="market-pair"><strong>{market.lifecycle === "bonding" ? "BONDING" : `${market.symbol}/${market.quoteSymbol}`}</strong><small>{market.dex} · {poolAge(market.poolCreatedAt)}</small></div>
          <div className="market-row-actions"><button onClick={() => inspectMarket(market)}>Inspect CA</button><a href={market.externalUrl || market.pairUrl} target="_blank" rel="noreferrer">{market.lifecycle === "bonding" ? "Virtuals ↗" : "Market ↗"}</a></div>
        </article>)}
        {!marketsLoading && !marketsError && !visibleMarkets.length && <div className="market-loading"><strong>No matching token</strong><span>Choose another category or clear your search.</span></div>}
      </div>
      <div className="market-data-note"><p><strong>Live market data</strong> from Virtuals, GeckoTerminal and DEX Screener. Bonding tokens stay labeled as bonding until the official lifecycle changes; HoodFlow does not sell ranking positions.</p><span>{marketsError ? `Partial feed: ${marketsError}` : "Refreshes every 60 seconds"}</span></div>
    </section>

    <div id="ca-import" className="ca-import-section"><div className="market-section-title"><div><p className="eyebrow">UNIVERSAL TOKEN DESK</p><h2>One token. Its actual lifecycle.</h2></div><p>HoodFlow identifies launchpad bonding, graduated liquidity and standard DEX markets. Embedded execution is enabled only when a verifiable V2, V3 or V4 route exists.</p></div>
    <div className="token-safety-strip"><span>UNREVIEWED TOKEN MODE</span><p>A valid contract, price or rising chart is not proof of safety. Verify the CA, issuer, transfer behavior and liquidity yourself. HoodFlow never labels an imported community token as verified.</p></div>
    <form className="ca-search" onSubmit={discover}><label>CONTRACT ADDRESS (CA)<input value={contractAddress} onChange={(event) => setContractAddress(event.target.value)} placeholder="0x… on Robinhood Chain" spellCheck={false} /></label><button disabled={busy || !contractAddress.trim()}>{busy ? "Checking…" : "Discover token →"}</button></form>
    {token && <div className="community-terminal">
      <header className="terminal-token-head">
        <div className="terminal-token-mark">{activeMarket?.imageUrl ? <img src={activeMarket.imageUrl} alt="" /> : <span style={{ background: `linear-gradient(135deg,#${token.address.slice(2, 8)},#${token.address.slice(-6)})` }}>{token.symbol.slice(0, 2).toUpperCase()}</span>}</div>
        <div><p>ROBINHOOD CHAIN · ERC-20</p><h2>{token.name} <em>{token.symbol}</em></h2><a href={`${ROBINHOOD_MAINNET.blockExplorerUrls[0]}/token/${token.address}`} target="_blank" rel="noreferrer">{compact(token.address)} ↗</a></div>
        <div className="terminal-market-badges"><span>{activeMarket?.category ?? "Community"}</span><strong>{activeMarket?.lifecycle === "bonding" ? "BONDING" : quote ? "ROUTE LIVE" : routeUnavailable ? "MARKET LINK" : "CHECKING"}</strong></div>
      </header>
      <div className="terminal-body">
        <section className="terminal-market-card">
          <p className="terminal-label">DISCOVERED MARKET</p>
          <div className="terminal-price"><strong>{compactMoney(activeMarket?.priceUsd ?? null, true)}</strong><span className={(activeMarket?.priceChange24h ?? 0) >= 0 ? "up" : "down"}>{percent(activeMarket?.priceChange24h ?? null)}</span></div>
          <div className="terminal-market-stats"><div><span>24H VOLUME</span><strong>{compactMoney(activeMarket?.volume24h ?? 0)}</strong></div><div><span>{activeMarket?.lifecycle === "bonding" ? "BONDED" : "LIQUIDITY"}</span><strong>{activeMarket?.lifecycle === "bonding" && activeMarket.bondedVirtual !== null ? `${activeMarket.bondedVirtual.toLocaleString("en-US")} VIRTUAL` : compactMoney(activeMarket?.liquidityUsd ?? 0)}</strong></div><div><span>PAIR</span><strong>{token.symbol}/{settlement.symbol}</strong></div><div><span>VENUE</span><strong>{activeMarket?.dex ?? "Auto route"}</strong></div></div>
          <p className="terminal-risk">Community tokens are unreviewed. Confirm the contract and pool before signing.</p>
        </section>
        <section className="community-trade-panel">
          <div className="community-tabs"><button className={side === "buy" ? "active" : ""} onClick={() => { setSide("buy"); setAmount(settlement.symbol === "WETH" ? "0.01" : settlement.symbol === "USDG" ? "20" : "10"); setQuote(null); }} type="button">Buy</button><button className={side === "sell" ? "active" : ""} onClick={() => { setSide("sell"); setAmount("1"); setQuote(null); }} type="button">Sell</button></div>
          <label className="terminal-amount"><span>YOU PAY</span><div><input type="number" min="0" step="any" value={amount} onChange={(event) => { setAmount(event.target.value); setQuote(null); }} /><b>{side === "buy" ? settlement.symbol : token.symbol}</b></div></label>
          <div className="terminal-swap-arrow">↓</div>
          <div className="terminal-receive"><span>YOU RECEIVE · ESTIMATED</span><strong>{outputLabel}</strong></div>
          <div className="terminal-route-line"><div><span>EXECUTION</span><strong>{quote ? routeName(quote) : activeMarket?.lifecycle === "bonding" ? "Virtuals bonding market" : routeUnavailable ? "External pool" : "Finding best pool…"}</strong></div><label>SLIPPAGE <span><input type="number" min="0.1" max="5" step="0.1" value={slippage} onChange={(event) => setSlippage(event.target.value)} />%</span></label></div>
          {step && <p className={`community-step ${routeUnavailable ? "notice" : ""}`}><i />{step}</p>}{routeError && <p className="community-error">{routeError}</p>}
          <div className="community-actions"><button type="button" onClick={() => void refreshQuote()} disabled={busy || !amount || activeMarket?.executionVenue === "virtuals-bonding"}>{busy ? "Checking route…" : activeMarket?.executionVenue === "virtuals-bonding" ? "Bonding route detected" : "Refresh quote"}</button>{routeUnavailable && (activeMarket?.externalUrl || activeMarket?.pairUrl) ? <a href={activeMarket.externalUrl || activeMarket.pairUrl} target="_blank" rel="noreferrer">{activeMarket?.lifecycle === "bonding" ? "Trade on Virtuals ↗" : "Open live pool ↗"}</a> : <button type="button" onClick={() => void trade()} disabled={busy || !quote}>{!walletAddress ? "Connect wallet" : quote ? `${side === "buy" ? "Buy" : "Sell"} ${token.symbol}` : "Quote first"}</button>}</div>
        </section>
      </div>
    </div>}
    {!token && <div className="community-empty"><div>CA</div><h2>Select a market or paste a contract.</h2><p>HoodFlow detects the market&apos;s native quote asset and probes executable Uniswap V2, V3 and V4 pools.</p></div>}
    </div>
    <section className="recent-tokens"><div><p className="eyebrow">THIS DEVICE</p><h2>Recent discoveries</h2></div>{recent.length ? <div className="recent-token-grid">{recent.map((item) => <button key={item.address} onClick={() => loadRecent(item)}><span>{item.symbol.slice(0, 2)}</span><p><strong>{item.symbol}</strong><small>{compact(item.address)}</small></p><b>{item.route}</b></button>)}</div> : <p className="recent-empty">Imported contracts will appear here. HoodFlow does not publish a paid or fabricated “trending” list.</p>}</section>
    <div className="community-method"><article><span>01</span><h3>Contract check</h3><p>Confirms bytecode and standard ERC-20 metadata on chain 4663.</p></article><article><span>02</span><h3>Native pair routing</h3><p>Uses USDG, WETH or the listed pool&apos;s quote asset across Uniswap V2, V3 and V4.</p></article><article><span>03</span><h3>Protected execution</h3><p>Uses an exact token permission, minimum output and direct self-custody settlement.</p></article></div>
  </section>;
}
