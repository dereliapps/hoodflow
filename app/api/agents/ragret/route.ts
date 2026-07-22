import { NextResponse, type NextRequest } from "next/server";

import {
  AgentApiBodyTimeoutError,
  AgentApiBodyTooLargeError,
  readCappedJson,
  takeDurableAgentQuoteLimit,
} from "@/lib/agent-api-guard";
import {
  RagretDataUnavailableError,
  RagretValidationError,
  calculateRagretScenario,
  parseRagretScenarioRequest,
} from "@/lib/ragret";
import { resolveRagretScenarioSources } from "@/lib/ragret-sources";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 18;
const MAX_LOCAL_IN_FLIGHT = 4;
const MAX_BODY_BYTES = 4_096;
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
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: "RAGRET scenario request is too large." }, 413);
  }

  let rateLimit: Awaited<ReturnType<typeof takeDurableAgentQuoteLimit>>;
  try {
    rateLimit = await takeDurableAgentQuoteLimit(request, RATE_LIMIT, RATE_WINDOW_MS, "ragret");
  } catch {
    return json({
      error: "RAGRET capacity verification is temporarily unavailable.",
      retryable: true,
      safety: "No wallet activity was inspected and no transaction was created.",
    }, 503);
  }
  if (!rateLimit.allowed) {
    return NextResponse.json({
      error: "RAGRET rate limit reached. Try again in one minute.",
      retryable: true,
    }, {
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
    body = await readCappedJson(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof AgentApiBodyTooLargeError) return json({ error: "RAGRET scenario request is too large." }, 413);
    if (error instanceof AgentApiBodyTimeoutError) return json({ error: error.message, retryable: true }, 408);
    return json({ error: error instanceof Error ? error.message : "Invalid JSON request." }, 422);
  }

  if (inFlight >= MAX_LOCAL_IN_FLIGHT) {
    return NextResponse.json({
      error: "The RAGRET source reader is busy. Try again shortly.",
      retryable: true,
    }, {
      status: 429,
      headers: { ...CORS_HEADERS, "cache-control": "no-store, max-age=0", "retry-after": "3" },
    });
  }

  inFlight += 1;
  try {
    const scenarioRequest = parseRagretScenarioRequest(body);
    const sources = await resolveRagretScenarioSources(scenarioRequest, {
      origin: new URL(request.url).origin,
      signal: request.signal,
    });
    const receipt = calculateRagretScenario({ request: scenarioRequest, ...sources });
    return json({
      ...receipt,
      sources: [{
        type: "chainlink-window",
        start: sources.stockStart.sourceId,
        end: sources.stockEnd.sourceId,
      }, {
        type: "community-market-24h",
        address: sources.community.address,
        marketUrl: sources.community.pairUrl,
      }],
      executionHandoffs: {
        stock: `/?asset=${encodeURIComponent(scenarioRequest.stock)}`,
        community: `/crypto/${sources.community.address}`,
      },
    });
  } catch (error) {
    if (error instanceof RagretValidationError || error instanceof SyntaxError) {
      return json({ error: error.message }, 422);
    }
    if (error instanceof RagretDataUnavailableError) {
      return json({
        error: error.message,
        retryable: true,
        safety: "No wallet activity was inspected and no transaction was created.",
      }, 503);
    }
    return json({
      error: "RAGRET failed safely while reading market sources.",
      retryable: true,
      safety: "No wallet activity was inspected and no transaction was created.",
    }, 503);
  } finally {
    inFlight = Math.max(0, inFlight - 1);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
