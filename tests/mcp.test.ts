import assert from "node:assert/strict";
import test from "node:test";

import {
  handleHoodFlowMcpMethodNotAllowed,
  handleHoodFlowMcpOptions,
  handleHoodFlowMcpPost,
  HOODFLOW_MCP_BODY_LIMIT_BYTES,
} from "../lib/hoodflow-mcp-http.js";
import {
  createHoodFlowMcpServer,
  HOODFLOW_MCP_RESOURCE_URI,
  HOODFLOW_MCP_TOOL_NAMES,
} from "../lib/hoodflow-mcp.js";

const DEFAULT_HEADERS = {
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
  "mcp-protocol-version": "2025-11-25",
  origin: "https://hoodflow.app",
};

const allowRateLimit = async () => ({
  allowed: true,
  count: 1,
  retryAfterSeconds: 60,
});

const quoteFixture = {
  quoteId: "hf-aapl-test",
  status: "indicative-preflight",
  chain: { id: 4663, name: "Robinhood Chain" },
  asset: "AAPL",
  side: "buy",
  pay: {
    ticker: "USDG",
    address: "0x0000000000000000000000000000000000000001",
    amount: "10.0",
    rawAmount: "10000000",
    decimals: 6,
  },
  receive: {
    ticker: "AAPL",
    address: "0x0000000000000000000000000000000000000002",
    estimatedAmount: "0.05",
    indicativeMinimumAmount: "0.04975",
    rawEstimatedAmount: "50000000000000000",
    rawIndicativeMinimumAmount: "49750000000000000",
    decimals: 18,
  },
  route: {
    protocol: "Uniswap V4",
    fee: 3000,
    feeBps: 30,
    tickSpacing: 60,
    gasEstimate: "150000",
  },
  protection: {
    slippageBps: 50,
    dataExpiresAt: "2026-07-26T12:01:15.000Z",
    executionBinding: "none-requote-required",
  },
  reference: {
    status: "live",
    price: 200,
    impliedDexPrice: 200,
    deviationBps: 0,
    maxDeviationBps: 300,
    updatedAt: 1_785_066_000,
    heartbeat: 300,
    oraclePaused: false,
  },
  custody: "self-custody",
  requiresUserSignature: true,
  executionHandoff: {
    marketPath: "/?asset=AAPL&agentSide=buy&agentAmount=10&agentSlippageBps=50",
    marketUrl: "https://hoodflow.app/?asset=AAPL&agentSide=buy&agentAmount=10&agentSlippageBps=50",
    intent: { asset: "AAPL", side: "buy", amount: "10", slippageBps: 50 },
    instruction: "Request a fresh quote and confirm in the user's wallet.",
  },
  quotedAt: "2026-07-26T12:00:00.000Z",
};

const basketFixture = {
  basketId: "hfb-test",
  status: "indicative-preflight",
  progress: {
    requestedLegs: 2,
    preparedLegs: 2,
    rejectedLegs: 0,
    completeness: "full",
  },
  budget: {
    ticker: "USDG",
    decimals: 6,
    requestedAmount: "100.0",
    rawRequestedAmount: "100000000",
    plannedAmount: "100.0",
    rawPlannedAmount: "100000000",
    unallocatedAmount: "0.0",
    rawUnallocatedAmount: "0",
  },
  legs: [
    {
      index: 0,
      asset: "AAPL",
      weightBps: 5000,
      allocation: { amount: "50.0", rawAmount: "50000000" },
      quote: quoteFixture,
    },
    {
      index: 1,
      asset: "NVDA",
      weightBps: 5000,
      allocation: { amount: "50.0", rawAmount: "50000000" },
      quote: { ...quoteFixture, quoteId: "hf-nvda-test", asset: "NVDA" },
    },
  ],
  rejectedLegs: [],
  protection: {
    slippageBps: 50,
    failurePolicy: "all-or-nothing",
    dataExpiresAt: "2026-07-26T12:01:15.000Z",
    executionBinding: "none-requote-required",
  },
  custody: "self-custody",
  requiresUserSignature: true,
  execution: {
    atomic: false,
    submission: "none",
    minimumTradeConfirmations: 2,
    instruction: "Confirm each trade leg separately.",
  },
  preparedAt: "2026-07-26T12:00:00.000Z",
};

const createTestServer = () => createHoodFlowMcpServer({
  prepareQuote: (async () => quoteFixture as never),
  prepareBasket: (async () => basketFixture as never),
});

function mcpRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://hoodflow.app/api/mcp", {
    method: "POST",
    headers: { ...DEFAULT_HEADERS, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function post(body: unknown, headers: Record<string, string> = {}) {
  return handleHoodFlowMcpPost(mcpRequest(body, headers), {
    createServer: createTestServer,
    takeRateLimit: allowRateLimit,
  });
}

test("initializes over stateless JSON Streamable HTTP without a session id", async () => {
  const response = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "hoodflow-test", version: "1.0.0" },
    },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
  assert.equal(response.headers.get("mcp-session-id"), null);
  const payload = await response.json() as {
    result: { protocolVersion: string; serverInfo: { name: string } };
  };
  assert.equal(payload.result.protocolVersion, "2025-11-25");
  assert.equal(payload.result.serverInfo.name, "hoodflow-preflight");
});

test("lists exactly the public read/preflight tools with safe annotations", async () => {
  const response = await post({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    result: {
      tools: Array<{
        name: string;
        annotations: Record<string, boolean>;
      }>;
    };
  };
  assert.deepEqual(payload.result.tools.map((tool) => tool.name), [...HOODFLOW_MCP_TOOL_NAMES]);
  for (const tool of payload.result.tools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.idempotentHint, true);
  }
});

test("publishes and reads the reviewed market resource", async () => {
  const listed = await post({
    jsonrpc: "2.0",
    id: 3,
    method: "resources/list",
    params: {},
  });
  const listPayload = await listed.json() as {
    result: { resources: Array<{ uri: string }> };
  };
  assert.deepEqual(listPayload.result.resources.map((resource) => resource.uri), [
    HOODFLOW_MCP_RESOURCE_URI,
  ]);

  const read = await post({
    jsonrpc: "2.0",
    id: 4,
    method: "resources/read",
    params: { uri: HOODFLOW_MCP_RESOURCE_URI },
  });
  const readPayload = await read.json() as {
    result: { contents: Array<{ text: string }> };
  };
  const directory = JSON.parse(readPayload.result.contents[0].text) as {
    marketCount: number;
    executionPolicy: { autonomousSubmission: boolean };
  };
  assert.equal(directory.marketCount, 18);
  assert.equal(directory.executionPolicy.autonomousSubmission, false);
});

test("returns structured market, quote and basket preflight results without execution material", async () => {
  const calls = [
    {
      name: "hoodflow_list_markets",
      arguments: {},
    },
    {
      name: "hoodflow_prepare_quote",
      arguments: { asset: "AAPL", side: "buy", amount: "10", slippageBps: 50 },
    },
    {
      name: "hoodflow_prepare_basket",
      arguments: {
        budgetUsdG: "100",
        legs: [
          { asset: "AAPL", weightBps: 5000 },
          { asset: "NVDA", weightBps: 5000 },
        ],
        slippageBps: 50,
        failurePolicy: "all-or-nothing",
      },
    },
  ];

  for (const [index, call] of calls.entries()) {
    const response = await post({
      jsonrpc: "2.0",
      id: 10 + index,
      method: "tools/call",
      params: call,
    });
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      result: { isError?: boolean; structuredContent?: Record<string, unknown> };
    };
    assert.notEqual(payload.result.isError, true);
    assert.ok(payload.result.structuredContent);
    const serialized = JSON.stringify(payload.result.structuredContent);
    assert.doesNotMatch(serialized, /private.?key|calldata|signedTransaction|sendTransaction/i);
  }
});

test("accepts notifications with 202 and never creates session state", async () => {
  const response = await post({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("mcp-session-id"), null);
  assert.equal(await response.text(), "");
});

test("guards Origin, Accept, Content-Type, size and JSON-RPC batching", async () => {
  const forbidden = await post(
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    { origin: "https://evil.example" },
  );
  assert.equal(forbidden.status, 403);

  const unacceptable = await post(
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    { accept: "application/json" },
  );
  assert.equal(unacceptable.status, 406);

  const unsupported = await post(
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    { "content-type": "text/plain" },
  );
  assert.equal(unsupported.status, 415);

  const oversized = await post(
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    { "content-length": String(HOODFLOW_MCP_BODY_LIMIT_BYTES + 1) },
  );
  assert.equal(oversized.status, 413);

  const batch = await post([
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  ]);
  assert.equal(batch.status, 400);
});

test("uses durable general, shared quote and basket rate-limit scopes", async () => {
  const limits: Array<{ scope: string; cost: number }> = [];
  const response = await handleHoodFlowMcpPost(mcpRequest({
    jsonrpc: "2.0",
    id: 20,
    method: "tools/call",
    params: {
      name: "hoodflow_prepare_basket",
      arguments: {
        budgetUsdG: "100",
        legs: [
          { asset: "AAPL", weightBps: 5000 },
          { asset: "NVDA", weightBps: 5000 },
        ],
      },
    },
  }), {
    createServer: createTestServer,
    takeRateLimit: async (_request, _limit, _window, scope, cost) => {
      limits.push({ scope: scope ?? "", cost: cost ?? 1 });
      return { allowed: true, count: 1, retryAfterSeconds: 60 };
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(limits, [
    { scope: "mcp", cost: 1 },
    { scope: "quote", cost: 2 },
    { scope: "basket", cost: 1 },
  ]);

  const limited = await handleHoodFlowMcpPost(mcpRequest({
    jsonrpc: "2.0",
    id: 21,
    method: "tools/list",
    params: {},
  }), {
    createServer: createTestServer,
    takeRateLimit: async () => ({
      allowed: false,
      count: 121,
      retryAfterSeconds: 17,
    }),
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "17");
});

test("returns 405 for stateful stream methods and 204 for preflight", () => {
  const get = new Request("https://hoodflow.app/api/mcp", {
    method: "GET",
    headers: { origin: "https://hoodflow.app" },
  });
  const remove = new Request("https://hoodflow.app/api/mcp", {
    method: "DELETE",
    headers: { origin: "https://hoodflow.app" },
  });
  const options = new Request("https://hoodflow.app/api/mcp", {
    method: "OPTIONS",
    headers: { origin: "https://hoodflow.app" },
  });
  assert.equal(handleHoodFlowMcpMethodNotAllowed(get).status, 405);
  assert.equal(handleHoodFlowMcpMethodNotAllowed(remove).status, 405);
  const preflight = handleHoodFlowMcpOptions(options);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://hoodflow.app");
});
