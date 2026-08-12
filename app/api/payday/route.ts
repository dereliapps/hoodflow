import { NextResponse, type NextRequest } from "next/server";

import {
  acquireLocalAgentQuoteCapacity,
  takeDurableAgentQuoteLimit,
} from "@/lib/agent-api-guard";
import {
  getPaydayData,
  normalizePaydayTicker,
  PaydayValidationError,
} from "@/lib/flow-rights";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "accept",
  "cache-control": "no-store, max-age=0",
};
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

function json(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(payload, {
    status,
    headers: { ...CORS_HEADERS, ...headers },
  });
}

function closedError(
  error: string,
  status: number,
  retryable = false,
  headers: Record<string, string> = {},
) {
  return json({
    ok: false,
    error,
    retryable,
    capabilities: {
      readsOfficialSources: false,
      signs: false,
      submitsTransaction: false,
      requestsWalletPermission: false,
      createsClaimToken: false,
      controlsFunds: false,
      createsEntitlement: false,
    },
    handoffAllowed: false,
    handoff: null,
    executionHandoff: null,
    safety: "No transaction, wallet permission, signature, entitlement, or execution handoff was created.",
  }, status, headers);
}

function retryHeaders(seconds: number) {
  return { "retry-after": String(seconds) };
}

export async function GET(request: NextRequest) {
  const keys = [...request.nextUrl.searchParams.keys()];
  if (keys.some((key) => key !== "asset") || keys.filter((key) => key === "asset").length !== 1) {
    return closedError("Only one asset query parameter is accepted. Client evidence is never accepted.", 422);
  }

  let asset: string;
  try {
    asset = normalizePaydayTicker(request.nextUrl.searchParams.get("asset"));
  } catch (error) {
    return closedError(
      error instanceof PaydayValidationError ? error.message : "Invalid Payday asset.",
      422,
    );
  }

  let rateLimit: Awaited<ReturnType<typeof takeDurableAgentQuoteLimit>>;
  try {
    rateLimit = await takeDurableAgentQuoteLimit(
      request,
      RATE_LIMIT,
      RATE_WINDOW_MS,
      "payday-preview",
    );
  } catch {
    return closedError("Payday capacity verification is temporarily unavailable.", 503, true);
  }
  if (!rateLimit.allowed) {
    return closedError(
      "Payday preview rate limit reached. Try again in one minute.",
      429,
      true,
      retryHeaders(rateLimit.retryAfterSeconds),
    );
  }

  const releaseCapacity = acquireLocalAgentQuoteCapacity();
  if (!releaseCapacity) {
    return closedError(
      "The Payday evidence collector is busy. Try again shortly.",
      429,
      true,
      retryHeaders(3),
    );
  }

  try {
    const data = await getPaydayData(asset);
    return json({ ok: true, data });
  } catch {
    return closedError("Payday preview failed safely.", 503, true);
  } finally {
    releaseCapacity();
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
