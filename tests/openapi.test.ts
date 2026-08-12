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
    "/api/action-lock",
    "/api/agents/basket",
    "/api/agents/hoodflow",
    "/api/agents/markets",
    "/api/agents/quote",
    "/api/bell-lock/evaluate",
    "/api/fill-proof",
    "/api/payday",
  ]);
  assert.ok(Object.keys(paths).every((path) => !/execute|sign|submit|send|swap/i.test(path)));

  const operationIds = collectValuesForKey(paths, "operationId");
  assert.equal(operationIds.length, 8);
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

test("publishes Payday as a fail-closed corporate-action preview", () => {
  const document = buildHoodFlowOpenApiDocument() as never as {
    paths: {
      "/api/payday": {
        get: {
          description: string;
          parameters: Array<{
            name: string;
            in: string;
            required: boolean;
            schema: { type: string; enum: string[] };
          }>;
          responses: {
            "200": { content: { "application/json": { schema: { $ref: string } } } };
            "422": { content: { "application/json": { schema: { $ref: string } } } };
          };
          "x-hoodflow-payday-boundary": {
            qualifyingCorporateAction: string;
            assetIdentity: string;
            officialDateField: string;
            onchainState: string[];
            eligibleCode: string;
            failurePolicy: string;
          };
          "x-hoodflow-safety": Record<string, unknown>;
        };
      };
    };
    components: {
      schemas: {
        PaydaySuccessResponse: {
          properties: { ok: { const: boolean }; data: { $ref: string } };
          additionalProperties: boolean;
        };
        PaydayData: {
          properties: {
            handoffAllowed: { const: boolean };
            handoff: { type: string };
            executionHandoff: { type: string };
          };
          additionalProperties: boolean;
        };
        PaydayCapabilities: {
          properties: Record<string, { const: boolean }>;
          additionalProperties: boolean;
        };
        PaydayDisabledCapabilities: {
          properties: Record<string, { const: boolean }>;
          additionalProperties: boolean;
        };
        PaydayCorporateAction: {
          required: string[];
          properties: {
            processDate: { type: string[]; format: string };
            classification: { enum: string[] };
          };
          description: string;
          additionalProperties: boolean;
        };
        PaydayEligibility: {
          properties: { code: { description: string; enum: string[] } };
        };
        PaydayErrorResponse: {
          required: string[];
          properties: {
            ok: { const: boolean };
            capabilities: { $ref: string };
            handoffAllowed: { const: boolean };
            handoff: { type: string };
            executionHandoff: { type: string };
          };
          additionalProperties: boolean;
        };
      };
    };
  };

  const endpoint = document.paths["/api/payday"].get;
  assert.equal(endpoint.parameters.length, 1);
  assert.equal(endpoint.parameters[0].name, "asset");
  assert.equal(endpoint.parameters[0].in, "query");
  assert.equal(endpoint.parameters[0].required, true);
  assert.ok(endpoint.parameters[0].schema.enum.includes("AAPL"));
  assert.ok(endpoint.parameters[0].schema.enum.includes("SGOV"));
  assert.equal(
    endpoint.responses["200"].content["application/json"].schema.$ref,
    "#/components/schemas/PaydaySuccessResponse",
  );
  assert.equal(
    endpoint.responses["422"].content["application/json"].schema.$ref,
    "#/components/schemas/PaydayErrorResponse",
  );
  assert.match(endpoint.description, /CORPORATE_ACTION_TYPE_CASH_DIVIDEND/);
  assert.match(endpoint.description, /stable UID/);
  assert.match(endpoint.description, /chain 4663/);
  assert.match(endpoint.description, /fails closed/);
  assert.deepEqual(endpoint["x-hoodflow-payday-boundary"], {
    qualifyingCorporateAction: "CORPORATE_ACTION_TYPE_CASH_DIVIDEND",
    assetIdentity: "official-stable-uid+canonical-chain-4663-address",
    officialDateField: "processDate (date-only)",
    onchainState: ["uid()", "uiMultiplier()", "newUIMultiplier()", "effectiveAt()"],
    eligibleCode: "CONCURRENT_MULTIPLIER_TRANSITION_READY",
    failurePolicy: "fail-closed",
  });
  assert.deepEqual(endpoint["x-hoodflow-safety"], {
    custody: false,
    signing: false,
    submission: false,
    walletPermission: false,
    entitlement: false,
    handoffAllowed: false,
  });

  const schemas = document.components.schemas;
  assert.equal(schemas.PaydaySuccessResponse.properties.ok.const, true);
  assert.equal(schemas.PaydaySuccessResponse.properties.data.$ref, "#/components/schemas/PaydayData");
  assert.equal(schemas.PaydaySuccessResponse.additionalProperties, false);
  assert.equal(schemas.PaydayData.properties.handoffAllowed.const, false);
  assert.equal(schemas.PaydayData.properties.handoff.type, "null");
  assert.equal(schemas.PaydayData.properties.executionHandoff.type, "null");
  assert.equal(schemas.PaydayData.additionalProperties, false);
  assert.equal(schemas.PaydayCapabilities.properties.signs.const, false);
  assert.equal(schemas.PaydayCapabilities.properties.submitsTransaction.const, false);
  assert.equal(schemas.PaydayCapabilities.properties.requestsWalletPermission.const, false);
  assert.equal(schemas.PaydayCapabilities.properties.createsClaimToken.const, false);
  assert.equal(schemas.PaydayCapabilities.properties.controlsFunds.const, false);
  assert.equal(schemas.PaydayCapabilities.properties.createsEntitlement.const, false);
  assert.equal(schemas.PaydayCapabilities.additionalProperties, false);
  assert.equal(schemas.PaydayDisabledCapabilities.properties.readsOfficialSources.const, false);
  assert.equal(schemas.PaydayDisabledCapabilities.properties.signs.const, false);
  assert.equal(schemas.PaydayDisabledCapabilities.properties.submitsTransaction.const, false);
  assert.equal(schemas.PaydayDisabledCapabilities.properties.requestsWalletPermission.const, false);
  assert.equal(schemas.PaydayDisabledCapabilities.properties.createsClaimToken.const, false);
  assert.equal(schemas.PaydayDisabledCapabilities.properties.controlsFunds.const, false);
  assert.equal(schemas.PaydayDisabledCapabilities.properties.createsEntitlement.const, false);
  assert.equal(schemas.PaydayDisabledCapabilities.additionalProperties, false);
  assert.match(schemas.PaydayCorporateAction.description, /CORPORATE_ACTION_TYPE_CASH_DIVIDEND Process Date/);
  assert.ok(schemas.PaydayCorporateAction.required.includes("processDate"));
  assert.ok(!schemas.PaydayCorporateAction.required.includes("effectiveAt"));
  assert.deepEqual(schemas.PaydayCorporateAction.properties.processDate.type, ["string", "null"]);
  assert.equal(schemas.PaydayCorporateAction.properties.processDate.format, "date");
  assert.deepEqual(schemas.PaydayCorporateAction.properties.classification.enum, [
    "multiplier-transition-concurrent-with-cash-dividend-process-date",
    "cash-dividend-record-only",
    "not-qualified",
  ]);
  assert.equal(schemas.PaydayCorporateAction.additionalProperties, false);
  assert.match(schemas.PaydayEligibility.properties.code.description, /Only CONCURRENT_MULTIPLIER_TRANSITION_READY/);
  assert.ok(schemas.PaydayEligibility.properties.code.enum.includes("CONCURRENT_MULTIPLIER_TRANSITION_READY"));
  assert.deepEqual(schemas.PaydayErrorResponse.required, [
    "ok",
    "error",
    "retryable",
    "capabilities",
    "handoffAllowed",
    "handoff",
    "executionHandoff",
    "safety",
  ]);
  assert.equal(schemas.PaydayErrorResponse.properties.ok.const, false);
  assert.equal(schemas.PaydayErrorResponse.properties.capabilities.$ref, "#/components/schemas/PaydayDisabledCapabilities");
  assert.equal(schemas.PaydayErrorResponse.properties.handoffAllowed.const, false);
  assert.equal(schemas.PaydayErrorResponse.properties.handoff.type, "null");
  assert.equal(schemas.PaydayErrorResponse.properties.executionHandoff.type, "null");
  assert.equal(schemas.PaydayErrorResponse.additionalProperties, false);
  assert.doesNotMatch(JSON.stringify({ endpoint, schemas }), /dividend-derived|\bcaused\b|\bpayable\b/i);
});

test("publishes FillProof as a read-only onchain verification endpoint", () => {
  const document = buildHoodFlowOpenApiDocument() as never as {
    paths: {
      "/api/fill-proof": {
        get: {
          parameters: Array<{ name: string; in: string; required: boolean }>;
          responses: { "200": { content: { "application/json": { schema: { $ref: string } } } } };
          "x-hoodflow-safety": Record<string, unknown>;
        };
      };
    };
    components: { schemas: { FillProofResponse: Record<string, unknown>; FillProof: Record<string, unknown> } };
  };

  const endpoint = document.paths["/api/fill-proof"].get;
  assert.deepEqual(endpoint.parameters[0], {
    name: "txHash",
    in: "query",
    required: true,
    description: "Confirmed Robinhood Chain mainnet transaction hash.",
    schema: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
  });
  assert.equal(
    endpoint.responses["200"].content["application/json"].schema.$ref,
    "#/components/schemas/FillProofResponse",
  );
  assert.equal(endpoint["x-hoodflow-safety"].custody, false);
  assert.equal(endpoint["x-hoodflow-safety"].signing, false);
  assert.equal(endpoint["x-hoodflow-safety"].submission, false);
  assert.equal(document.components.schemas.FillProofResponse.additionalProperties, false);
  assert.equal(document.components.schemas.FillProof.additionalProperties, false);
});

test("publishes ActionLock as a bounded read/preflight endpoint", () => {
  const document = buildHoodFlowOpenApiDocument() as never as {
    paths: {
      "/api/action-lock": {
        post: {
          requestBody: { content: { "application/json": { schema: { $ref: string } } } };
          responses: { "200": { content: { "application/json": { schema: { $ref: string } } } } };
          "x-hoodflow-safety": Record<string, unknown>;
        };
      };
    };
    components: { schemas: { ActionLockPassport: Record<string, unknown> } };
  };

  const actionLock = document.paths["/api/action-lock"].post;
  assert.equal(
    actionLock.requestBody.content["application/json"].schema.$ref,
    "#/components/schemas/QuoteRequest",
  );
  assert.equal(
    actionLock.responses["200"].content["application/json"].schema.$ref,
    "#/components/schemas/ActionLockPassport",
  );
  assert.equal(actionLock["x-hoodflow-safety"].custody, false);
  assert.equal(actionLock["x-hoodflow-safety"].signing, false);
  assert.equal(actionLock["x-hoodflow-safety"].submission, false);
  assert.equal(actionLock["x-hoodflow-safety"].executionBinding, "none-preflight-only");
  assert.equal(document.components.schemas.ActionLockPassport.additionalProperties, false);
  assert.deepEqual(
    (document.components.schemas.ActionLockPassport.properties as { decision: { enum: string[] } }).decision.enum,
    ["clear", "watch", "blocked"],
  );
});

test("publishes BellLock preview as policy-only and non-authorizing", () => {
  const document = buildHoodFlowOpenApiDocument() as never as {
    paths: {
      "/api/bell-lock/evaluate": {
        post: {
          requestBody: { content: { "application/json": { schema: { $ref: string } } } };
          responses: { "200": { content: { "application/json": { schema: { $ref: string } } } } };
          "x-hoodflow-safety": Record<string, unknown>;
        };
      };
    };
    components: {
      schemas: {
        BellLockPreviewRequest: { properties: Record<string, unknown>; additionalProperties: boolean };
        BellLockPreviewEvaluation: {
          properties: {
            state: { enum: string[] };
            handoffAllowed: { const: boolean };
            handoff: { type: string };
          };
          additionalProperties: boolean;
        };
      };
    };
  };
  const endpoint = document.paths["/api/bell-lock/evaluate"].post;
  assert.equal(endpoint.requestBody.content["application/json"].schema.$ref, "#/components/schemas/BellLockPreviewRequest");
  assert.equal(endpoint.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/BellLockPreviewEvaluation");
  assert.equal(endpoint["x-hoodflow-safety"].custody, false);
  assert.equal(endpoint["x-hoodflow-safety"].signing, false);
  assert.equal(endpoint["x-hoodflow-safety"].submission, false);
  assert.equal(endpoint["x-hoodflow-safety"].handoffAllowed, false);
  assert.equal(document.components.schemas.BellLockPreviewRequest.additionalProperties, false);
  assert.equal(document.components.schemas.BellLockPreviewEvaluation.additionalProperties, false);
  assert.ok(!("evidence" in document.components.schemas.BellLockPreviewRequest.properties));
  assert.ok(!("observation" in document.components.schemas.BellLockPreviewRequest.properties));
  assert.doesNotMatch(document.components.schemas.BellLockPreviewEvaluation.properties.state.enum.join(","), /ready/);
  assert.equal(document.components.schemas.BellLockPreviewEvaluation.properties.handoffAllowed.const, false);
  assert.equal(document.components.schemas.BellLockPreviewEvaluation.properties.handoff.type, "null");
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
    endpoint: "https://hoodflow.app/api/mcp",
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
    (entry) => entry.href === "https://hoodflow.app/api/mcp",
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
