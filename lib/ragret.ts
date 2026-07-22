import { ROBINHOOD_PRICE_FEEDS } from "@/config/robinhood-price-feeds";

export const RAGRET_FORMULA_VERSION = "ragret-scenario-v1";

export type RagretVerdict = "RAGRET" | "NO_RAGRETS" | "EVEN";
export type RagretSeverity = "paper-cut" | "sting" | "scar" | "legendary";

export type RagretScenarioRequest = {
  stock: string;
  communityAddress: string;
  notionalUsdg: string;
};

export type RagretPricePoint = {
  priceE8: bigint;
  updatedAt: number;
  sourceId: string;
};

export type RagretCommunitySnapshot = {
  address: string;
  name: string;
  symbol: string;
  returnBps: number;
  liquidityUsd: number;
  lifecycle: string;
  pairUrl: string;
  observedAt: number;
};

export type RagretScenarioInput = {
  request: RagretScenarioRequest;
  stockName: string;
  stockStart: RagretPricePoint;
  stockEnd: RagretPricePoint;
  community: RagretCommunitySnapshot;
  generatedAt: number;
};

const DECIMAL_USDG = /^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/;
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const MAX_COMMUNITY_RETURN_BPS = 1_000_000;
const USABLE_STOCKS = new Set(Object.entries(ROBINHOOD_PRICE_FEEDS)
  .filter(([, config]) => Boolean(config.feed))
  .map(([ticker]) => ticker));

export class RagretValidationError extends Error {}
export class RagretDataUnavailableError extends Error {}

function readRequiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new RagretValidationError(`${field} is required.`);
  return value.trim();
}

export function parseRagretScenarioRequest(value: unknown): RagretScenarioRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RagretValidationError("A JSON RAGRET scenario request is required.");
  }
  const input = value as Record<string, unknown>;
  const stock = readRequiredString(input.stock, "stock").toUpperCase();
  if (!USABLE_STOCKS.has(stock)) throw new RagretValidationError("stock must have a supported Robinhood Chainlink feed.");

  const communityAddress = readRequiredString(input.communityAddress, "communityAddress").toLowerCase();
  if (!ADDRESS.test(communityAddress)) throw new RagretValidationError("communityAddress must be a valid EVM token address.");

  const notionalUsdg = readRequiredString(input.notionalUsdg, "notionalUsdg");
  if (!DECIMAL_USDG.test(notionalUsdg) || Number(notionalUsdg) <= 0) {
    throw new RagretValidationError("notionalUsdg must be between 0.01 and 999,999.99 with at most two decimals.");
  }
  return { stock, communityAddress, notionalUsdg };
}

export function decimalToCents(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function formatScaled(value: bigint, decimals: number) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function formatCents(value: bigint) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

function formatBps(value: number) {
  return (value / 100).toFixed(2);
}

function fnv1a64(value: string) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function classifySeverity(gapCents: bigint, notionalCents: bigint): RagretSeverity {
  const relativeBps = Number((gapCents < 0n ? -gapCents : gapCents) * 10_000n / notionalCents);
  if (relativeBps < 100) return "paper-cut";
  if (relativeBps < 1_000) return "sting";
  if (relativeBps < 2_500) return "scar";
  return "legendary";
}

export function calculateRagretScenario(input: RagretScenarioInput) {
  const { request, stockStart, stockEnd, community } = input;
  if (stockStart.priceE8 <= 0n || stockEnd.priceE8 <= 0n || stockEnd.updatedAt <= stockStart.updatedAt) {
    throw new RagretDataUnavailableError("The Stock Token price window is incomplete.");
  }
  if (!Number.isInteger(community.returnBps)
    || community.returnBps <= -10_000
    || community.returnBps > MAX_COMMUNITY_RETURN_BPS) {
    throw new RagretDataUnavailableError("The community token 24-hour move is unavailable or outside safe bounds.");
  }

  const notionalCents = decimalToCents(request.notionalUsdg);
  const stockReturnBps = Number((stockEnd.priceE8 - stockStart.priceE8) * 10_000n / stockStart.priceE8);
  const stockValueCents = notionalCents * BigInt(10_000 + stockReturnBps) / 10_000n;
  const communityValueCents = notionalCents * BigInt(10_000 + community.returnBps) / 10_000n;
  const gapCents = stockValueCents - communityValueCents;
  const verdict: RagretVerdict = gapCents > 0n ? "RAGRET" : gapCents < 0n ? "NO_RAGRETS" : "EVEN";
  const severity = classifySeverity(gapCents, notionalCents);
  const windowHours = Math.round((stockEnd.updatedAt - stockStart.updatedAt) / 36) / 100;
  const normalizedKey = [
    RAGRET_FORMULA_VERSION,
    request.stock,
    community.address,
    notionalCents.toString(),
    stockStart.priceE8.toString(),
    stockEnd.priceE8.toString(),
    community.returnBps,
    stockStart.updatedAt,
    stockEnd.updatedAt,
  ].join(":");
  const receiptId = `hf-ragret-${fnv1a64(normalizedKey)}`;
  const gapLabel = formatCents(gapCents < 0n ? -gapCents : gapCents);
  const winner = verdict === "RAGRET" ? request.stock : verdict === "NO_RAGRETS" ? community.symbol : "NEITHER";
  const headline = verdict === "RAGRET"
    ? `${request.stock} was the road not taken. The gap is ${gapLabel} USDG.`
    : verdict === "NO_RAGRETS"
      ? `${community.symbol} outran ${request.stock} by ${gapLabel} USDG. No ragrets.`
      : `${request.stock} and ${community.symbol} finished even.`;
  const shareText = [
    `RAGRET RECEIPT // ${receiptId}`,
    `${request.notionalUsdg} USDG -> ${request.stock}: ${formatCents(stockValueCents)} USDG`,
    `${request.notionalUsdg} USDG -> ${community.symbol}: ${formatCents(communityValueCents)} USDG`,
    `${verdict} GAP: ${gapLabel} USDG`,
    "Scenario only. Not a transaction receipt or financial advice.",
  ].join("\n");

  return {
    receiptId,
    formulaVersion: RAGRET_FORMULA_VERSION,
    status: "scenario-receipt" as const,
    scenario: true as const,
    transactionProof: false as const,
    requiresUserSignature: false as const,
    verdict,
    severity,
    winner,
    headline,
    shareText,
    notionalUsdg: formatCents(notionalCents),
    windowHours,
    stock: {
      ticker: request.stock,
      name: input.stockName,
      startPriceUsd: formatScaled(stockStart.priceE8, 8),
      endPriceUsd: formatScaled(stockEnd.priceE8, 8),
      returnBps: stockReturnBps,
      returnPct: formatBps(stockReturnBps),
      scenarioValueUsdg: formatCents(stockValueCents),
      startedAt: new Date(stockStart.updatedAt * 1_000).toISOString(),
      observedAt: new Date(stockEnd.updatedAt * 1_000).toISOString(),
      sourceId: stockEnd.sourceId,
    },
    community: {
      address: community.address,
      name: community.name,
      symbol: community.symbol,
      returnBps: community.returnBps,
      returnPct: formatBps(community.returnBps),
      scenarioValueUsdg: formatCents(communityValueCents),
      liquidityUsd: community.liquidityUsd,
      lifecycle: community.lifecycle,
      pairUrl: community.pairUrl,
      observedAt: new Date(community.observedAt * 1_000).toISOString(),
    },
    gap: {
      signedUsdg: formatCents(gapCents),
      absoluteUsdg: gapLabel,
      returnBps: stockReturnBps - community.returnBps,
      returnPct: formatBps(stockReturnBps - community.returnBps),
    },
    methodology: {
      benchmark: "Gross rolling-window counterfactual",
      communityWindow: "Provider-reported rolling 24h move (or since launch for newer markets)",
      excludes: ["fees", "slippage", "taxes", "wallet activity", "execution feasibility"],
      assumption: "1 USDG = 1 USD",
      notice: "SCENARIO ONLY - NOT A TRANSACTION RECEIPT",
    },
    generatedAt: new Date(input.generatedAt * 1_000).toISOString(),
  };
}
