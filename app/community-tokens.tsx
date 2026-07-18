/* eslint-disable @next/next/no-img-element -- token artwork is supplied by live market-data providers. */
"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
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
  V3_QUOTER_ABI,
  V3_QUOTER_ADDRESS,
  V4_POOL_CANDIDATES,
  V4_QUOTER_ABI,
  V4_QUOTER_ADDRESS,
  buildExactInputQuoteParams,
  buildV3ExactInputCalldata,
  buildV4ExactInputCalldata,
  type PermitSingle,
  type PoolCandidate,
} from "@/lib/hoodflow-mainnet";
import { track } from "@/lib/analytics-client";

type Token = { address: string; name: string; symbol: string; decimals: number };
type Route = { protocol: "V3"; fee: number; amountOut: bigint } | { protocol: "V4"; route: PoolCandidate; amountOut: bigint };
type RecentToken = Token & { route: string };
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
  quoteSymbol: string;
  dex: string;
  poolCreatedAt: string | null;
  discovery: string[];
  canonical: boolean;
  trendingRank: number | null;
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
const MARKET_CATEGORIES = ["All", "Memes", "RWA", "DeFi", "AI & Agents", "Infrastructure", "Stablecoins", "Community"] as const;

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

async function bestRoute(provider: JsonRpcProvider | BrowserProvider, tokenIn: string, tokenOut: string, amountIn: bigint): Promise<Route> {
  const v3 = new Contract(V3_QUOTER_ADDRESS, V3_QUOTER_ABI, provider);
  const v4 = new Contract(V4_QUOTER_ADDRESS, V4_QUOTER_ABI, provider);
  const checks: Array<Promise<Route | null>> = [
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
  if (!routes[0]) throw new Error("No direct USDG route returned an executable quote.");
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
  const [recent, setRecent] = useState<RecentToken[]>([]);
  const [markets, setMarkets] = useState<CommunityMarket[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [marketsError, setMarketsError] = useState("");
  const [marketsUpdatedAt, setMarketsUpdatedAt] = useState<number | null>(null);
  const [marketCategory, setMarketCategory] = useState<(typeof MARKET_CATEGORIES)[number]>("All");
  const [marketSort, setMarketSort] = useState<MarketSort>("volume");
  const [marketSearch, setMarketSearch] = useState("");

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
    const filtered = markets.filter((market) => (marketCategory === "All" || market.category === marketCategory)
      && (!query || market.name.toLowerCase().includes(query) || market.symbol.toLowerCase().includes(query) || market.address.includes(query)));
    return [...filtered].sort((left, right) => {
      if (marketSort === "gainers") return (right.priceChange24h ?? -Infinity) - (left.priceChange24h ?? -Infinity);
      if (marketSort === "losers") return (left.priceChange24h ?? Infinity) - (right.priceChange24h ?? Infinity);
      if (marketSort === "liquidity") return right.liquidityUsd - left.liquidityUsd;
      if (marketSort === "new") return new Date(right.poolCreatedAt ?? 0).getTime() - new Date(left.poolCreatedAt ?? 0).getTime();
      if (marketSort === "trending") return (left.trendingRank ?? 10_000) - (right.trendingRank ?? 10_000) || right.volume24h - left.volume24h;
      return right.volume24h - left.volume24h;
    });
  }, [marketCategory, marketSearch, marketSort, markets]);

  const marketStats = useMemo(() => ({
    volume: markets.reduce((total, market) => total + market.volume24h, 0),
    liquidity: markets.reduce((total, market) => total + market.liquidityUsd, 0),
    newPools: markets.filter((market) => market.discovery.includes("New pool")).length,
  }), [markets]);

  const outputLabel = useMemo(() => {
    if (!token || !quote) return "—";
    return side === "buy" ? `${prettyAmount(quote.amountOut, token.decimals)} ${token.symbol}` : `${prettyAmount(quote.amountOut, USDG_DECIMALS)} USDG`;
  }, [quote, side, token]);

  async function discover(event?: FormEvent, requestedAddress?: string) {
    event?.preventDefault();
    const rawAddress = requestedAddress || contractAddress;
    if (requestedAddress) setContractAddress(requestedAddress);
    setBusy(true);
    setStep("Reading contract bytecode and ERC-20 metadata…");
    setQuote(null);
    setRouteError("");
    try {
      const address = getAddress(rawAddress.trim());
      if (address.toLowerCase() === USDG_ADDRESS.toLowerCase()) throw new Error("USDG is the settlement asset. Enter the token you want to discover.");
      const provider = new JsonRpcProvider(ROBINHOOD_MAINNET.rpcUrls[0], ROBINHOOD_MAINNET.chainIdNumber, { staticNetwork: true });
      const code = await provider.getCode(address);
      if (code === "0x") throw new Error("No contract bytecode exists at this address on Robinhood Chain.");
      const contract = new Contract(address, ERC20_ABI, provider);
      const [name, symbol, decimalsValue] = await Promise.all([contract.name(), contract.symbol(), contract.decimals()]);
      const decimals = Number(decimalsValue);
      if (!name || !symbol || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("This contract does not expose standard ERC-20 metadata.");
      const found = { address, name: String(name).slice(0, 80), symbol: String(symbol).slice(0, 20), decimals };
      setToken(found);
      track("community_token_imported", { ticker: found.symbol, address: found.address });
      setStep("Checking direct USDG liquidity across Uniswap V3 and V4…");
      let routeLabel = "No direct USDG route";
      try {
        const discovered = await bestRoute(provider, USDG_ADDRESS, address, parseUnits("1", USDG_DECIMALS));
        setQuote(discovered);
        routeLabel = discovered.protocol === "V3" ? `V3 / ${discovered.fee}` : `V4 / ${discovered.route.fee}`;
        setStep("Direct USDG route found. Enter an exact amount for a fresh quote.");
      } catch (error) {
        setRouteError(message(error));
        setStep("Token imported in watch mode. Trading stays disabled without a live route.");
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
    setStep("Quoting your exact input across every supported direct pool…");
    try {
      const amountIn = parseUnits(amount, side === "buy" ? USDG_DECIMALS : token.decimals);
      if (amountIn <= 0n || amountIn > MAX_UINT128) throw new Error("Enter a valid amount.");
      const provider = new JsonRpcProvider(ROBINHOOD_MAINNET.rpcUrls[0], ROBINHOOD_MAINNET.chainIdNumber, { staticNetwork: true });
      const result = await bestRoute(provider, side === "buy" ? USDG_ADDRESS : token.address, side === "buy" ? token.address : USDG_ADDRESS, amountIn);
      setQuote(result);
      setStep("Fresh executable quote ready. It will be checked again before signing.");
      track("quote_received", { ticker: token.symbol, side, protocol: result.protocol });
    } catch (error) {
      setQuote(null);
      setRouteError(message(error));
      setStep("");
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
      const amountIn = parseUnits(amount, side === "buy" ? USDG_DECIMALS : token.decimals);
      const slippageBps = Math.round(Number(slippage) * 100);
      if (amountIn <= 0n || amountIn > MAX_UINT128) throw new Error("Enter a valid amount.");
      if (!Number.isInteger(slippageBps) || slippageBps < 10 || slippageBps > 500) throw new Error("Slippage must be between 0.10% and 5.00%.");
      const tokenIn = side === "buy" ? USDG_ADDRESS : token.address;
      const tokenOut = side === "buy" ? token.address : USDG_ADDRESS;
      setStep("Refreshing the executable route…");
      const liveQuote = await bestRoute(provider, tokenIn, tokenOut, amountIn);
      setQuote(liveQuote);
      const minAmountOut = liveQuote.amountOut * BigInt(10_000 - slippageBps) / 10_000n;
      const input = new Contract(tokenIn, ERC20_ABI, signer);
      const [balance, gas] = await Promise.all([input.balanceOf(walletAddress) as Promise<bigint>, provider.getBalance(walletAddress)]);
      if (balance < amountIn) throw new Error(`Insufficient ${side === "buy" ? "USDG" : token.symbol} balance.`);
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
      const calldata = liveQuote.protocol === "V3"
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
    setContractAddress(item.address);
    setToken(item);
    setQuote(null);
    setRouteError("");
    setStep("Imported from this device. Refresh the route before trading.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function inspectMarket(market: CommunityMarket) {
    track("community_market_opened", { ticker: market.symbol, category: market.category });
    document.getElementById("ca-import")?.scrollIntoView({ behavior: "smooth", block: "start" });
    void discover(undefined, market.address);
  }

  return <section className="page inner-page community-page">
    <div className="community-hero">
      <div><p className="eyebrow">ROBINHOOD CHAIN TOKEN TERMINAL</p><h1>Every market.<br /><span>One live tape.</span></h1><p>Follow meme tokens, canonical RWAs, DeFi, AI and new launchpad pools from one screen. Then inspect any contract and let HoodFlow verify whether a direct USDG execution route exists.</p></div>
      <div className="community-hero-badge"><strong>24/7</strong><span>WHEN ONCHAIN<br />LIQUIDITY EXISTS</span></div>
    </div>
    <section className="market-pulse" aria-label="Robinhood Chain token market summary">
      <div><span>TRACKED TOKENS</span><strong>{marketsLoading ? "—" : markets.length}</strong><small>Across live discovery feeds</small></div>
      <div><span>24H POOL VOLUME</span><strong>{marketsLoading ? "—" : compactMoney(marketStats.volume)}</strong><small>Deduplicated token leaders</small></div>
      <div><span>TRACKED LIQUIDITY</span><strong>{marketsLoading ? "—" : compactMoney(marketStats.liquidity)}</strong><small>Best discovered pool per token</small></div>
      <div><span>NEW POOLS</span><strong>{marketsLoading ? "—" : marketStats.newPools}</strong><small>Latest Robinhood pool feed</small></div>
    </section>

    <section className="category-deck">
      <div className="market-section-title"><div><p className="eyebrow">MARKET CATEGORIES</p><h2>Choose your corner of the chain.</h2></div><p>RWA status comes from HoodFlow&apos;s canonical registry. Other categories are assigned automatically from public token metadata and can be imperfect.</p></div>
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
          <button className="token-market-identity" onClick={() => inspectMarket(market)}>{market.imageUrl ? <img src={market.imageUrl} alt="" width={40} height={40} loading="lazy" /> : <b>{market.symbol.slice(0, 2).toUpperCase()}</b>}<span>{String(index + 1).padStart(2, "0")}</span><p><strong>{market.symbol}</strong><small>{market.name}</small></p>{market.canonical && <em>CANONICAL</em>}</button>
          <div className="market-number"><strong>{compactMoney(market.priceUsd, true)}</strong><small>{compact(market.address)}</small></div>
          <strong className={`market-change ${(market.priceChange24h ?? 0) >= 0 ? "up" : "down"}`}>{percent(market.priceChange24h)}</strong>
          <div className="market-number"><strong>{compactMoney(market.volume24h)}</strong><small>{market.transactions24h.toLocaleString("en-US")} txns</small></div>
          <div className="market-number"><strong>{compactMoney(market.liquidityUsd)}</strong><small>pool reserve</small></div>
          <div className="market-number"><strong>{compactMoney(market.marketCapUsd)}</strong><small>{market.category}</small></div>
          <div className="market-pair"><strong>{market.symbol}/{market.quoteSymbol}</strong><small>{market.dex} · {poolAge(market.poolCreatedAt)}</small></div>
          <div className="market-row-actions"><button onClick={() => inspectMarket(market)}>Inspect CA</button><a href={market.pairUrl} target="_blank" rel="noreferrer">Market ↗</a></div>
        </article>)}
        {!marketsLoading && !marketsError && !visibleMarkets.length && <div className="market-loading"><strong>No matching token</strong><span>Choose another category or clear your search.</span></div>}
      </div>
      <div className="market-data-note"><p><strong>Live market data</strong> from GeckoTerminal and DEX Screener. “Trending” follows the provider&apos;s onchain activity feed; HoodFlow does not sell ranking positions.</p><span>{marketsError ? `Partial feed: ${marketsError}` : "Refreshes every 60 seconds"}</span></div>
    </section>

    <div id="ca-import" className="ca-import-section"><div className="market-section-title"><div><p className="eyebrow">CONTRACT INSPECTOR</p><h2>Paste any CA. Verify the route.</h2></div><p>Listed tokens may trade primarily against WETH or another asset. HoodFlow&apos;s embedded execution remains disabled unless it finds a fresh direct USDG route.</p></div>
    <div className="token-safety-strip"><span>UNREVIEWED TOKEN MODE</span><p>A valid contract, price or rising chart is not proof of safety. Verify the CA, issuer, transfer behavior and liquidity yourself. HoodFlow never labels an imported community token as verified.</p></div>
    <form className="ca-search" onSubmit={discover}><label>CONTRACT ADDRESS (CA)<input value={contractAddress} onChange={(event) => setContractAddress(event.target.value)} placeholder="0x… on Robinhood Chain" spellCheck={false} /></label><button disabled={busy || !contractAddress.trim()}>{busy ? "Checking…" : "Discover token →"}</button></form>
    {token && <div className="community-terminal">
      <section className="token-identity-panel"><div className="token-orb" style={{ background: `linear-gradient(135deg,#${token.address.slice(2, 8)},#${token.address.slice(-6)})` }}>{token.symbol.slice(0, 2).toUpperCase()}</div><div><span>IMPORTED ERC-20</span><h2>{token.name} <em>{token.symbol}</em></h2><a href={`${ROBINHOOD_MAINNET.blockExplorerUrls[0]}/token/${token.address}`} target="_blank" rel="noreferrer">{compact(token.address)} ↗</a></div><b>UNREVIEWED</b></section>
      <section className="community-trade-panel"><div className="community-tabs"><button className={side === "buy" ? "active" : ""} onClick={() => { setSide("buy"); setAmount("20"); setQuote(null); }} type="button">Buy</button><button className={side === "sell" ? "active" : ""} onClick={() => { setSide("sell"); setAmount("1"); setQuote(null); }} type="button">Sell</button></div><div className="community-inputs"><label>YOU PAY<span><input type="number" min="0" step="any" value={amount} onChange={(event) => { setAmount(event.target.value); setQuote(null); }} /><b>{side === "buy" ? "USDG" : token.symbol}</b></span></label><label>MAX SLIPPAGE<span><input type="number" min="0.1" max="5" step="0.1" value={slippage} onChange={(event) => setSlippage(event.target.value)} /><b>%</b></span></label></div><div className="community-quote"><div><span>ESTIMATED RECEIVE</span><strong>{outputLabel}</strong></div><div><span>ROUTE</span><strong>{quote ? quote.protocol === "V3" ? `Uniswap V3 · ${quote.fee / 10_000}%` : `Uniswap V4 · ${quote.route.fee / 10_000}%` : "Refresh required"}</strong></div></div>{step && <p className="community-step"><i />{step}</p>}{routeError && <p className="community-error">{routeError}</p>}<div className="community-actions"><button type="button" onClick={() => void refreshQuote()} disabled={busy || !amount}>Refresh quote</button><button type="button" onClick={() => void trade()} disabled={busy || !quote}>{!walletAddress ? "Connect wallet" : quote ? `${side === "buy" ? "Buy" : "Sell"} ${token.symbol}` : "Quote first"}</button></div></section>
    </div>}
    {!token && <div className="community-empty"><div>CA</div><h2>Select a market or paste a contract.</h2><p>HoodFlow reads the token contract, probes supported direct USDG pools and keeps non-routable tokens in watch mode.</p></div>}
    </div>
    <section className="recent-tokens"><div><p className="eyebrow">THIS DEVICE</p><h2>Recent discoveries</h2></div>{recent.length ? <div className="recent-token-grid">{recent.map((item) => <button key={item.address} onClick={() => loadRecent(item)}><span>{item.symbol.slice(0, 2)}</span><p><strong>{item.symbol}</strong><small>{compact(item.address)}</small></p><b>{item.route}</b></button>)}</div> : <p className="recent-empty">Imported contracts will appear here. HoodFlow does not publish a paid or fabricated “trending” list.</p>}</section>
    <div className="community-method"><article><span>01</span><h3>Contract check</h3><p>Confirms bytecode and standard ERC-20 metadata on chain 4663.</p></article><article><span>02</span><h3>Route probe</h3><p>Quotes direct USDG pools across every supported V3 fee tier and hookless V4 configuration.</p></article><article><span>03</span><h3>Protected execution</h3><p>Uses an exact token permission, minimum output and direct self-custody settlement.</p></article></div>
  </section>;
}
