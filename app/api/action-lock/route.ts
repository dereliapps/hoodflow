import { NextResponse, type NextRequest } from "next/server";

import { prepareActionLockPassport } from "@/lib/action-lock";
import {
  acquireLocalAgentQuoteCapacity,
  AgentApiBodyTimeoutError,
  AgentApiBodyTooLargeError,
  readCappedJson,
  takeDurableAgentQuoteLimit,
} from "@/lib/agent-api-guard";
import {
  AgentQuoteUnavailableError,
  AgentQuoteValidationError,
  parseAgentQuoteRequest,
} from "@/lib/hoodflow-agent";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;

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
    return json({ error: "ActionLock request is too large." }, 413);
  }

  let rateLimit: Awaited<ReturnType<typeof takeDurableAgentQuoteLimit>>;
  try {
    rateLimit = await takeDurableAgentQuoteLimit(request, RATE_LIMIT, RATE_WINDOW_MS, "action-lock");
  } catch {
    return json({ error: "ActionLock capacity verification is temporarily unavailable.", retryable: true }, 503);
  }
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "ActionLock rate limit reached. Try again in one minute.", retryable: true }, {
      status: 429,
      headers: {
        ...CORS_HEADERS,
        "cache-control": "no-store, max-age=0",
        "retry-after": String(rateLimit.retryAfterSeconds),
      },
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

  const releaseCapacity = acquireLocalAgentQuoteCapacity();
  if (!releaseCapacity) {
    return NextResponse.json({ error: "The ActionLock verifier is busy. Try again shortly.", retryable: true }, {
      status: 429,
      headers: { ...CORS_HEADERS, "cache-control": "no-store, max-age=0", "retry-after": "3" },
    });
  }

  try {
    const quoteRequest = parseAgentQuoteRequest(body);
    return json(await prepareActionLockPassport(quoteRequest));
  } catch (error) {
    if (error instanceof AgentQuoteValidationError || error instanceof SyntaxError) {
      return json({ error: error instanceof Error ? error.message : "Invalid ActionLock request." }, 422);
    }
    if (error instanceof AgentQuoteUnavailableError) {
      return json({
        error: "A fresh executable route is temporarily unavailable.",
        retryable: true,
        safety: "No transaction was created and no wallet permission was requested.",
      }, 503);
    }
    return json({
      error: "ActionLock verification failed safely.",
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
