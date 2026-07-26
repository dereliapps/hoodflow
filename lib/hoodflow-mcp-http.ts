import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import {
  acquireLocalAgentQuoteCapacity,
  AgentApiBodyTimeoutError,
  AgentApiBodyTooLargeError,
  readCappedJson,
  takeDurableAgentQuoteLimit,
} from "@/lib/agent-api-guard";
import { canonicalSiteOrigin } from "@/lib/hoodflow-agent";
import { createHoodFlowMcpServer } from "@/lib/hoodflow-mcp";

export const HOODFLOW_MCP_BODY_LIMIT_BYTES = 16_384;
export const HOODFLOW_MCP_BODY_TIMEOUT_MS = 3_000;
export const HOODFLOW_MCP_RATE_WINDOW_MS = 60_000;
export const HOODFLOW_MCP_GENERAL_RATE_LIMIT = 120;
export const HOODFLOW_MCP_QUOTE_RATE_LIMIT = 30;
export const HOODFLOW_MCP_BASKET_RATE_LIMIT = 10;

type RateLimitResult = {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
};

type RateLimitFn = (
  request: Request,
  limit: number,
  windowMs: number,
  scope?: string,
  cost?: number,
) => Promise<RateLimitResult>;

export type HoodFlowMcpHttpDependencies = {
  createServer?: typeof createHoodFlowMcpServer;
  takeRateLimit?: RateLimitFn;
};

function rpcError(
  status: number,
  code: number,
  message: string,
  request: Request,
  extraHeaders?: HeadersInit,
) {
  return withPublicHeaders(new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: null,
    error: { code, message },
  }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  }), request);
}

function configuredAllowedOrigins() {
  const origins = new Set([canonicalSiteOrigin()]);
  for (const origin of (process.env.HOODFLOW_MCP_ALLOWED_ORIGINS ?? "").split(",")) {
    const trimmed = origin.trim();
    if (!trimmed) continue;
    try {
      origins.add(new URL(trimmed).origin);
    } catch {
      // Ignore malformed configuration and preserve the canonical allow-list.
    }
  }
  return origins;
}

function isAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  if (configuredAllowedOrigins().has(origin)) return true;

  if (process.env.NODE_ENV !== "production") {
    try {
      const parsed = new URL(origin);
      return (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
        && parsed.origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }
  return false;
}

function withPublicHeaders(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("x-content-type-options", "nosniff");
  headers.set("vary", "Origin, Accept");
  headers.append(
    "link",
    `<${canonicalSiteOrigin()}/openapi.json>; rel="service-desc"; type="application/json"`,
  );

  const origin = request.headers.get("origin");
  if (origin && isAllowedOrigin(request)) {
    headers.set("access-control-allow-origin", origin);
  }
  headers.set("access-control-allow-methods", "POST, GET, DELETE, OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "accept, content-type, mcp-protocol-version",
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function acceptsStreamableHttp(request: Request) {
  const accept = request.headers.get("accept")?.toLowerCase() ?? "";
  return accept.includes("application/json") && accept.includes("text/event-stream");
}

function isJsonContentType(request: Request) {
  return request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase() === "application/json";
}

function calledToolName(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const message = body as Record<string, unknown>;
  if (message.method !== "tools/call") return null;
  if (!message.params || typeof message.params !== "object" || Array.isArray(message.params)) {
    return null;
  }
  const name = (message.params as Record<string, unknown>).name;
  return typeof name === "string" ? name : null;
}

function basketQuoteCost(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return 1;
  const message = body as Record<string, unknown>;
  if (!message.params || typeof message.params !== "object" || Array.isArray(message.params)) {
    return 1;
  }
  const toolParams = message.params as Record<string, unknown>;
  if (!toolParams.arguments || typeof toolParams.arguments !== "object" || Array.isArray(toolParams.arguments)) {
    return 1;
  }
  const legs = (toolParams.arguments as Record<string, unknown>).legs;
  return Array.isArray(legs) ? Math.max(1, Math.min(6, legs.length)) : 1;
}

async function takeLimitOrRespond(
  request: Request,
  takeRateLimit: RateLimitFn,
  limit: number,
  scope: string,
  cost = 1,
) {
  let result: RateLimitResult;
  try {
    result = await takeRateLimit(request, limit, HOODFLOW_MCP_RATE_WINDOW_MS, scope, cost);
  } catch {
    return rpcError(
      503,
      -32001,
      "MCP capacity verification is temporarily unavailable.",
      request,
      { "retry-after": "5" },
    );
  }
  if (result.allowed) return null;
  return rpcError(
    429,
    -32002,
    "MCP rate limit reached. Try again shortly.",
    request,
    { "retry-after": String(result.retryAfterSeconds) },
  );
}

export async function handleHoodFlowMcpPost(
  request: Request,
  dependencies: HoodFlowMcpHttpDependencies = {},
) {
  if (!isAllowedOrigin(request)) {
    return rpcError(403, -32003, "Forbidden Origin.", request);
  }
  if (!acceptsStreamableHttp(request)) {
    return rpcError(
      406,
      -32600,
      "Accept must include application/json and text/event-stream.",
      request,
    );
  }
  if (!isJsonContentType(request)) {
    return rpcError(415, -32600, "Content-Type must be application/json.", request);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > HOODFLOW_MCP_BODY_LIMIT_BYTES) {
    return rpcError(413, -32600, "MCP request is too large.", request);
  }

  const takeRateLimit = dependencies.takeRateLimit ?? takeDurableAgentQuoteLimit;
  const generalLimit = await takeLimitOrRespond(
    request,
    takeRateLimit,
    HOODFLOW_MCP_GENERAL_RATE_LIMIT,
    "mcp",
  );
  if (generalLimit) return generalLimit;

  let body: unknown;
  try {
    body = await readCappedJson(
      request,
      HOODFLOW_MCP_BODY_LIMIT_BYTES,
      HOODFLOW_MCP_BODY_TIMEOUT_MS,
    );
  } catch (error) {
    if (error instanceof AgentApiBodyTooLargeError) {
      return rpcError(413, -32600, "MCP request is too large.", request);
    }
    if (error instanceof AgentApiBodyTimeoutError) {
      return rpcError(408, -32004, "MCP request body timed out.", request);
    }
    return rpcError(400, -32700, "Invalid JSON-RPC request.", request);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return rpcError(400, -32600, "A single JSON-RPC message is required.", request);
  }

  const toolName = calledToolName(body);
  if (toolName === "hoodflow_prepare_quote" || toolName === "hoodflow_prepare_basket") {
    const quoteLimit = await takeLimitOrRespond(
      request,
      takeRateLimit,
      HOODFLOW_MCP_QUOTE_RATE_LIMIT,
      "quote",
      toolName === "hoodflow_prepare_basket" ? basketQuoteCost(body) : 1,
    );
    if (quoteLimit) return quoteLimit;
  }
  if (toolName === "hoodflow_prepare_basket") {
    const basketLimit = await takeLimitOrRespond(
      request,
      takeRateLimit,
      HOODFLOW_MCP_BASKET_RATE_LIMIT,
      "basket",
    );
    if (basketLimit) return basketLimit;
  }

  const quoteCost = toolName === "hoodflow_prepare_basket"
    ? basketQuoteCost(body)
    : toolName === "hoodflow_prepare_quote"
      ? 1
      : 0;
  const releaseCapacity = quoteCost > 0 ? acquireLocalAgentQuoteCapacity(quoteCost) : null;
  if (quoteCost > 0 && !releaseCapacity) {
    return rpcError(
      429,
      -32005,
      "The quote verifier is busy. Try again shortly.",
      request,
      { "retry-after": "3" },
    );
  }

  let server: ReturnType<typeof createHoodFlowMcpServer> | undefined;
  try {
    server = (dependencies.createServer ?? createHoodFlowMcpServer)();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const sdkResponse = await transport.handleRequest(request, { parsedBody: body });
    const responseBody = await sdkResponse.arrayBuffer();
    return withPublicHeaders(new Response(responseBody, {
      status: sdkResponse.status,
      statusText: sdkResponse.statusText,
      headers: sdkResponse.headers,
    }), request);
  } catch {
    return rpcError(
      500,
      -32603,
      "The HoodFlow MCP request failed safely.",
      request,
    );
  } finally {
    if (server) {
      try {
        await server.close();
      } catch {
        // A failed close must not change the already-safe protocol response.
      }
    }
    releaseCapacity?.();
  }
}

export function handleHoodFlowMcpMethodNotAllowed(request: Request) {
  if (!isAllowedOrigin(request)) {
    return rpcError(403, -32003, "Forbidden Origin.", request);
  }
  return rpcError(
    405,
    -32000,
    "Method not allowed. This stateless endpoint accepts MCP messages over POST.",
    request,
    { allow: "POST, OPTIONS" },
  );
}

export function handleHoodFlowMcpOptions(request: Request) {
  if (!isAllowedOrigin(request)) {
    return rpcError(403, -32003, "Forbidden Origin.", request);
  }
  return withPublicHeaders(new Response(null, { status: 204 }), request);
}
