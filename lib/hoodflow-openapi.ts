import { canonicalSiteOrigin, listAgentMarkets, MAX_ORACLE_DEVIATION_BPS } from "@/lib/hoodflow-agent";
import {
  HOODFLOW_MCP_PROTOCOL_VERSION,
  HOODFLOW_MCP_RESOURCE_URI,
  HOODFLOW_MCP_TOOL_NAMES,
} from "@/lib/hoodflow-mcp";

export const HOODFLOW_OPENAPI_VERSION = "3.1.2";
export const HOODFLOW_API_CATALOG_PROFILE = "https://www.rfc-editor.org/info/rfc9727";

const errorResponse = {
  description: "The request failed safely.",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ApiError" },
    },
  },
};

export function buildHoodFlowOpenApiDocument() {
  const origin = canonicalSiteOrigin();
  const reviewedAssets = listAgentMarkets().map((market) => market.ticker);

  return {
    openapi: HOODFLOW_OPENAPI_VERSION,
    jsonSchemaDialect: "https://spec.openapis.org/oas/3.1/dialect/base",
    info: {
      title: "HoodFlow Agent Preflight API",
      version: "1.1.0",
      description: [
        "Public discovery and indicative preflight for route-reviewed Stock Tokens on Robinhood Chain.",
        "This API never holds funds, signs messages, returns executable calldata, or submits transactions.",
      ].join(" "),
    },
    servers: [{ url: origin, description: "HoodFlow production" }],
    security: [],
    tags: [
      { name: "Discovery", description: "Read route-reviewed markets and connector metadata." },
      { name: "Preflight", description: "Prepare temporary, non-executable quote and basket intents." },
    ],
    externalDocs: {
      description: "HoodFlow documentation",
      url: `${origin}/docs`,
    },
    paths: {
      "/api/agents/markets": {
        get: {
          operationId: "listHoodFlowMarkets",
          summary: "List route-reviewed execution markets",
          tags: ["Discovery"],
          security: [],
          responses: {
            "200": {
              description: "Current reviewed markets and safety policy.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/MarketDirectory" },
                },
              },
            },
          },
          "x-hoodflow-safety": {
            custody: false,
            signing: false,
            submission: false,
          },
        },
      },
      "/api/agents/quote": {
        post: {
          operationId: "prepareHoodFlowQuote",
          summary: "Prepare an indicative Stock Token quote",
          description: "Checks a reviewed DEX route and live oracle, then returns a wallet handoff that must be freshly quoted again before confirmation.",
          tags: ["Preflight"],
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/QuoteRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Indicative, non-execution-bound quote.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AgentQuote" },
                },
              },
            },
            "408": errorResponse,
            "413": errorResponse,
            "415": errorResponse,
            "422": errorResponse,
            "429": {
              ...errorResponse,
              headers: {
                "Retry-After": {
                  description: "Seconds before another request should be attempted.",
                  schema: { type: "integer", minimum: 1 },
                },
              },
            },
            "503": errorResponse,
          },
          "x-hoodflow-safety": {
            custody: false,
            signing: false,
            submission: false,
            executionBinding: "none-requote-required",
          },
        },
      },
      "/api/agents/basket": {
        post: {
          operationId: "prepareHoodFlowBasket",
          summary: "Prepare a weighted Stock Token basket",
          description: "Validates and preflights 2–6 separately confirmed legs. The response is a plan, not a batch transaction.",
          tags: ["Preflight"],
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BasketRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Prepared basket plan whose legs each require a fresh quote and trade confirmation; allowance and Permit2 steps can add wallet prompts.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/BasketPlan" },
                },
              },
            },
            "408": errorResponse,
            "413": errorResponse,
            "415": errorResponse,
            "422": errorResponse,
            "429": {
              ...errorResponse,
              headers: {
                "Retry-After": {
                  description: "Seconds before another request should be attempted.",
                  schema: { type: "integer", minimum: 1 },
                },
              },
            },
            "503": errorResponse,
          },
          "x-hoodflow-safety": {
            custody: false,
            signing: false,
            submission: false,
            batching: false,
            perLegWalletConfirmation: true,
          },
        },
      },
      "/api/agents/hoodflow": {
        get: {
          operationId: "getHoodFlowAgentMetadata",
          summary: "Read HoodFlow connector metadata",
          tags: ["Discovery"],
          security: [],
          responses: {
            "200": {
              description: "Connector capabilities and safety policy.",
              content: {
                "application/json": {
                  schema: { type: "object", additionalProperties: true },
                },
              },
            },
          },
          "x-hoodflow-safety": {
            custody: false,
            signing: false,
            submission: false,
          },
        },
      },
    },
    components: {
      schemas: {
        ApiError: {
          type: "object",
          required: ["error"],
          properties: {
            error: { type: "string" },
            retryable: { type: "boolean" },
            safety: { type: "string" },
          },
          additionalProperties: false,
        },
        Chain: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "integer", const: 4663 },
            name: { type: "string", const: "Robinhood Chain" },
          },
          additionalProperties: false,
        },
        AgentMarket: {
          type: "object",
          required: [
            "ticker",
            "name",
            "type",
            "tokenAddress",
            "settlementTicker",
            "settlementAddress",
            "route",
            "status",
          ],
          properties: {
            ticker: { type: "string", enum: reviewedAssets },
            name: { type: "string" },
            type: { type: "string", enum: ["Stock Token", "ETF Token"] },
            tokenAddress: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
            settlementTicker: { type: "string", const: "USDG" },
            settlementAddress: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
            route: { type: "string", enum: ["Uniswap V3", "Uniswap V4"] },
            status: { type: "string", const: "route-reviewed" },
          },
          additionalProperties: false,
        },
        MarketDirectory: {
          type: "object",
          required: ["resource", "version", "chain", "settlement", "executionPolicy", "markets", "marketCount", "fetchedAt"],
          properties: {
            resource: { type: "string", const: "hoodflow.execution-markets" },
            version: { type: "string" },
            chain: { $ref: "#/components/schemas/Chain" },
            settlement: { type: "string", const: "USDG" },
            executionPolicy: { type: "object", additionalProperties: true },
            markets: {
              type: "array",
              items: { $ref: "#/components/schemas/AgentMarket" },
            },
            marketCount: { type: "integer", minimum: 0 },
            resourceUrl: { type: "string", format: "uri" },
            quoteEndpoint: { type: "string", format: "uri" },
            fetchedAt: { type: "string", format: "date-time" },
          },
          additionalProperties: true,
        },
        QuoteRequest: {
          type: "object",
          required: ["asset", "side", "amount"],
          properties: {
            asset: { type: "string", enum: reviewedAssets },
            side: { type: "string", enum: ["buy", "sell"] },
            amount: {
              type: "string",
              pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$",
              description: "USDG for buys; Stock Token units for sells.",
            },
            slippageBps: {
              type: "integer",
              minimum: 1,
              maximum: 500,
              default: 50,
            },
          },
          additionalProperties: false,
        },
        AgentQuote: {
          type: "object",
          required: [
            "quoteId",
            "status",
            "chain",
            "asset",
            "side",
            "pay",
            "receive",
            "route",
            "protection",
            "reference",
            "custody",
            "requiresUserSignature",
            "executionHandoff",
            "quotedAt",
          ],
          properties: {
            quoteId: { type: "string" },
            status: { type: "string", const: "indicative-preflight" },
            chain: { $ref: "#/components/schemas/Chain" },
            asset: { type: "string", enum: reviewedAssets },
            side: { type: "string", enum: ["buy", "sell"] },
            pay: { type: "object", additionalProperties: true },
            receive: { type: "object", additionalProperties: true },
            route: { type: "object", additionalProperties: true },
            protection: {
              type: "object",
              required: ["slippageBps", "dataExpiresAt", "executionBinding"],
              properties: {
                slippageBps: { type: "integer" },
                dataExpiresAt: { type: "string", format: "date-time" },
                executionBinding: { type: "string", const: "none-requote-required" },
              },
              additionalProperties: true,
            },
            reference: { type: "object", additionalProperties: true },
            custody: { type: "string", const: "self-custody" },
            requiresUserSignature: { type: "boolean", const: true },
            executionHandoff: { type: "object", additionalProperties: true },
            quotedAt: { type: "string", format: "date-time" },
          },
          additionalProperties: false,
        },
        BasketRequest: {
          type: "object",
          required: ["budgetUsdG", "legs"],
          properties: {
            budgetUsdG: {
              type: "string",
              pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,6})?$",
              description: "Positive budget up to 100,000 USDG.",
            },
            legs: {
              type: "array",
              minItems: 2,
              maxItems: 6,
              items: {
                type: "object",
                required: ["asset", "weightBps"],
                properties: {
                  asset: { type: "string", enum: reviewedAssets },
                  weightBps: { type: "integer", minimum: 1, maximum: 10_000 },
                },
                additionalProperties: false,
              },
              description: "Assets must be unique and weights must sum to exactly 10,000 bps.",
            },
            slippageBps: {
              type: "integer",
              minimum: 1,
              maximum: 500,
              default: 50,
            },
            failurePolicy: {
              type: "string",
              enum: ["all-or-nothing", "omit-unsafe"],
              default: "all-or-nothing",
            },
          },
          additionalProperties: false,
        },
        BasketPlan: {
          type: "object",
          required: [
            "basketId",
            "status",
            "progress",
            "budget",
            "legs",
            "rejectedLegs",
            "protection",
            "custody",
            "requiresUserSignature",
            "execution",
            "preparedAt",
          ],
          properties: {
            basketId: { type: "string" },
            status: { type: "string" },
            progress: { type: "object", additionalProperties: true },
            budget: { type: "object", additionalProperties: true },
            legs: { type: "array", items: { type: "object", additionalProperties: true } },
            rejectedLegs: { type: "array", items: { type: "object", additionalProperties: true } },
            protection: { type: "object", additionalProperties: true },
            custody: { type: "string", const: "self-custody" },
            requiresUserSignature: { type: "boolean", const: true },
            execution: { type: "object", additionalProperties: true },
            preparedAt: { type: "string", format: "date-time" },
          },
          additionalProperties: true,
        },
      },
    },
    "x-hoodflow-mcp": {
      endpoint: `${origin}/mcp`,
      transport: "streamable-http",
      sessionMode: "stateless",
      protocolVersion: HOODFLOW_MCP_PROTOCOL_VERSION,
      tools: [...HOODFLOW_MCP_TOOL_NAMES],
      resources: [HOODFLOW_MCP_RESOURCE_URI],
      authentication: "none-public-read-preflight",
    },
    "x-hoodflow-safety": {
      chainId: 4663,
      routeReviewedMarkets: reviewedAssets.length,
      maxOracleDeviationBps: MAX_ORACLE_DEVIATION_BPS,
      custody: false,
      signing: false,
      submission: false,
    },
  };
}

export function buildHoodFlowApiCatalog() {
  const origin = canonicalSiteOrigin();
  return {
    linkset: [{
      anchor: `${origin}/api/agents`,
      "service-desc": [{
        href: `${origin}/openapi.json`,
        type: "application/json",
        title: "HoodFlow Agent Preflight OpenAPI",
      }],
      "service-doc": [{
        href: `${origin}/docs`,
        type: "text/html",
        title: "HoodFlow documentation",
      }],
      "service-meta": [
        {
          href: `${origin}/api/agents/hoodflow`,
          type: "application/json",
          title: "HoodFlow agent metadata",
        },
        {
          href: `${origin}/mcp`,
          type: "application/json",
          title: "HoodFlow stateless Streamable HTTP MCP",
        },
      ],
    }],
  };
}
