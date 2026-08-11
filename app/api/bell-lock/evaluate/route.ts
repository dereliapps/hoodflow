import { NextResponse, type NextRequest } from "next/server";

import { fetchOfficialActionLockEvidence } from "@/lib/action-lock";
import {
  acquireLocalAgentQuoteCapacity,
  AgentApiBodyTimeoutError,
  AgentApiBodyTooLargeError,
  readCappedJson,
  takeDurableAgentQuoteLimit,
} from "@/lib/agent-api-guard";
import {
  BellLockPreviewValidationError,
  buildBellLockPreviewEvaluation,
  parseBellLockPreviewRequest,
} from "@/lib/bell-lock-preview";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept",
  "cache-control": "no-store, max-age=0",
};

const MAX_REQUEST_BYTES = 4_096;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
const OFFICIAL_SOURCE_TIMEOUT_MS = 6_000;

function json(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(payload, {
    status,
    headers: { ...CORS_HEADERS, ...headers },
  });
}

function closedError(error: string, status: number, retryable = false) {
  return json({
    error,
    ...(retryable ? { retryable: true } : {}),
    safety: "No transaction, signature, wallet permission, or execution handoff was created.",
    handoffAllowed: false,
    handoff: null,
    executionHandoff: null,
  }, status);
}

export async function POST(request: NextRequest) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return closedError("Content-Type must be application/json.", 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return closedError("BellLock request is too large.", 413);
  }

  let body: unknown;
  try {
    body = await readCappedJson(request, MAX_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof AgentApiBodyTooLargeError) {
      return closedError("BellLock request is too large.", 413);
    }
    if (error instanceof AgentApiBodyTimeoutError) {
      return closedError("BellLock request body timed out.", 408, true);
    }
    return closedError(error instanceof Error ? error.message : "Invalid JSON request.", 422);
  }

  let policy;
  try {
    policy = parseBellLockPreviewRequest(body);
  } catch (error) {
    if (error instanceof BellLockPreviewValidationError || error instanceof SyntaxError) {
      return closedError(error instanceof Error ? error.message : "Invalid BellLock policy.", 422);
    }
    return closedError("BellLock policy validation failed safely.", 422);
  }

  let rateLimit: Awaited<ReturnType<typeof takeDurableAgentQuoteLimit>>;
  try {
    rateLimit = await takeDurableAgentQuoteLimit(
      request,
      RATE_LIMIT,
      RATE_WINDOW_MS,
      "bell-lock-preview",
    );
  } catch {
    return closedError("BellLock capacity verification is temporarily unavailable.", 503, true);
  }
  if (!rateLimit.allowed) {
    return json({
      error: "BellLock rate limit reached. Try again in one minute.",
      retryable: true,
      safety: "No transaction, signature, wallet permission, or execution handoff was created.",
      handoffAllowed: false,
      handoff: null,
      executionHandoff: null,
    }, 429, { "retry-after": String(rateLimit.retryAfterSeconds) });
  }

  const releaseCapacity = acquireLocalAgentQuoteCapacity();
  if (!releaseCapacity) {
    return json({
      error: "The BellLock preview collector is busy. Try again shortly.",
      retryable: true,
      safety: "No transaction, signature, wallet permission, or execution handoff was created.",
      handoffAllowed: false,
      handoff: null,
      executionHandoff: null,
    }, 429, { "retry-after": "3" });
  }

  try {
    let evidence = null;
    try {
      evidence = await fetchOfficialActionLockEvidence(policy.asset, {
        timeoutMs: OFFICIAL_SOURCE_TIMEOUT_MS,
      });
    } catch {
      // The refusal receipt below records source unavailability without trusting
      // or echoing any client-supplied substitute evidence.
    }
    const result = await buildBellLockPreviewEvaluation(policy, evidence);
    return json(
      result.state === "unavailable"
        ? {
            ...result,
            error: "Official BellLock preview observations are temporarily unavailable.",
            retryable: true,
          }
        : result,
      result.state === "unavailable" ? 503 : 200,
    );
  } catch {
    return closedError("BellLock preview evaluation failed safely.", 503, true);
  } finally {
    releaseCapacity();
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
