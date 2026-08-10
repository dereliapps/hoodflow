import { Contract, JsonRpcProvider } from "ethers";
import { NextResponse, type NextRequest } from "next/server";

import {
  acquireLocalAgentQuoteCapacity,
  takeDurableAgentQuoteLimit,
} from "@/lib/agent-api-guard";
import { createFillProof } from "@/lib/fill-proof";
import {
  ROBINHOOD_MAINNET,
  ROBINHOOD_TOKENS,
  SCALED_UI_AMOUNT_ABI,
} from "@/lib/hoodflow-mainnet";
import { verifyHoodFlowRouterSettlement } from "@/lib/referral-qualification";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;
const RPC_TIMEOUT_MS = 6_000;

class FillProofNotFoundError extends Error {}

function json(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(payload, {
    status,
    headers: {
      ...CORS_HEADERS,
      "cache-control": status === 200
        ? "public, max-age=60, s-maxage=86400, stale-while-revalidate=604800"
        : "no-store, max-age=0",
      ...headers,
    },
  });
}

function configuredRpcUrls() {
  return [
    process.env.ROBINHOOD_MAINNET_RPC_URL_PRIMARY,
    process.env.ROBINHOOD_MAINNET_RPC_URL_SECONDARY,
    ...(process.env.ROBINHOOD_RPC_URLS ?? "").split(","),
    process.env.ROBINHOOD_RPC_URL,
    ...ROBINHOOD_MAINNET.rpcUrls,
  ].map((value) => value?.trim() ?? "").filter((value, index, values) => Boolean(value) && values.indexOf(value) === index);
}

async function withTimeout<T>(promise: Promise<T>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("FillProof RPC timed out.")), RPC_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function reconstructFromRpc(rpcUrl: string, txHash: string) {
  const provider = new JsonRpcProvider(rpcUrl, ROBINHOOD_MAINNET.chainIdNumber, { staticNetwork: true });
  try {
    const rpcChainId = await withTimeout(provider.send("eth_chainId", []));
    if (typeof rpcChainId !== "string" || Number(BigInt(rpcChainId)) !== ROBINHOOD_MAINNET.chainIdNumber) {
      throw new Error("FillProof RPC chain mismatch.");
    }
    const [transaction, receipt] = await withTimeout(Promise.all([
      provider.getTransaction(txHash),
      provider.getTransactionReceipt(txHash),
    ]));
    if (!transaction || !receipt) throw new FillProofNotFoundError("The transaction is not confirmed on Robinhood Chain.");
    const [block, latestBlockNumber] = await withTimeout(Promise.all([
      provider.getBlock(receipt.blockHash),
      provider.getBlockNumber(),
    ]));
    if (!block || !block.hash || block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
      throw new Error("The receipt block does not match the canonical RPC block.");
    }
    const confirmations = Math.max(1, latestBlockNumber - receipt.blockNumber + 1);

    const settlement = verifyHoodFlowRouterSettlement({
      transactionData: transaction.data,
      wallet: transaction.from,
      logs: receipt.logs,
      requireExactPermitAmount: true,
    });
    let uiMultiplierRaw: bigint | null = null;
    try {
      const token = new Contract(ROBINHOOD_TOKENS[settlement.ticker], SCALED_UI_AMOUNT_ABI, provider);
      uiMultiplierRaw = BigInt(await withTimeout(token.uiMultiplier({ blockTag: receipt.blockNumber })));
    } catch {
      // Raw settlement remains fully verifiable if a historical ERC-8056 read is unavailable.
    }

    const proof = createFillProof({
      chainId: ROBINHOOD_MAINNET.chainIdNumber,
      transaction: {
        hash: transaction.hash,
        from: transaction.from,
        to: transaction.to,
        data: transaction.data,
      },
      receipt: {
        status: receipt.status,
        hash: receipt.hash,
        from: receipt.from,
        to: receipt.to,
        blockHash: receipt.blockHash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
        gasPrice: receipt.gasPrice,
        logs: receipt.logs,
      },
      blockTimestamp: block.timestamp,
      uiMultiplierRaw,
    });
    return { proof, confirmations };
  } finally {
    provider.destroy();
  }
}

export async function GET(request: NextRequest) {
  const txHash = new URL(request.url).searchParams.get("txHash")?.trim() ?? "";
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return json({ error: "A valid Robinhood Chain transaction hash is required." }, 422);
  }

  let rateLimit: Awaited<ReturnType<typeof takeDurableAgentQuoteLimit>>;
  try {
    rateLimit = await takeDurableAgentQuoteLimit(request, RATE_LIMIT, RATE_WINDOW_MS, "fill-proof");
  } catch {
    return json({ error: "FillProof capacity verification is temporarily unavailable.", retryable: true }, 503);
  }
  if (!rateLimit.allowed) {
    return json({ error: "FillProof rate limit reached. Try again in one minute.", retryable: true }, 429, {
      "retry-after": String(rateLimit.retryAfterSeconds),
    });
  }

  const releaseCapacity = acquireLocalAgentQuoteCapacity();
  if (!releaseCapacity) return json({ error: "The FillProof verifier is busy. Try again shortly.", retryable: true }, 429, { "retry-after": "3" });

  try {
    let lastError: unknown;
    for (const rpcUrl of configuredRpcUrls().slice(0, 3)) {
      try {
        const { proof, confirmations } = await reconstructFromRpc(rpcUrl, txHash.toLowerCase());
        return json({ proof }, 200, {
          etag: `W/\"${proof.integrity.digest}\"`,
          "cache-control": confirmations >= 12
            ? "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800"
            : "no-store, max-age=0",
        });
      } catch (error) {
        lastError = error;
        if (error instanceof FillProofNotFoundError) continue;
      }
    }
    if (lastError instanceof FillProofNotFoundError) return json({ error: lastError.message }, 404);
    if (lastError instanceof Error && /transaction|receipt|router|route|permit|settled|output|sender|hash/i.test(lastError.message)) {
      return json({ error: "This transaction is not a verifiable reviewed HoodFlow Stock Token fill." }, 422);
    }
    return json({ error: "Mainnet verification is temporarily unavailable.", retryable: true }, 503);
  } finally {
    releaseCapacity();
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
