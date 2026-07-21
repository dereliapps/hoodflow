import { NextResponse } from "next/server";
import { ROBINHOOD_TOKENS, USDG_ADDRESS } from "@/lib/hoodflow-mainnet";
import {
  ROBINHOOD_VIRTUAL_ADDRESS,
  ZERO_ADDRESS,
  normalizeVirtualsToken,
  virtualsQuery,
  type VirtualsLifecycle,
  type VirtualsToken,
} from "@/lib/launchpads/virtuals";

type TokenInfo = { address?: string; name?: string; symbol?: string; decimals?: number; image_url?: string | null };
type GeckoPool = {
  id?: string;
  attributes?: Record<string, unknown> & {
    address?: string;
    name?: string;
    pool_created_at?: string;
    base_token_price_usd?: string;
    quote_token_price_usd?: string;
    fdv_usd?: string;
    market_cap_usd?: string | null;
    reserve_in_usd?: string;
    volume_usd?: Record<string, string>;
    price_change_percentage?: Record<string, string>;
    transactions?: Record<string, { buys?: number; sells?: number }>;
  };
  relationships?: {
    base_token?: { data?: { id?: string } };
    quote_token?: { data?: { id?: string } };
    dex?: { data?: { id?: string } };
  };
};
type GeckoResponse = { data?: GeckoPool[]; included?: Array<{ id?: string; type?: string; attributes?: TokenInfo }> };
type DexPair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  txns?: Record<string, { buys?: number; sells?: number }>;
  volume?: Record<string, number>;
  priceChange?: Record<string, number>;
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: { imageUrl?: string };
};

type Market = {
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
  fdvUsd: number | null;
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
  lifecycle: VirtualsLifecycle | "dex";
  executionVenue: "dex" | "virtuals-bonding";
  externalUrl: string | null;
  holderCount: number | null;
  bondedVirtual: number | null;
  fdvInVirtual: number | null;
};

const GECKO_ROOT = "https://api.geckoterminal.com/api/v2";
const UPSTREAM_TIMEOUT_MS = 6_500;
const SETTLEMENT_SYMBOLS = new Set(["WETH", "ETH", "USDG", "USDC", "USDT", "VIRTUAL"]);
const canonicalRwa = new Map(
  Object.entries(ROBINHOOD_TOKENS)
    .filter(([ticker]) => ticker !== "USDG")
    .map(([ticker, address]) => [address.toLowerCase(), ticker]),
);

function finite(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value: unknown) {
  const parsed = nullableNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function upstreamSignal(parent?: AbortSignal | null, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

async function upstreamFetch(input: string | URL, init: RequestInit = {}, parent?: AbortSignal | null) {
  return fetch(input, { ...init, signal: upstreamSignal(parent ?? init.signal) });
}

function classify(address: string, name: string, symbol: string) {
  if (canonicalRwa.has(address.toLowerCase())) return "RWA";
  const text = `${name} ${symbol}`.toLowerCase();
  if (/\b(usdg|usdc|usdt|dai|usd|stable|eurc)\b/.test(text)) return "Stablecoins";
  if (/\b(ai|agent|virtual|bot|gpt|neural|compute)\b/.test(text)) return "AI & Agents";
  if (/\b(swap|finance|dex|lend|borrow|yield|vault|perp|stake|liquid|index|defi)\b/.test(text)) return "DeFi";
  if (/\b(wallet|bridge|oracle|privacy|grid|chain|infra|protocol|network|gas)\b/.test(text)) return "Infrastructure";
  if (/\b(cat|dog|pepe|pon|hood|robin|stonk|rat|frog|inu|ape|moon|bread|chill|tendies|meow|unicorn|baby|bull|bear|meme|wojak|ribbit|hoppy|wolf|wolves)\b/.test(text)) return "Memes";
  return "Community";
}

function tokenMap(response: GeckoResponse) {
  return new Map((response.included ?? [])
    .filter((item) => item.type === "token" && item.id && item.attributes)
    .map((item) => [item.id!, item.attributes!]));
}

function chooseMarketToken(base: TokenInfo, quote: TokenInfo) {
  const baseSymbol = String(base.symbol ?? "").toUpperCase();
  const quoteSymbol = String(quote.symbol ?? "").toUpperCase();
  if (SETTLEMENT_SYMBOLS.has(baseSymbol) && !SETTLEMENT_SYMBOLS.has(quoteSymbol)) return { token: quote, quote: base, inverted: true };
  return { token: base, quote, inverted: false };
}

function parseGecko(response: GeckoResponse, discovery: string, trending = false): Market[] {
  const tokens = tokenMap(response);
  return (response.data ?? []).flatMap((pool, index) => {
    const attrs = pool.attributes;
    const base = tokens.get(pool.relationships?.base_token?.data?.id ?? "");
    const quote = tokens.get(pool.relationships?.quote_token?.data?.id ?? "");
    if (!attrs || !base?.address || !base.symbol || !quote?.address || !quote.symbol) return [];
    const selected = chooseMarketToken(base, quote);
    if (!selected.token.address || !selected.token.symbol) return [];
    const change = finite(attrs.price_change_percentage?.h24, Number.NaN);
    const normalizedChange = Number.isFinite(change) ? (selected.inverted && change !== -100 ? (-change / (100 + change)) * 100 : change) : null;
    const buys = finite(attrs.transactions?.h24?.buys);
    const sells = finite(attrs.transactions?.h24?.sells);
    const address = selected.token.address.toLowerCase();
    return [{
      address,
      name: String(selected.token.name || selected.token.symbol).slice(0, 80),
      symbol: String(selected.token.symbol).slice(0, 20),
      category: classify(address, String(selected.token.name ?? ""), String(selected.token.symbol)),
      imageUrl: selected.token.image_url || null,
      priceUsd: nullableNumber(selected.inverted ? attrs.quote_token_price_usd : attrs.base_token_price_usd),
      priceChange24h: normalizedChange,
      volume24h: finite(attrs.volume_usd?.h24),
      liquidityUsd: finite(attrs.reserve_in_usd),
      marketCapUsd: positiveNumber(attrs.market_cap_usd),
      fdvUsd: positiveNumber(attrs.fdv_usd),
      transactions24h: buys + sells,
      pairAddress: String(attrs.address ?? ""),
      pairUrl: `https://www.geckoterminal.com/robinhood/pools/${attrs.address}`,
      quoteAddress: String(selected.quote.address ?? "").toLowerCase(),
      quoteSymbol: String(selected.quote.symbol ?? ""),
      quoteDecimals: Number.isInteger(Number(selected.quote.decimals)) ? Number(selected.quote.decimals) : 18,
      dex: String(pool.relationships?.dex?.data?.id ?? "Uniswap").replace(/-robinhood$/i, "").replace(/-/g, " "),
      poolCreatedAt: attrs.pool_created_at || null,
      discovery: [discovery],
      canonical: canonicalRwa.has(address),
      trendingRank: trending ? index + 1 : null,
      launchpad: null,
      lifecycle: "dex",
      executionVenue: "dex",
      externalUrl: null,
      holderCount: null,
      bondedVirtual: null,
      fdvInVirtual: null,
    } satisfies Market];
  });
}

function parseCanonical(pairs: DexPair[]): Market[] {
  return pairs.flatMap((pair) => {
    const baseAddress = pair.baseToken?.address?.toLowerCase();
    const quoteAddress = pair.quoteToken?.address?.toLowerCase();
    const token = baseAddress && canonicalRwa.has(baseAddress)
      ? pair.baseToken
      : quoteAddress && canonicalRwa.has(quoteAddress) ? pair.quoteToken : null;
    if (!token?.address || !token.symbol) return [];
    const address = token.address.toLowerCase();
    const tokenIsBase = baseAddress === address;
    const change = nullableNumber(pair.priceChange?.h24);
    return [{
      address,
      name: String(token.name || token.symbol).slice(0, 80),
      symbol: String(token.symbol).slice(0, 20),
      category: "RWA",
      imageUrl: pair.info?.imageUrl || null,
      priceUsd: tokenIsBase ? nullableNumber(pair.priceUsd) : null,
      priceChange24h: tokenIsBase ? change : change !== null && change !== -100 ? (-change / (100 + change)) * 100 : null,
      volume24h: finite(pair.volume?.h24),
      liquidityUsd: finite(pair.liquidity?.usd),
      marketCapUsd: positiveNumber(pair.marketCap),
      fdvUsd: positiveNumber(pair.fdv),
      transactions24h: finite(pair.txns?.h24?.buys) + finite(pair.txns?.h24?.sells),
      pairAddress: String(pair.pairAddress ?? ""),
      pairUrl: pair.url || `https://dexscreener.com/robinhood/${pair.pairAddress}`,
      quoteAddress: String(tokenIsBase ? pair.quoteToken?.address ?? "" : pair.baseToken?.address ?? "").toLowerCase(),
      quoteSymbol: String(tokenIsBase ? pair.quoteToken?.symbol ?? "" : pair.baseToken?.symbol ?? ""),
      quoteDecimals: String(tokenIsBase ? pair.quoteToken?.symbol ?? "" : pair.baseToken?.symbol ?? "").toUpperCase() === "USDG" ? 6 : 18,
      dex: String(pair.dexId ?? "Uniswap"),
      poolCreatedAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : null,
      discovery: ["Canonical RWA"],
      canonical: true,
      trendingRank: null,
      launchpad: null,
      lifecycle: "dex",
      executionVenue: "dex",
      externalUrl: null,
      holderCount: null,
      bondedVirtual: null,
      fdvInVirtual: null,
    } satisfies Market];
  });
}

function parseTargetPairs(pairs: DexPair[], targetAddress: string): Market[] {
  return pairs.flatMap((pair) => {
    const baseAddress = pair.baseToken?.address?.toLowerCase();
    const quoteAddress = pair.quoteToken?.address?.toLowerCase();
    const tokenIsBase = baseAddress === targetAddress;
    if (!tokenIsBase && quoteAddress !== targetAddress) return [];
    const token = tokenIsBase ? pair.baseToken : pair.quoteToken;
    const quote = tokenIsBase ? pair.quoteToken : pair.baseToken;
    if (!token?.address || !token.symbol || !quote?.address || !quote.symbol || quote.address.toLowerCase() === ZERO_ADDRESS) return [];
    const change = nullableNumber(pair.priceChange?.h24);
    return [{
      address: targetAddress,
      name: String(token.name || token.symbol).slice(0, 80),
      symbol: String(token.symbol).slice(0, 20),
      category: classify(targetAddress, String(token.name ?? ""), String(token.symbol)),
      imageUrl: pair.info?.imageUrl || null,
      priceUsd: tokenIsBase ? nullableNumber(pair.priceUsd) : null,
      priceChange24h: tokenIsBase ? change : change !== null && change !== -100 ? (-change / (100 + change)) * 100 : null,
      volume24h: finite(pair.volume?.h24),
      liquidityUsd: finite(pair.liquidity?.usd),
      marketCapUsd: positiveNumber(pair.marketCap),
      fdvUsd: positiveNumber(pair.fdv),
      transactions24h: finite(pair.txns?.h24?.buys) + finite(pair.txns?.h24?.sells),
      pairAddress: String(pair.pairAddress ?? ""),
      pairUrl: pair.url || `https://dexscreener.com/robinhood/${pair.pairAddress}`,
      quoteAddress: String(quote.address).toLowerCase(),
      quoteSymbol: String(quote.symbol).slice(0, 20),
      quoteDecimals: String(quote.symbol).toUpperCase() === "USDG" ? 6 : 18,
      dex: String(pair.dexId ?? "Uniswap"),
      poolCreatedAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : null,
      discovery: ["Contract lookup"],
      canonical: canonicalRwa.has(targetAddress),
      trendingRank: null,
      launchpad: null,
      lifecycle: "dex",
      executionVenue: "dex",
      externalUrl: null,
      holderCount: null,
      bondedVirtual: null,
      fdvInVirtual: null,
    } satisfies Market];
  });
}

function parseVirtuals(tokens: VirtualsToken[], discovery: string, trending = false): Market[] {
  return tokens.flatMap((raw, index) => {
    const token = normalizeVirtualsToken(raw);
    if (!token) return [];
    return [{
      address: token.address,
      name: token.name,
      symbol: token.symbol,
      category: "Virtuals Agents",
      imageUrl: token.imageUrl,
      priceUsd: null,
      priceChange24h: token.priceChange24h,
      volume24h: token.volume24h,
      liquidityUsd: token.liquidityUsd,
      marketCapUsd: null,
      fdvUsd: null,
      transactions24h: 0,
      pairAddress: token.pairAddress,
      pairUrl: token.externalUrl,
      quoteAddress: ROBINHOOD_VIRTUAL_ADDRESS,
      quoteSymbol: "VIRTUAL",
      quoteDecimals: 18,
      dex: token.lifecycle === "bonding" ? "Virtuals BondingV5" : "Virtuals graduated market",
      poolCreatedAt: token.launchedAt,
      discovery: [discovery],
      canonical: false,
      trendingRank: trending ? index + 1 : null,
      launchpad: "virtuals",
      lifecycle: token.lifecycle,
      executionVenue: token.lifecycle === "bonding" ? "virtuals-bonding" : "dex",
      externalUrl: token.externalUrl,
      holderCount: token.holderCount,
      bondedVirtual: token.bondedVirtual,
      fdvInVirtual: token.fdvInVirtual,
    } satisfies Market];
  });
}

function mergeMarkets(rows: Market[]) {
  const merged = new Map<string, Market>();
  for (const row of rows) {
    if (!/^0x[a-f0-9]{40}$/.test(row.address) || row.address === USDG_ADDRESS.toLowerCase() && row.category !== "Stablecoins") continue;
    const current = merged.get(row.address);
    if (!current) {
      merged.set(row.address, row);
      continue;
    }
    const discoveries = Array.from(new Set([...current.discovery, ...row.discovery]));
    const currentDex = current.executionVenue === "dex" && Boolean(current.pairAddress);
    const rowDex = row.executionVenue === "dex" && Boolean(row.pairAddress);
    const preferred = currentDex !== rowDex
      ? rowDex ? row : current
      : row.liquidityUsd !== current.liquidityUsd
        ? row.liquidityUsd > current.liquidityUsd ? row : current
        : row.volume24h > current.volume24h ? row : current;
    const hasExecutableDex = currentDex || rowDex;
    merged.set(row.address, {
      ...preferred,
      imageUrl: preferred.imageUrl || current.imageUrl || row.imageUrl,
      discovery: discoveries,
      trendingRank: [current.trendingRank, row.trendingRank].filter((value): value is number => value !== null).sort((a, b) => a - b)[0] ?? null,
      canonical: current.canonical || row.canonical,
      category: current.canonical || row.canonical ? "RWA" : preferred.category,
      launchpad: current.launchpad || row.launchpad,
      lifecycle: hasExecutableDex ? "dex" : current.lifecycle === "bonding" || row.lifecycle === "bonding" ? "bonding" : preferred.lifecycle,
      executionVenue: hasExecutableDex ? "dex" : "virtuals-bonding",
      externalUrl: current.externalUrl || row.externalUrl,
      holderCount: current.holderCount ?? row.holderCount,
      bondedVirtual: current.bondedVirtual ?? row.bondedVirtual,
      fdvInVirtual: current.fdvInVirtual ?? row.fdvInVirtual,
      dex: hasExecutableDex ? preferred.dex : "Virtuals BondingV5",
    });
  }
  return [...merged.values()];
}

async function fetchGecko(path: string, signal?: AbortSignal | null) {
  const response = await upstreamFetch(`${GECKO_ROOT}${path}`, { headers: { accept: "application/json;version=20230203" } }, signal);
  if (!response.ok) throw new Error(`GeckoTerminal ${response.status}`);
  return response.json() as Promise<GeckoResponse>;
}

async function fetchVirtuals(url: string, signal?: AbortSignal | null) {
  const response = await upstreamFetch(url, { headers: { accept: "application/json" } }, signal);
  if (!response.ok) throw new Error(`Virtuals ${response.status}`);
  const payload = await response.json() as { data?: VirtualsToken[] };
  return Array.isArray(payload.data) ? payload.data : [];
}

async function fetchDexDiscovery(signal?: AbortSignal | null) {
  const discoveryUrls = [
    "https://api.dexscreener.com/token-profiles/latest/v1",
    "https://api.dexscreener.com/token-boosts/top/v1",
    "https://api.dexscreener.com/token-boosts/latest/v1",
  ];
  const discoveries = await Promise.allSettled(discoveryUrls.map(async (url) => {
    const response = await upstreamFetch(url, { headers: { accept: "application/json" } }, signal);
    if (!response.ok) throw new Error(`DEX Screener discovery ${response.status}`);
    return response.json() as Promise<Array<{ chainId?: string; tokenAddress?: string }>>;
  }));
  if (discoveries.every((result) => result.status === "rejected")) {
    throw new Error("DEX Screener discovery is temporarily unavailable");
  }
  const addresses = Array.from(new Set(discoveries.flatMap((result) => result.status === "fulfilled"
    ? result.value.filter((item) => item.chainId === "robinhood" && /^0x[a-fA-F0-9]{40}$/.test(item.tokenAddress ?? "")).map((item) => item.tokenAddress!.toLowerCase())
    : [])));
  if (!addresses.length) return { markets: [], partial: discoveries.some((result) => result.status === "rejected") };
  const chunks = Array.from({ length: Math.ceil(addresses.length / 30) }, (_, index) => addresses.slice(index * 30, index * 30 + 30));
  const pairResults = await Promise.allSettled(chunks.map(async (chunk) => {
    const response = await upstreamFetch(`https://api.dexscreener.com/tokens/v1/robinhood/${chunk.join(",")}`, { headers: { accept: "application/json" } }, signal);
    if (!response.ok) throw new Error(`DEX Screener tokens ${response.status}`);
    return response.json() as Promise<DexPair[]>;
  }));
  if (pairResults.length && pairResults.every((result) => result.status === "rejected")) {
    throw new Error("DEX Screener token markets are temporarily unavailable");
  }
  const pairs = pairResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  return {
    markets: addresses.flatMap((target) => parseTargetPairs(pairs, target)),
    partial: discoveries.some((result) => result.status === "rejected") || pairResults.some((result) => result.status === "rejected"),
  };
}

export async function GET(request?: Request) {
  const searchParams = request ? new URL(request.url).searchParams : null;
  const lookupAddress = searchParams?.get("token")?.toLowerCase() ?? null;
  const search = searchParams?.get("search")?.trim().slice(0, 80) ?? "";
  if (search.length >= 2) {
    const virtualsResult = await Promise.allSettled([fetchVirtuals(virtualsQuery({
      "filters[$or][0][name][$contains]": search,
      "filters[$or][1][symbol][$contains]": search,
      "filters[$or][2][preToken][$contains]": search,
      "filters[$or][3][tokenAddress][$contains]": search,
      "sort[0]": "volume24h:desc",
      "sort[1]": "createdAt:desc",
      "pagination[page]": "1",
      "pagination[pageSize]": "50",
    }), request?.signal)]);
    const virtuals = virtualsResult[0].status === "fulfilled" ? virtualsResult[0].value : [];
    return NextResponse.json({
      markets: mergeMarkets(parseVirtuals(virtuals, "Virtuals search")),
      updatedAt: Date.now(),
      partial: virtualsResult[0].status === "rejected",
      sources: { virtuals: virtualsResult[0].status === "fulfilled" },
      ...(virtualsResult[0].status === "rejected" ? { error: "Virtuals search is temporarily unavailable." } : {}),
    }, { headers: { "cache-control": "public, max-age=10, s-maxage=20, stale-while-revalidate=60" } });
  }
  if (lookupAddress) {
    if (!/^0x[a-f0-9]{40}$/.test(lookupAddress)) return NextResponse.json({ markets: [], error: "Invalid token address." }, { status: 400 });
    const [gecko, dex, virtuals] = await Promise.allSettled([
      fetchGecko(`/networks/robinhood/tokens/${lookupAddress}/pools?page=1&include=base_token%2Cquote_token`, request?.signal),
      upstreamFetch(`https://api.dexscreener.com/token-pairs/v1/robinhood/${lookupAddress}`, { headers: { accept: "application/json" } }, request?.signal).then(async (response) => {
        if (!response.ok) throw new Error(`DEX Screener ${response.status}`);
        return response.json() as Promise<DexPair[]>;
      }),
      fetchVirtuals(virtualsQuery({
        "filters[$or][0][preToken][$contains]": lookupAddress,
        "filters[$or][1][tokenAddress][$contains]": lookupAddress,
        "pagination[page]": "1",
        "pagination[pageSize]": "10",
      }), request?.signal),
    ]);
    const markets = mergeMarkets([
      ...(gecko.status === "fulfilled" ? parseGecko(gecko.value, "Contract lookup").filter((market) => market.address === lookupAddress) : []),
      ...(dex.status === "fulfilled" ? parseTargetPairs(dex.value, lookupAddress) : []),
      ...(virtuals.status === "fulfilled" ? parseVirtuals(virtuals.value, "Virtuals official").filter((market) => market.address === lookupAddress) : []),
    ]).sort((left, right) => right.volume24h - left.volume24h);
    return NextResponse.json({
      markets,
      updatedAt: Date.now(),
      partial: [gecko, dex, virtuals].some((result) => result.status === "rejected"),
      sources: {
        geckoTerminal: gecko.status === "fulfilled",
        dexScreener: dex.status === "fulfilled",
        virtuals: virtuals.status === "fulfilled",
      },
    }, { headers: { "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=120" } });
  }
  const canonicalAddresses = [...canonicalRwa.keys()].join(",");
  const requests = await Promise.allSettled([
    fetchGecko("/networks/robinhood/pools?page=1&include=base_token%2Cquote_token&order=h24_volume_usd_desc", request?.signal),
    fetchGecko("/networks/robinhood/trending_pools?page=1&include=base_token%2Cquote_token", request?.signal),
    fetchGecko("/networks/robinhood/new_pools?page=1&include=base_token%2Cquote_token", request?.signal),
    upstreamFetch(`https://api.dexscreener.com/tokens/v1/robinhood/${canonicalAddresses}`, { headers: { accept: "application/json" } }, request?.signal).then(async (response) => {
      if (!response.ok) throw new Error(`DEX Screener ${response.status}`);
      return response.json() as Promise<DexPair[]>;
    }),
    fetchVirtuals(virtualsQuery({ "sort[0]": "volume24h:desc", "sort[1]": "createdAt:desc", "pagination[page]": "1", "pagination[pageSize]": "60" }), request?.signal),
    fetchVirtuals(virtualsQuery({ "sort[0]": "priceChangePercent24h:desc", "sort[1]": "volume24h:desc", "pagination[page]": "1", "pagination[pageSize]": "40" }), request?.signal),
    fetchVirtuals(virtualsQuery({ "sort[0]": "createdAt:desc", "pagination[page]": "1", "pagination[pageSize]": "60" }), request?.signal),
    fetchDexDiscovery(request?.signal),
  ]);
  const [top, trending, newest, canonical, virtualsVolume, virtualsGainers, virtualsNewest, dexDiscovery] = requests;
  const rows = [
    ...(top.status === "fulfilled" ? parseGecko(top.value, "Top volume") : []),
    ...(trending.status === "fulfilled" ? parseGecko(trending.value, "Trending", true) : []),
    ...(newest.status === "fulfilled" ? parseGecko(newest.value, "New pool") : []),
    ...(canonical.status === "fulfilled" ? parseCanonical(canonical.value) : []),
    ...(virtualsVolume.status === "fulfilled" ? parseVirtuals(virtualsVolume.value, "Virtuals volume") : []),
    ...(virtualsGainers.status === "fulfilled" ? parseVirtuals(virtualsGainers.value, "Virtuals trending", true) : []),
    ...(virtualsNewest.status === "fulfilled" ? parseVirtuals(virtualsNewest.value, "Virtuals new") : []),
    ...(dexDiscovery.status === "fulfilled" ? dexDiscovery.value.markets : []),
  ];
  const markets = mergeMarkets(rows);
  const sources = {
    geckoTerminal: top.status === "fulfilled" || trending.status === "fulfilled" || newest.status === "fulfilled",
    dexScreener: canonical.status === "fulfilled",
    virtuals: virtualsVolume.status === "fulfilled" || virtualsGainers.status === "fulfilled" || virtualsNewest.status === "fulfilled",
    dexDiscovery: dexDiscovery.status === "fulfilled",
  };
  if (!markets.length) return NextResponse.json({ markets: [], partial: true, sources, error: "Market feeds are temporarily unavailable." }, { status: 503, headers: { "cache-control": "no-store" } });
  return NextResponse.json({
    markets,
    updatedAt: Date.now(),
    partial: requests.some((result) => result.status === "rejected") || (dexDiscovery.status === "fulfilled" && dexDiscovery.value.partial),
    sources,
  }, { headers: { "cache-control": "public, max-age=20, s-maxage=60, stale-while-revalidate=300" } });
}
