import { NextResponse } from "next/server";
import { asc, count, eq } from "drizzle-orm";
import { getAddress, verifyMessage } from "ethers";
import { getDb } from "@/db";
import { assetRequestVotes } from "@/db/schema";
import { ASSET_REQUEST_CANDIDATES, ASSET_REQUEST_LIMIT, buildAssetVoteMessage } from "@/lib/asset-requests";

export const dynamic = "force-dynamic";

const allowedTickers = new Set(ASSET_REQUEST_CANDIDATES.map((asset) => asset.ticker));

function normalizeWallet(value: unknown) {
  if (typeof value !== "string") throw new Error("Connect a valid wallet first.");
  return getAddress(value).toLowerCase();
}

function normalizeTicker(value: unknown) {
  const ticker = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!allowedTickers.has(ticker as (typeof ASSET_REQUEST_CANDIDATES)[number]["ticker"])) throw new Error("This asset is not in the current request queue.");
  return ticker;
}

async function responsePayload(wallet?: string) {
  const db = await getDb();
  const [totals, walletVotes] = await Promise.all([
    db.select({ ticker: assetRequestVotes.ticker, votes: count() })
      .from(assetRequestVotes)
      .groupBy(assetRequestVotes.ticker)
      .orderBy(asc(assetRequestVotes.ticker)),
    wallet
      ? db.select({ ticker: assetRequestVotes.ticker }).from(assetRequestVotes).where(eq(assetRequestVotes.wallet, wallet))
      : Promise.resolve([]),
  ]);
  const counts = Object.fromEntries(totals.map((row) => [row.ticker, row.votes]));
  return {
    candidates: ASSET_REQUEST_CANDIDATES.map((asset) => ({ ...asset, votes: Number(counts[asset.ticker] ?? 0) })),
    walletVotes: walletVotes.map((row) => row.ticker),
    limit: ASSET_REQUEST_LIMIT,
    updatedAt: Date.now(),
  };
}

export async function GET(request: Request) {
  try {
    const rawWallet = new URL(request.url).searchParams.get("wallet");
    const wallet = rawWallet ? normalizeWallet(rawWallet) : undefined;
    return NextResponse.json(await responsePayload(wallet), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Market requests are unavailable." }, { status: 400, headers: { "cache-control": "no-store" } });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const wallet = normalizeWallet(body.wallet);
    const ticker = normalizeTicker(body.ticker);
    const timestamp = Number(body.timestamp);
    const signature = typeof body.signature === "string" ? body.signature : "";
    if (!Number.isInteger(timestamp) || Math.abs(Date.now() - timestamp) > 10 * 60_000) throw new Error("This request expired. Please sign again.");
    const recovered = verifyMessage(buildAssetVoteMessage(getAddress(wallet), ticker, timestamp), signature).toLowerCase();
    if (recovered !== wallet) throw new Error("The wallet signature could not be verified.");

    const db = await getDb();
    const existing = await db.select({ id: assetRequestVotes.id }).from(assetRequestVotes)
      .where(eq(assetRequestVotes.wallet, wallet));
    if (existing.length >= ASSET_REQUEST_LIMIT) throw new Error(`Each wallet can request up to ${ASSET_REQUEST_LIMIT} markets.`);
    try {
      await db.insert(assetRequestVotes).values({ id: crypto.randomUUID(), wallet, ticker, createdAt: new Date() });
    } catch {
      const current = await responsePayload(wallet);
      if (current.walletVotes.includes(ticker)) return NextResponse.json({ ok: true, ...current }, { headers: { "cache-control": "no-store" } });
      throw new Error("The market request could not be saved.");
    }
    return NextResponse.json({ ok: true, ...(await responsePayload(wallet)) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Market request failed." }, { status: 400, headers: { "cache-control": "no-store" } });
  }
}
