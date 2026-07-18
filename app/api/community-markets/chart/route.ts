import { NextResponse } from "next/server";

type Candle = [number, number, number, number, number, number];

const RANGE = {
  "1D": { timeframe: "minute", aggregate: "15", limit: "96" },
  "7D": { timeframe: "hour", aggregate: "1", limit: "168" },
  "30D": { timeframe: "hour", aggregate: "4", limit: "180" },
} as const;

function address(value: string | null) {
  return value?.toLowerCase().match(/^0x[a-f0-9]{40}$/)?.[0] ?? null;
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const pool = address(query.get("pool"));
  const token = address(query.get("token"));
  const range = query.get("range") as keyof typeof RANGE | null;
  if (!pool || !token || !range || !RANGE[range]) {
    return NextResponse.json({ points: [], error: "Invalid chart request." }, { status: 400 });
  }

  const config = RANGE[range];
  const url = new URL(`https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${pool}/ohlcv/${config.timeframe}`);
  url.searchParams.set("aggregate", config.aggregate);
  url.searchParams.set("limit", config.limit);
  url.searchParams.set("currency", "usd");
  url.searchParams.set("token", token);
  url.searchParams.set("include_empty_intervals", "true");

  try {
    const response = await fetch(url, { headers: { accept: "application/json;version=20230203" } });
    if (!response.ok) throw new Error(`Market chart ${response.status}`);
    const payload = await response.json() as { data?: { attributes?: { ohlcv_list?: Candle[] } } };
    const points = (payload.data?.attributes?.ohlcv_list ?? [])
      .filter((item) => Array.isArray(item) && item.length >= 6 && item.every(Number.isFinite))
      .map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }))
      .sort((left, right) => left.time - right.time);
    return NextResponse.json({ points, range, updatedAt: Date.now() }, {
      headers: { "cache-control": "public, max-age=20, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    return NextResponse.json({ points: [], error: error instanceof Error ? error.message : "Chart unavailable." }, {
      status: 502,
      headers: { "cache-control": "no-store" },
    });
  }
}
