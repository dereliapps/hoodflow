import { NextResponse } from "next/server";

type Candle = [number, number, number, number, number, number];
type ChartPoint = { time: number; open: number; high: number; low: number; close: number; volume: number };
type GeckoChartPayload = { data?: { attributes?: { ohlcv_list?: Candle[] } } };
type GeckoPoolPayload = { data?: Array<{ id?: string }> };

const CHART_TIMEOUT_MS = 8_000;
const CHART_CACHE_TTL_MS = 10 * 60_000;
const chartCache = new Map<string, { expiresAt: number; points: ChartPoint[]; resolvedPool: string }>();

const RANGE = {
  "1D": { timeframe: "minute", aggregate: "15", limit: "96" },
  "7D": { timeframe: "hour", aggregate: "1", limit: "168" },
  "30D": { timeframe: "hour", aggregate: "4", limit: "180" },
} as const;

function address(value: string | null) {
  return value?.toLowerCase().match(/^0x[a-f0-9]{40}$/)?.[0] ?? null;
}

function poolId(value: string | null | undefined) {
  return value?.toLowerCase().match(/^0x(?:[a-f0-9]{40}|[a-f0-9]{64})$/)?.[0] ?? null;
}

function chartUrl(pool: string, token: string, config: (typeof RANGE)[keyof typeof RANGE]) {
  const url = new URL(`https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${pool}/ohlcv/${config.timeframe}`);
  url.searchParams.set("aggregate", config.aggregate);
  url.searchParams.set("limit", config.limit);
  url.searchParams.set("currency", "usd");
  url.searchParams.set("token", token);
  url.searchParams.set("include_empty_intervals", "true");
  return url;
}

async function fetchJson<T>(url: URL, signal: AbortSignal) {
  const response = await fetch(url, {
    headers: { accept: "application/json;version=20230203" },
    signal,
  });
  if (!response.ok) throw new Error(`Market chart ${response.status}`);
  return response.json() as Promise<T>;
}

function parseCandles(payload: GeckoChartPayload) {
  const candles = payload.data?.attributes?.ohlcv_list ?? [];
  const points = candles
    .filter((item) => Array.isArray(item) && item.length >= 6 && item.every(Number.isFinite))
    .map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }))
    .sort((left, right) => left.time - right.time);
  return { points, partial: points.length !== candles.length };
}

async function fallbackPools(token: string, signal: AbortSignal) {
  const url = new URL(`https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/${token}/pools`);
  url.searchParams.set("page", "1");
  url.searchParams.set("order", "h24_volume_usd_desc");
  const payload = await fetchJson<GeckoPoolPayload>(url, signal);
  return (payload.data ?? [])
    .map((item) => poolId(item.id?.replace(/^robinhood_/i, "")))
    .filter((item): item is string => Boolean(item))
    .slice(0, 3);
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const pool = poolId(query.get("pool"));
  const token = address(query.get("token"));
  const range = query.get("range") as keyof typeof RANGE | null;
  if (!pool || !token || !range || !RANGE[range]) {
    return NextResponse.json({ points: [], error: "Invalid chart request." }, { status: 400 });
  }

  const config = RANGE[range];
  const cacheKey = `${pool}:${token}:${range}`;
  const cached = chartCache.get(cacheKey);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(CHART_TIMEOUT_MS)]);

  try {
    let candidates = [pool];
    let lastError: unknown;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      try {
        const parsed = parseCandles(await fetchJson<GeckoChartPayload>(chartUrl(candidate, token, config), signal));
        if (parsed.points.length < 2) throw new Error("No usable chart rounds");
        chartCache.set(cacheKey, { expiresAt: Date.now() + CHART_CACHE_TTL_MS, points: parsed.points, resolvedPool: candidate });
        if (chartCache.size > 100) chartCache.delete(chartCache.keys().next().value ?? cacheKey);
        return NextResponse.json({
          points: parsed.points,
          range,
          updatedAt: Date.now(),
          partial: parsed.partial,
          source: "geckoterminal",
          resolvedPool: candidate,
          fallbackPool: candidate !== pool,
        }, {
          headers: { "cache-control": "public, max-age=20, s-maxage=120, stale-while-revalidate=900" },
        });
      } catch (error) {
        lastError = error;
        if (index === 0) {
          const discovered = await fallbackPools(token, signal).catch(() => []);
          candidates = [...new Set([...candidates, ...discovered.filter((item) => item !== pool)])];
        }
      }
    }
    throw lastError ?? new Error("Chart provider returned no history");
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "";
    const timedOut = errorName === "TimeoutError";
    const aborted = errorName === "AbortError";
    if (cached?.points.length && cached.expiresAt > Date.now()) {
      return NextResponse.json({
        points: cached.points,
        range,
        updatedAt: Date.now(),
        partial: true,
        stale: true,
        source: "geckoterminal-cache",
        resolvedPool: cached.resolvedPool,
      }, {
        headers: { "cache-control": "public, max-age=10, s-maxage=30, stale-while-revalidate=900" },
      });
    }
    return NextResponse.json({
      points: [],
      partial: true,
      error: timedOut ? "Chart provider timed out. Try again shortly." : aborted ? "Chart request was cancelled." : "Onchain chart history is temporarily unavailable.",
    }, {
      status: timedOut ? 504 : aborted ? 499 : 502,
      headers: { "cache-control": "public, max-age=5, s-maxage=15" },
    });
  }
}
