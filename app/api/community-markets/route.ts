import { NextResponse } from "next/server";
import { ROBINHOOD_TOKENS, USDG_ADDRESS } from "@/lib/hoodflow-mainnet";

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
};

const GECKO_ROOT = "https://api.geckoterminal.com/api/v2";
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
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
      marketCapUsd: nullableNumber(attrs.market_cap_usd) ?? nullableNumber(attrs.fdv_usd),
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
      marketCapUsd: nullableNumber(pair.marketCap) ?? nullableNumber(pair.fdv),
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
    if (!token?.address || !token.symbol || !quote?.address || !quote.symbol) return [];
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
      marketCapUsd: nullableNumber(pair.marketCap) ?? nullableNumber(pair.fdv),
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
    const preferred = row.volume24h > current.volume24h ? row : current;
    merged.set(row.address, {
      ...preferred,
      discovery: discoveries,
      trendingRank: [current.trendingRank, row.trendingRank].filter((value): value is number => value !== null).sort((a, b) => a - b)[0] ?? null,
      canonical: current.canonical || row.canonical,
      category: current.canonical || row.canonical ? "RWA" : preferred.category,
    });
  }
  return [...merged.values()];
}

async function fetchGecko(path: string) {
  const response = await fetch(`${GECKO_ROOT}${path}`, { headers: { accept: "application/json;version=20230203" } });
  if (!response.ok) throw new Error(`GeckoTerminal ${response.status}`);
  return response.json() as Promise<GeckoResponse>;
}

export async function GET(request?: Request) {
  const lookupAddress = request ? new URL(request.url).searchParams.get("token")?.toLowerCase() : null;
  if (lookupAddress) {
    if (!/^0x[a-f0-9]{40}$/.test(lookupAddress)) return NextResponse.json({ markets: [], error: "Invalid token address." }, { status: 400 });
    const [gecko, dex] = await Promise.allSettled([
      fetchGecko(`/networks/robinhood/tokens/${lookupAddress}/pools?page=1&include=base_token%2Cquote_token`),
      fetch(`https://api.dexscreener.com/token-pairs/v1/robinhood/${lookupAddress}`, { headers: { accept: "application/json" } }).then(async (response) => {
        if (!response.ok) throw new Error(`DEX Screener ${response.status}`);
        return response.json() as Promise<DexPair[]>;
      }),
    ]);
    const markets = mergeMarkets([
      ...(gecko.status === "fulfilled" ? parseGecko(gecko.value, "Contract lookup").filter((market) => market.address === lookupAddress) : []),
      ...(dex.status === "fulfilled" ? parseTargetPairs(dex.value, lookupAddress) : []),
    ]).sort((left, right) => right.volume24h - left.volume24h);
    return NextResponse.json({ markets, updatedAt: Date.now() }, { headers: { "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=120" } });
  }
  const canonicalAddresses = [...canonicalRwa.keys()].join(",");
  const requests = await Promise.allSettled([
    fetchGecko("/networks/robinhood/pools?page=1&include=base_token%2Cquote_token&order=h24_volume_usd_desc"),
    fetchGecko("/networks/robinhood/trending_pools?page=1&include=base_token%2Cquote_token"),
    fetchGecko("/networks/robinhood/new_pools?page=1&include=base_token%2Cquote_token"),
    fetch(`https://api.dexscreener.com/tokens/v1/robinhood/${canonicalAddresses}`, { headers: { accept: "application/json" } }).then(async (response) => {
      if (!response.ok) throw new Error(`DEX Screener ${response.status}`);
      return response.json() as Promise<DexPair[]>;
    }),
  ]);
  const [top, trending, newest, canonical] = requests;
  const rows = [
    ...(top.status === "fulfilled" ? parseGecko(top.value, "Top volume") : []),
    ...(trending.status === "fulfilled" ? parseGecko(trending.value, "Trending", true) : []),
    ...(newest.status === "fulfilled" ? parseGecko(newest.value, "New pool") : []),
    ...(canonical.status === "fulfilled" ? parseCanonical(canonical.value) : []),
  ];
  const markets = mergeMarkets(rows);
  if (!markets.length) return NextResponse.json({ markets: [], error: "Market feeds are temporarily unavailable." }, { status: 503, headers: { "cache-control": "no-store" } });
  return NextResponse.json({
    markets,
    updatedAt: Date.now(),
    sources: {
      geckoTerminal: top.status === "fulfilled" || trending.status === "fulfilled" || newest.status === "fulfilled",
      dexScreener: canonical.status === "fulfilled",
    },
  }, { headers: { "cache-control": "public, max-age=20, s-maxage=60, stale-while-revalidate=300" } });
}
