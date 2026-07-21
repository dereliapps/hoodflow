import { NextResponse, type NextRequest } from "next/server";

import {
  AgentQuoteUnavailableError,
  AgentQuoteValidationError,
  parseAgentQuoteRequest,
  prepareAgentQuote,
} from "@/lib/hoodflow-agent";
import {
  AgentApiBodyTooLargeError,
  AgentApiBodyTimeoutError,
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
const MAX_LOCAL_IN_FLIGHT = 6;
let inFlight = 0;

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
  if (Number.isFinite(contentLength) && contentLength > 4_096) {
    return json({ error: "Quote request is too large." }, 413);
  }
  let rateLimit: Awaited<ReturnType<typeof takeDurableAgentQuoteLimit>>;
  try {
    rateLimit = await takeDurableAgentQuoteLimit(request, RATE_LIMIT, RATE_WINDOW_MS);
  } catch {
    return json({ error: "Quote capacity verification is temporarily unavailable.", retryable: true }, 503);
  }
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Quote rate limit reached. Try again in one minute.", retryable: true }, {
      status: 429,
      headers: { ...CORS_HEADERS, "cache-control": "no-store, max-age=0", "retry-after": String(rateLimit.retryAfterSeconds) },
    });
  }
  let body: unknown;
  try {
    body = await readCappedJson(request);
  } catch (error) {
    if (error instanceof AgentApiBodyTooLargeError) return json({ error: error.message }, 413);
    if (error instanceof AgentApiBodyTimeoutError) return json({ error: error.message, retryable: true }, 408);
    return json({ error: error instanceof Error ? error.message : "Invalid JSON request." }, 422);
  }

  if (inFlight >= MAX_LOCAL_IN_FLIGHT) {
    return NextResponse.json({ error: "The quote verifier is busy. Try again shortly.", retryable: true }, {
      status: 429,
      headers: { ...CORS_HEADERS, "cache-control": "no-store, max-age=0", "retry-after": "3" },
    });
  }

  inFlight += 1;
  try {
    const quoteRequest = parseAgentQuoteRequest(body);
    const quote = await prepareAgentQuote(quoteRequest);
    return json(quote);
  } catch (error) {
    if (error instanceof AgentQuoteValidationError || error instanceof SyntaxError) {
      return json({ error: error instanceof Error ? error.message : "Invalid quote request." }, 422);
    }
    if (error instanceof AgentQuoteUnavailableError) {
      return json({
        error: "A fresh executable route is temporarily unavailable.",
        retryable: true,
        safety: "No transaction was created and no wallet permission was requested.",
      }, 503);
    }
    return json({
      error: "Quote verification failed safely.",
      retryable: true,
      safety: "No transaction was created and no wallet permission was requested.",
    }, 503);
  } finally {
    inFlight = Math.max(0, inFlight - 1);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
