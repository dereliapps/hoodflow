import assert from "node:assert/strict";
import test from "node:test";

import { GET as getApiCatalog } from "../app/api-catalog/route.js";
import { GET as getOpenApi } from "../app/openapi.json/route.js";
import { listAgentMarkets } from "../lib/hoodflow-agent.js";
import {
  buildHoodFlowApiCatalog,
  buildHoodFlowOpenApiDocument,
  HOODFLOW_API_CATALOG_PROFILE,
  HOODFLOW_OPENAPI_VERSION,
} from "../lib/hoodflow-openapi.js";

type JsonObject = Record<string, unknown>;

function collectValuesForKey(value: unknown, key: string, found: unknown[] = []) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value) collectValuesForKey(item, key, found);
    return found;
  }
  for (const [entryKey, entryValue] of Object.entries(value as JsonObject)) {
    if (entryKey === key) found.push(entryValue);
    collectValuesForKey(entryValue, key, found);
  }
  return found;
}

function resolveLocalPointer(document: unknown, pointer: string) {
  assert.match(pointer, /^#\//);
  return pointer.slice(2).split("/").reduce<unknown>((current, segment) => {
    assert.ok(current && typeof current === "object" && !Array.isArray(current));
    const decoded = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    return (current as JsonObject)[decoded];
  }, document);
}

test("publishes a complete OpenAPI 3.1.2 read/preflight contract", () => {
  const document = buildHoodFlowOpenApiDocument() as unknown as JsonObject;
  assert.equal(document.openapi, HOODFLOW_OPENAPI_VERSION);
  assert.equal(document.openapi, "3.1.2");
  assert.deepEqual(document.security, []);

  const paths = document.paths as JsonObject;
  assert.deepEqual(Object.keys(paths).sort(), [
    "/api/agents/basket",
    "/api/agents/hoodflow",
    "/api/agents/markets",
    "/api/agents/quote",
  ]);
  assert.ok(Object.keys(paths).every((path) => !/execute|sign|submit|send|swap/i.test(path)));

  const operationIds = collectValuesForKey(paths, "operationId");
  assert.equal(operationIds.length, 4);
  assert.equal(new Set(operationIds).size, operationIds.length);

  const safety = document["x-hoodflow-safety"] as JsonObject;
  assert.equal(safety.custody, false);
  assert.equal(safety.signing, false);
  assert.equal(safety.submission, false);
  assert.equal(safety.routeReviewedMarkets, 18);

  const serialized = JSON.stringify(document);
  assert.doesNotMatch(
    serialized,
    /"(?:privateKey|private_key|calldata|signedTransaction|sendTransaction)"\s*:/i,
  );
});

test("keeps OpenAPI asset enums and basket bounds aligned with reviewed markets", () => {
  const document = buildHoodFlowOpenApiDocument() as never as {
    components: {
      schemas: {
        QuoteRequest: {
          properties: {
            asset: { enum: string[] };
            slippageBps: { minimum: number; maximum: number };
          };
        };
        BasketRequest: {
          properties: {
            legs: {
              minItems: number;
              maxItems: number;
              items: { properties: { asset: { enum: string[] }; weightBps: { maximum: number } } };
            };
            failurePolicy: { enum: string[] };
          };
        };
      };
    };
  };
  const expectedAssets = listAgentMarkets().map((market) => market.ticker);
  assert.deepEqual(document.components.schemas.QuoteRequest.properties.asset.enum, expectedAssets);
  assert.deepEqual(
    document.components.schemas.BasketRequest.properties.legs.items.properties.asset.enum,
    expectedAssets,
  );
  assert.equal(document.components.schemas.BasketRequest.properties.legs.minItems, 2);
  assert.equal(document.components.schemas.BasketRequest.properties.legs.maxItems, 6);
  assert.equal(
    document.components.schemas.BasketRequest.properties.legs.items.properties.weightBps.maximum,
    10_000,
  );
  assert.deepEqual(
    document.components.schemas.BasketRequest.properties.failurePolicy.enum,
    ["all-or-nothing", "omit-unsafe"],
  );
  assert.equal(document.components.schemas.QuoteRequest.properties.slippageBps.minimum, 1);
  assert.equal(document.components.schemas.QuoteRequest.properties.slippageBps.maximum, 500);
});

test("uses only resolvable local OpenAPI references", () => {
  const document = buildHoodFlowOpenApiDocument();
  const references = collectValuesForKey(document, "$ref");
  assert.ok(references.length > 0);
  for (const reference of references) {
    assert.equal(typeof reference, "string");
    assert.ok(resolveLocalPointer(document, reference as string));
  }
});

test("advertises the stateless MCP connector and its exact public surface", () => {
  const document = buildHoodFlowOpenApiDocument() as never as {
    "x-hoodflow-mcp": {
      endpoint: string;
      transport: string;
      sessionMode: string;
      protocolVersion: string;
      tools: string[];
      resources: string[];
    };
  };
  assert.deepEqual(document["x-hoodflow-mcp"], {
    endpoint: "https://hoodflow.app/mcp",
    transport: "streamable-http",
    sessionMode: "stateless",
    protocolVersion: "2025-11-25",
    tools: [
      "hoodflow_list_markets",
      "hoodflow_prepare_quote",
      "hoodflow_prepare_basket",
    ],
    resources: ["hoodflow://execution-markets"],
    authentication: "none-public-read-preflight",
  });
});

test("discovers OpenAPI through the RFC 9727 API catalog", () => {
  const catalog = buildHoodFlowApiCatalog() as {
    linkset: Array<{
      anchor: string;
      "service-desc": Array<{ href: string; type: string }>;
      "service-meta": Array<{ href: string }>;
    }>;
  };
  assert.equal(catalog.linkset.length, 1);
  assert.equal(catalog.linkset[0].anchor, "https://hoodflow.app/api/agents");
  assert.deepEqual(catalog.linkset[0]["service-desc"], [{
    href: "https://hoodflow.app/openapi.json",
    type: "application/json",
    title: "HoodFlow Agent Preflight OpenAPI",
  }]);
  assert.ok(catalog.linkset[0]["service-meta"].some(
    (entry) => entry.href === "https://hoodflow.app/mcp",
  ));
});

test("serves OpenAPI and API catalog with machine-readable content types", async () => {
  const openApiResponse = await getOpenApi();
  assert.equal(openApiResponse.status, 200);
  assert.match(openApiResponse.headers.get("content-type") ?? "", /^application\/json/);
  assert.match(openApiResponse.headers.get("link") ?? "", /rel="api-catalog"/);
  const document = await openApiResponse.json() as { openapi: string };
  assert.equal(document.openapi, "3.1.2");

  const catalogResponse = await getApiCatalog();
  assert.equal(catalogResponse.status, 200);
  assert.equal(
    catalogResponse.headers.get("content-type"),
    `application/linkset+json; profile="${HOODFLOW_API_CATALOG_PROFILE}"`,
  );
  const catalog = await catalogResponse.json() as { linkset: unknown[] };
  assert.equal(catalog.linkset.length, 1);
});
