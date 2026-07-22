import { NextResponse } from "next/server";
import { and, count, countDistinct, desc, eq, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { analyticsEvents } from "@/db/schema";

const allowedEvents = new Set([
  "page_view",
  "asset_opened",
  "wallet_connect_started",
  "wallet_connected",
  "quote_requested",
  "quote_received",
  "transaction_started",
  "transaction_confirmed",
  "transaction_failed",
  "community_token_imported",
  "community_market_opened",
  "settlement_selected",
  "referral_registered",
  "referral_shared",
  "referral_qualified",
]);

const MAX_BODY_BYTES = 4_096;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;
const writeRate = new Map<string, { count: number; resetAt: number }>();

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).origin !== new URL(request.url).origin) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (!contentType.startsWith("application/json") || contentLength > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false }, { status: 415 });
    }
    const now = Date.now();
    const client = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const previous = writeRate.get(client);
    const rate = !previous || previous.resetAt <= now ? { count: 0, resetAt: now + RATE_WINDOW_MS } : previous;
    rate.count += 1;
    writeRate.set(client, rate);
    if (writeRate.size > 5_000) {
      for (const [key, value] of writeRate) if (value.resetAt <= now) writeRate.delete(key);
    }
    if (rate.count > RATE_LIMIT) {
      return NextResponse.json({ ok: false }, { status: 429, headers: { "retry-after": String(Math.ceil((rate.resetAt - now) / 1_000)) } });
    }
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false }, { status: 413 });
    }
    const body = JSON.parse(rawBody) as {
      event?: unknown;
      path?: unknown;
      sessionId?: unknown;
      referrer?: unknown;
      properties?: { ticker?: unknown };
    };
    const event = clean(body.event, 40);
    const path = clean(body.path, 240);
    const sessionId = clean(body.sessionId, 80);
    const referrer = clean(body.referrer, 120) || "direct";
    const ticker = clean(body.properties?.ticker, 12).toUpperCase() || null;
    if (!allowedEvents.has(event) || !path || !sessionId) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    const db = await getDb();
    await db.insert(analyticsEvents).values({
      id: crypto.randomUUID(),
      event,
      path,
      ticker,
      sessionId,
      referrer,
      createdAt: new Date(),
    });
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const days = Math.min(90, Math.max(1, Number.parseInt(url.searchParams.get("days") || "30", 10) || 30));
  const since = new Date(Date.now() - days * 86_400_000);
  try {
    const db = await getDb();
    const [summary, funnel, topAssets] = await Promise.all([
      db.select({ events: count(), visitors: countDistinct(analyticsEvents.sessionId) })
        .from(analyticsEvents)
        .where(and(gte(analyticsEvents.createdAt, since), eq(analyticsEvents.event, "page_view"))),
      db.select({ event: analyticsEvents.event, total: count(), visitors: countDistinct(analyticsEvents.sessionId) })
        .from(analyticsEvents)
        .where(gte(analyticsEvents.createdAt, since))
        .groupBy(analyticsEvents.event)
        .orderBy(desc(count())),
      db.select({ ticker: analyticsEvents.ticker, opens: count() })
        .from(analyticsEvents)
        .where(and(gte(analyticsEvents.createdAt, since), eq(analyticsEvents.event, "asset_opened")))
        .groupBy(analyticsEvents.ticker)
        .orderBy(desc(count()))
        .limit(10),
    ]);
    return NextResponse.json({ days, pageViews: summary[0]?.events ?? 0, visitors: summary[0]?.visitors ?? 0, funnel, topAssets }, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json({ days, pageViews: 0, visitors: 0, funnel: [], topAssets: [], status: "analytics_unavailable" }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
