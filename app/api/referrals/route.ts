import { NextResponse } from "next/server";
import { and, asc, count, desc, eq, gt, sql } from "drizzle-orm";
import { getAddress, JsonRpcProvider, verifyMessage } from "ethers";
import { getDb } from "@/db";
import { referralAttributions, referralClaims, referralProfiles } from "@/db/schema";
import { ROBINHOOD_MAINNET, UNIVERSAL_ROUTER_ADDRESS } from "@/lib/hoodflow-mainnet";
import { verifyEligibleReferralTrade } from "@/lib/referral-qualification";
import { buildReferralMessage, INVITEE_POINTS, REFERRER_POINTS, SEASON_REFERRAL_CAP } from "@/lib/referrals";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function normalizeWallet(value: unknown) {
  if (typeof value !== "string") throw new Error("A valid wallet is required.");
  return getAddress(value).toLowerCase();
}

function normalizeCode(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) : "";
}

function createCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function errorResponse(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Referral request failed.";
  return NextResponse.json({ ok: false, error: message }, { status, headers: { "cache-control": "no-store" } });
}

async function profilePayload(wallet: string) {
  const db = await getDb();
  const [profiles, pendingRows, qualifiedRows, attributionRows] = await Promise.all([
    db.select().from(referralProfiles).where(eq(referralProfiles.wallet, wallet)).limit(1),
    db.select({ total: count() }).from(referralAttributions).where(and(eq(referralAttributions.referrerWallet, wallet), eq(referralAttributions.status, "pending"))),
    db.select({ total: count() }).from(referralAttributions).where(and(eq(referralAttributions.referrerWallet, wallet), eq(referralAttributions.status, "qualified"))),
    db.select().from(referralAttributions).where(eq(referralAttributions.inviteeWallet, wallet)).limit(1),
  ]);
  const profile = profiles[0];
  if (!profile) return { profile: null, pending: 0, qualified: 0, attribution: null };
  const higherScores = await db.select({ total: count() }).from(referralProfiles).where(gt(referralProfiles.points, profile.points));
  return {
    profile: { wallet: profile.wallet, code: profile.code, points: profile.points, rank: (higherScores[0]?.total ?? 0) + 1, createdAt: profile.createdAt.getTime() },
    pending: pendingRows[0]?.total ?? 0,
    qualified: qualifiedRows[0]?.total ?? 0,
    attribution: attributionRows[0] ? {
      referralCode: attributionRows[0].referralCode,
      status: attributionRows[0].status,
    } : null,
  };
}

async function leaderboardPayload() {
  const db = await getDb();
  const [rows, totals] = await Promise.all([
    db.select({
      wallet: referralProfiles.wallet,
      code: referralProfiles.code,
      points: referralProfiles.points,
      qualified: count(referralClaims.txHash),
    })
      .from(referralProfiles)
      .leftJoin(referralClaims, eq(referralClaims.referrerWallet, referralProfiles.wallet))
      .groupBy(referralProfiles.wallet, referralProfiles.code, referralProfiles.points, referralProfiles.createdAt)
      .orderBy(desc(referralProfiles.points), asc(referralProfiles.createdAt))
      .limit(50),
    db.select({ total: count() }).from(referralProfiles),
  ]);
  let rank = 0;
  let previousPoints: number | null = null;
  return {
    entries: rows.map((row, index) => {
      if (previousPoints === null || row.points !== previousPoints) rank = index + 1;
      previousPoints = row.points;
      return {
      rank,
      wallet: `${row.wallet.slice(0, 6)}…${row.wallet.slice(-4)}`,
      code: row.code,
      points: row.points,
      qualified: row.qualified,
    }; }),
    participants: totals[0]?.total ?? 0,
    updatedAt: Date.now(),
  };
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("leaderboard") === "1") {
      return NextResponse.json(await leaderboardPayload(), { headers: { "cache-control": "no-store" } });
    }
    const wallet = normalizeWallet(params.get("wallet"));
    return NextResponse.json(await profilePayload(wallet), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action;
    const wallet = normalizeWallet(body.wallet);
    const db = await getDb();

    if (action === "register") {
      const timestamp = Number(body.timestamp);
      const referralCode = normalizeCode(body.referralCode);
      const signature = typeof body.signature === "string" ? body.signature : "";
      if (!Number.isInteger(timestamp) || Math.abs(Date.now() - timestamp) > 10 * 60_000) throw new Error("The activation request expired. Please sign again.");
      const recovered = verifyMessage(buildReferralMessage(getAddress(wallet), timestamp, referralCode), signature).toLowerCase();
      if (recovered !== wallet) throw new Error("The wallet signature could not be verified.");

      const existing = await db.select().from(referralProfiles).where(eq(referralProfiles.wallet, wallet)).limit(1);
      if (!existing[0]) {
        let inserted = false;
        for (let attempt = 0; attempt < 5 && !inserted; attempt += 1) {
          try {
            const now = new Date();
            await db.insert(referralProfiles).values({ wallet, code: createCode(), points: 0, createdAt: now, updatedAt: now });
            inserted = true;
          } catch (error) {
            const raced = await db.select().from(referralProfiles).where(eq(referralProfiles.wallet, wallet)).limit(1);
            if (raced[0]) inserted = true;
            else if (attempt === 4) throw error;
          }
        }
      }

      if (referralCode) {
        const referrers = await db.select().from(referralProfiles).where(eq(referralProfiles.code, referralCode)).limit(1);
        const referrer = referrers[0];
        if (!referrer) throw new Error("This referral code does not exist.");
        if (referrer.wallet === wallet) throw new Error("You cannot use your own referral code.");
        const current = await db.select().from(referralAttributions).where(eq(referralAttributions.inviteeWallet, wallet)).limit(1);
        if (!current[0]) {
          await db.insert(referralAttributions).values({
            inviteeWallet: wallet,
            referrerWallet: referrer.wallet,
            referralCode,
            status: "pending",
            createdAt: new Date(),
          });
        }
      }
      return NextResponse.json({ ok: true, ...(await profilePayload(wallet)) }, { headers: { "cache-control": "no-store" } });
    }

    if (action === "qualify") {
      const txHash = typeof body.txHash === "string" && /^0x[a-fA-F0-9]{64}$/.test(body.txHash) ? body.txHash.toLowerCase() : "";
      if (!txHash) throw new Error("A valid mainnet transaction hash is required.");
      const attributionRows = await db.select().from(referralAttributions).where(eq(referralAttributions.inviteeWallet, wallet)).limit(1);
      const attribution = attributionRows[0];
      if (!attribution || attribution.status !== "pending") return NextResponse.json({ ok: true, qualified: false }, { headers: { "cache-control": "no-store" } });
      const previousClaim = await db.select().from(referralClaims).where(eq(referralClaims.txHash, txHash)).limit(1);
      if (previousClaim[0]) return NextResponse.json({ ok: true, qualified: false }, { headers: { "cache-control": "no-store" } });

      const provider = new JsonRpcProvider(ROBINHOOD_MAINNET.rpcUrls[0], ROBINHOOD_MAINNET.chainIdNumber, { staticNetwork: true });
      const [receipt, transaction] = await Promise.all([provider.getTransactionReceipt(txHash), provider.getTransaction(txHash)]).finally(() => provider.destroy());
      if (!receipt || receipt.status !== 1 || !transaction) throw new Error("The qualifying transaction is not confirmed on Robinhood Chain.");
      if (transaction.from.toLowerCase() !== wallet || transaction.to?.toLowerCase() !== UNIVERSAL_ROUTER_ADDRESS.toLowerCase()) {
        throw new Error("This transaction is not an eligible HoodFlow router trade from the connected wallet.");
      }
      try {
        verifyEligibleReferralTrade({ transactionData: transaction.data, wallet, logs: receipt.logs });
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : "The transaction does not prove a completed eligible HoodFlow swap.");
      }
      const blockProvider = new JsonRpcProvider(ROBINHOOD_MAINNET.rpcUrls[0], ROBINHOOD_MAINNET.chainIdNumber, { staticNetwork: true });
      const block = await blockProvider.getBlock(receipt.blockNumber).finally(() => blockProvider.destroy());
      if (!block || block.timestamp * 1_000 < attribution.createdAt.getTime()) throw new Error("The trade predates this referral activation.");

      const qualifiedRows = await db.select({ total: count() }).from(referralClaims).where(eq(referralClaims.referrerWallet, attribution.referrerWallet));
      const referrerAward = (qualifiedRows[0]?.total ?? 0) < SEASON_REFERRAL_CAP ? REFERRER_POINTS : 0;
      const now = new Date();
      await db.batch([
        db.insert(referralClaims).values({ txHash, inviteeWallet: wallet, referrerWallet: attribution.referrerWallet, inviteePoints: INVITEE_POINTS, referrerPoints: referrerAward, createdAt: now }),
        db.update(referralAttributions).set({ status: "qualified", qualifiedAt: now }).where(eq(referralAttributions.inviteeWallet, wallet)),
        db.update(referralProfiles).set({ points: sql`${referralProfiles.points} + ${INVITEE_POINTS}`, updatedAt: now }).where(eq(referralProfiles.wallet, wallet)),
        db.update(referralProfiles).set({ points: sql`${referralProfiles.points} + ${referrerAward}`, updatedAt: now }).where(eq(referralProfiles.wallet, attribution.referrerWallet)),
      ]);
      return NextResponse.json({ ok: true, qualified: true, pointsAwarded: INVITEE_POINTS }, { headers: { "cache-control": "no-store" } });
    }

    throw new Error("Unknown referral action.");
  } catch (error) {
    return errorResponse(error);
  }
}
