import { NextResponse, type NextRequest } from "next/server";

import {
  AgentBasketUnavailableError,
  AgentBasketValidationError,
  parseAgentBasketRequest,
  prepareAgentBasket,
} from "@/lib/hoodflow-basket";
import {
  acquireLocalAgentQuoteCapacity,
  AgentApiBodyTimeoutError,
  AgentApiBodyTooLargeError,
  readCappedJson,
  takeDurableAgentQuoteLimit,
} from "@/lib/agent-api-guard";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;
const MAX_REQUEST_BYTES = 4_096;

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { ...CORS_HEADERS, "cache-control": "no-store, max-age=0" },
  });
}

export async function POST(request: NextRequest) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "Content-Type must be application/json." }, 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return json({ error: "Basket request is too large." }, 413);
  }

  let body: unknown;
  try {
    body = await readCappedJson(request, MAX_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof AgentApiBodyTooLargeError) return json({ error: "Basket request is too large." }, 413);
    if (error instanceof AgentApiBodyTimeoutError) return json({ error: error.message, retryable: true }, 408);
    return json({ error: error instanceof Error ? error.message : "Invalid JSON request." }, 422);
  }

  let basketRequest;
  try {
    basketRequest = parseAgentBasketRequest(body);
  } catch (error) {
    if (error instanceof AgentBasketValidationError || error instanceof SyntaxError) {
      return json({ error: error instanceof Error ? error.message : "Invalid basket request." }, 422);
    }
    return json({ error: "Basket request validation failed safely." }, 422);
  }

  let rateLimit: Awaited<ReturnType<typeof takeDurableAgentQuoteLimit>>;
  try {
    rateLimit = await takeDurableAgentQuoteLimit(
      request,
      RATE_LIMIT,
      RATE_WINDOW_MS,
      "quote",
      basketRequest.legs.length,
    );
  } catch {
    return json({ error: "Quote capacity verification is temporarily unavailable.", retryable: true }, 503);
  }
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Quote rate limit reached. Try again in one minute.", retryable: true }, {
      status: 429,
      headers: {
        ...CORS_HEADERS,
        "cache-control": "no-store, max-age=0",
        "retry-after": String(rateLimit.retryAfterSeconds),
      },
    });
  }

  const releaseCapacity = acquireLocalAgentQuoteCapacity(basketRequest.legs.length);
  if (!releaseCapacity) {
    return NextResponse.json({ error: "The quote verifier is busy. Try again shortly.", retryable: true }, {
      status: 429,
      headers: { ...CORS_HEADERS, "cache-control": "no-store, max-age=0", "retry-after": "3" },
    });
  }

  try {
    return json(await prepareAgentBasket(basketRequest));
  } catch (error) {
    if (error instanceof AgentBasketValidationError) {
      return json({ error: error.message }, 422);
    }
    if (error instanceof AgentBasketUnavailableError) {
      return json({
        error: "One or more basket legs could not pass a fresh safety preflight.",
        retryable: true,
        safety: "No transaction was created and no wallet permission was requested.",
      }, 503);
    }
    return json({
      error: "Basket verification failed safely.",
      retryable: true,
      safety: "No transaction was created and no wallet permission was requested.",
    }, 503);
  } finally {
    releaseCapacity();
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
