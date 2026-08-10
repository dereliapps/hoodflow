import { DEPTH_MAP_SAMPLE_AMOUNTS, type DepthMapPointStatus } from "./depth-map";
import { MAX_ORACLE_DEVIATION_BPS } from "./oracle-protection";

export const DEPTH_MEMORY_STORAGE_KEY = "hoodflow-depth-history-v1";
export const DEPTH_MEMORY_SCHEMA = "hoodflow-depth-memory/1" as const;
export const DEPTH_MEMORY_MAX_BYTES = 128 * 1024;
export const DEPTH_MEMORY_MAX_PER_ASSET = 5;
export const DEPTH_MEMORY_MAX_TOTAL = 20;

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const MAX_SCAN_DURATION_MS = 2 * 60 * 1_000;
const MAX_QUOTE_TTL_MS = 2 * 60 * 1_000;
const MAX_ORACLE_HEARTBEAT_SECONDS = 7 * 24 * 60 * 60;
const ORACLE_TIMESTAMP_TOLERANCE_MS = 1_000;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,36})?$/;
const SAMPLE_SET = new Set<string>(DEPTH_MAP_SAMPLE_AMOUNTS);

export type DepthMemoryPointStatus = "passed-then" | "no-signal" | "rate-limited";

export type DepthMemoryPoint = {
  amount: (typeof DEPTH_MAP_SAMPLE_AMOUNTS)[number];
  status: DepthMemoryPointStatus;
  quotedAt?: string;
  expiresAt?: string;
  estimatedOutput?: string;
  minimumOutput?: string;
  protocol?: "Uniswap V3" | "Uniswap V4";
  feeBps?: number;
  gasEstimate?: string | null;
  oraclePrice?: number;
  impliedDexPrice?: number;
  deviationBps?: number;
  maxDeviationBps?: number;
  oracleUpdatedAt?: number;
  oracleHeartbeat?: number;
};

export type DepthMemoryScan = {
  schema: typeof DEPTH_MEMORY_SCHEMA;
  id: string;
  asset: string;
  startedAt: number;
  completedAt: number;
  slippageBps: 50;
  points: DepthMemoryPoint[];
};

export type DepthMemoryQuoteInput = {
  receive: { estimatedAmount: string; indicativeMinimumAmount: string };
  route: { protocol: "Uniswap V3" | "Uniswap V4"; feeBps: number; gasEstimate: string | null };
  protection: { dataExpiresAt: string; slippageBps: number };
  reference: {
    price: number;
    impliedDexPrice: number;
    deviationBps: number;
    maxDeviationBps: number;
    updatedAt: number;
    heartbeat: number;
  };
  quotedAt: string;
};

export type DepthMemoryPointInput = {
  amount: string;
  status: DepthMapPointStatus;
  quote?: DepthMemoryQuoteInput;
};

export type DepthMemoryTransition = "both-passed" | "appeared" | "unresolved";

export type DepthMemoryComparisonPoint = {
  amount: (typeof DEPTH_MAP_SAMPLE_AMOUNTS)[number];
  previous: DepthMemoryPoint;
  current: DepthMemoryPoint;
  transition: DepthMemoryTransition;
  deviationDeltaBps: number | null;
  outputDeltaBps: number | null;
  protocolChanged: boolean;
};

export type DepthMemoryComparison = {
  asset: string;
  previousId: string;
  currentId: string;
  points: DepthMemoryComparisonPoint[];
  appearedCount: number;
  notReobservedCount: number;
  comparableCount: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isBoundedDecimal(value: unknown, allowZero = false): value is string {
  if (typeof value !== "string" || value.length > 80 || !DECIMAL_PATTERN.test(value)) return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && (allowZero ? numeric >= 0 : numeric > 0);
}

function decimalParts(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return { whole: whole.replace(/^0+(?=\d)/, ""), fraction: fraction.replace(/0+$/, "") };
}

function compareDecimals(left: string, right: string) {
  const a = decimalParts(left);
  const b = decimalParts(right);
  if (a.whole.length !== b.whole.length) return a.whole.length > b.whole.length ? 1 : -1;
  if (a.whole !== b.whole) return a.whole > b.whole ? 1 : -1;
  const width = Math.max(a.fraction.length, b.fraction.length);
  const aFraction = a.fraction.padEnd(width, "0");
  const bFraction = b.fraction.padEnd(width, "0");
  if (aFraction === bFraction) return 0;
  return aFraction > bFraction ? 1 : -1;
}

function decimalToScaled(value: string, decimals = 36) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(decimals, "0").slice(0, decimals)}`);
}

function decimalDeltaBps(current: string, previous: string) {
  const currentScaled = decimalToScaled(current);
  const previousScaled = decimalToScaled(previous);
  if (previousScaled <= 0n) return null;
  const rounded = ((currentScaled - previousScaled) * 10_000n) / previousScaled;
  const bounded = rounded > 1_000_000n ? 1_000_000n : rounded < -1_000_000n ? -1_000_000n : rounded;
  return Number(bounded);
}

function sanitizeHistoricalPoint(
  value: unknown,
  scanStartedAt: number,
  scanCompletedAt: number,
  now: number,
): DepthMemoryPoint | null {
  if (!isPlainObject(value) || !SAMPLE_SET.has(String(value.amount))) return null;
  const amount = String(value.amount) as DepthMemoryPoint["amount"];
  if (value.status === "no-signal" || value.status === "rate-limited") {
    return { amount, status: value.status };
  }
  if (value.status !== "passed-then") return null;
  if (
    !isBoundedDecimal(value.estimatedOutput)
    || !isBoundedDecimal(value.minimumOutput)
    || compareDecimals(value.minimumOutput, value.estimatedOutput) > 0
    || (value.protocol !== "Uniswap V3" && value.protocol !== "Uniswap V4")
    || !Number.isInteger(value.feeBps) || !isFiniteNumber(value.feeBps, 0, 100_000)
    || !(value.gasEstimate === null || (typeof value.gasEstimate === "string" && /^\d{1,30}$/.test(value.gasEstimate)))
    || !isFiniteNumber(value.oraclePrice, Number.MIN_VALUE, 1_000_000_000_000)
    || !isFiniteNumber(value.impliedDexPrice, Number.MIN_VALUE, 1_000_000_000_000)
    || !Number.isInteger(value.deviationBps) || !isFiniteNumber(value.deviationBps, 0, MAX_ORACLE_DEVIATION_BPS)
    || value.maxDeviationBps !== MAX_ORACLE_DEVIATION_BPS
    || !Number.isInteger(value.oracleUpdatedAt) || !isFiniteNumber(value.oracleUpdatedAt, 1, Math.floor((now + MAX_CLOCK_SKEW_MS) / 1_000))
    || !Number.isInteger(value.oracleHeartbeat) || !isFiniteNumber(value.oracleHeartbeat, 1, MAX_ORACLE_HEARTBEAT_SECONDS)
    || typeof value.quotedAt !== "string"
    || typeof value.expiresAt !== "string"
  ) return null;
  const quotedAt = Date.parse(value.quotedAt);
  const expiresAt = Date.parse(value.expiresAt);
  const oracleUpdatedAt = value.oracleUpdatedAt * 1_000;
  if (
    !Number.isFinite(quotedAt)
    || !Number.isFinite(expiresAt)
    || quotedAt < scanStartedAt - MAX_CLOCK_SKEW_MS
    || quotedAt > scanCompletedAt + MAX_CLOCK_SKEW_MS
    || expiresAt <= quotedAt
    || expiresAt - quotedAt > MAX_QUOTE_TTL_MS
    || quotedAt > now + MAX_CLOCK_SKEW_MS
    || expiresAt > now + 10 * 60 * 1_000
    || oracleUpdatedAt > quotedAt + ORACLE_TIMESTAMP_TOLERANCE_MS
    || quotedAt - oracleUpdatedAt > value.oracleHeartbeat * 1_000 + ORACLE_TIMESTAMP_TOLERANCE_MS
  ) return null;
  return {
    amount,
    status: "passed-then",
    quotedAt: new Date(quotedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    estimatedOutput: value.estimatedOutput,
    minimumOutput: value.minimumOutput,
    protocol: value.protocol,
    feeBps: value.feeBps,
    gasEstimate: value.gasEstimate,
    oraclePrice: value.oraclePrice,
    impliedDexPrice: value.impliedDexPrice,
    deviationBps: value.deviationBps,
    maxDeviationBps: MAX_ORACLE_DEVIATION_BPS,
    oracleUpdatedAt: value.oracleUpdatedAt,
    oracleHeartbeat: value.oracleHeartbeat,
  };
}

export function sanitizeDepthMemoryScan(
  value: unknown,
  allowedAssets: ReadonlySet<string>,
  now = Date.now(),
): DepthMemoryScan | null {
  if (!isPlainObject(value) || value.schema !== DEPTH_MEMORY_SCHEMA) return null;
  if (typeof value.asset !== "string" || !allowedAssets.has(value.asset)) return null;
  if (typeof value.id !== "string" || !/^[A-Z0-9_-]{2,16}:\d{10,16}$/.test(value.id)) return null;
  const startedAt = value.startedAt;
  const completedAt = value.completedAt;
  if (
    !Number.isInteger(startedAt) || !isFiniteNumber(startedAt, 1, now + MAX_CLOCK_SKEW_MS)
    || !Number.isInteger(completedAt) || !isFiniteNumber(completedAt, startedAt, now + MAX_CLOCK_SKEW_MS)
    || completedAt - startedAt > MAX_SCAN_DURATION_MS
    || value.slippageBps !== 50
    || !Array.isArray(value.points)
    || value.points.length !== DEPTH_MAP_SAMPLE_AMOUNTS.length
  ) return null;
  if (value.id !== `${value.asset}:${completedAt}`) return null;
  const points = value.points.map((point) => sanitizeHistoricalPoint(point, startedAt, completedAt, now));
  if (points.some((point) => !point)) return null;
  const byAmount = new Map(points.map((point) => [point!.amount, point!]));
  if (byAmount.size !== DEPTH_MAP_SAMPLE_AMOUNTS.length) return null;
  return {
    schema: DEPTH_MEMORY_SCHEMA,
    id: value.id,
    asset: value.asset,
    startedAt,
    completedAt,
    slippageBps: 50,
    points: DEPTH_MAP_SAMPLE_AMOUNTS.map((amount) => byAmount.get(amount)!),
  };
}

export function parseDepthMemory(
  serialized: string | null,
  allowedAssets: ReadonlySet<string>,
  now = Date.now(),
): DepthMemoryScan[] {
  if (!serialized || serialized.length > DEPTH_MEMORY_MAX_BYTES) return [];
  try {
    const root = JSON.parse(serialized) as unknown;
    if (!isPlainObject(root) || root.version !== 1 || !Array.isArray(root.scans) || root.scans.length > 100) return [];
    return pruneDepthMemory(root.scans
      .map((scan) => sanitizeDepthMemoryScan(scan, allowedAssets, now))
      .filter((scan): scan is DepthMemoryScan => Boolean(scan)));
  } catch {
    return [];
  }
}

export function serializeDepthMemory(scans: readonly DepthMemoryScan[]) {
  return JSON.stringify({ version: 1, scans: pruneDepthMemory(scans) });
}

export function pruneDepthMemory(scans: readonly DepthMemoryScan[]) {
  const sorted = [...scans].sort((left, right) => right.completedAt - left.completedAt);
  const seen = new Set<string>();
  const perAsset = new Map<string, number>();
  const retained: DepthMemoryScan[] = [];
  for (const scan of sorted) {
    if (seen.has(scan.id)) continue;
    const count = perAsset.get(scan.asset) ?? 0;
    if (count >= DEPTH_MEMORY_MAX_PER_ASSET || retained.length >= DEPTH_MEMORY_MAX_TOTAL) continue;
    seen.add(scan.id);
    perAsset.set(scan.asset, count + 1);
    retained.push(scan);
  }
  return retained;
}

export function appendDepthMemory(scans: readonly DepthMemoryScan[], next: DepthMemoryScan) {
  return pruneDepthMemory([next, ...scans]);
}

export function clearDepthMemoryAsset(scans: readonly DepthMemoryScan[], asset: string) {
  return scans.filter((scan) => scan.asset !== asset);
}

export function createDepthMemoryScan(
  asset: string,
  startedAt: number,
  completedAt: number,
  points: readonly DepthMemoryPointInput[],
): DepthMemoryScan {
  const historicalPoints: DepthMemoryPoint[] = DEPTH_MAP_SAMPLE_AMOUNTS.map((amount) => {
    const point = points.find((candidate) => candidate.amount === amount);
    if (!point || point.status === "scanning" || point.status === "unavailable") {
      return { amount, status: "no-signal" };
    }
    if (point.status === "rate-limited") return { amount, status: "rate-limited" };
    const quote = point.quote;
    if (!quote) return { amount, status: "no-signal" };
    return {
      amount,
      status: "passed-then",
      quotedAt: quote.quotedAt,
      expiresAt: quote.protection.dataExpiresAt,
      estimatedOutput: quote.receive.estimatedAmount,
      minimumOutput: quote.receive.indicativeMinimumAmount,
      protocol: quote.route.protocol,
      feeBps: quote.route.feeBps,
      gasEstimate: quote.route.gasEstimate,
      oraclePrice: quote.reference.price,
      impliedDexPrice: quote.reference.impliedDexPrice,
      deviationBps: quote.reference.deviationBps,
      maxDeviationBps: quote.reference.maxDeviationBps,
      oracleUpdatedAt: quote.reference.updatedAt,
      oracleHeartbeat: quote.reference.heartbeat,
    };
  });
  return {
    schema: DEPTH_MEMORY_SCHEMA,
    id: `${asset}:${completedAt}`,
    asset,
    startedAt,
    completedAt,
    slippageBps: 50,
    points: historicalPoints,
  };
}

export function highestHistoricalPass(scan: DepthMemoryScan) {
  return [...scan.points]
    .filter((point) => point.status === "passed-then")
    .sort((left, right) => Number(right.amount) - Number(left.amount))[0] ?? null;
}

export function compareDepthMemory(
  current: DepthMemoryScan,
  previous: DepthMemoryScan,
): DepthMemoryComparison | null {
  if (current.asset !== previous.asset || current.id === previous.id) return null;
  const previousByAmount = new Map(previous.points.map((point) => [point.amount, point]));
  const points = current.points.map((currentPoint): DepthMemoryComparisonPoint => {
    const previousPoint = previousByAmount.get(currentPoint.amount)!;
    const previousPassed = previousPoint.status === "passed-then";
    const currentPassed = currentPoint.status === "passed-then";
    const transition: DepthMemoryTransition = previousPassed && currentPassed
      ? "both-passed"
      : !previousPassed && currentPassed
        ? "appeared"
        : "unresolved";
    return {
      amount: currentPoint.amount,
      previous: previousPoint,
      current: currentPoint,
      transition,
      deviationDeltaBps: transition === "both-passed"
        ? currentPoint.deviationBps! - previousPoint.deviationBps!
        : null,
      outputDeltaBps: transition === "both-passed"
        ? decimalDeltaBps(currentPoint.estimatedOutput!, previousPoint.estimatedOutput!)
        : null,
      protocolChanged: transition === "both-passed" && currentPoint.protocol !== previousPoint.protocol,
    };
  });
  return {
    asset: current.asset,
    previousId: previous.id,
    currentId: current.id,
    points,
    appearedCount: points.filter((point) => point.transition === "appeared").length,
    notReobservedCount: points.filter((point) => (
      point.previous.status === "passed-then" && point.current.status !== "passed-then"
    )).length,
    comparableCount: points.filter((point) => point.transition === "both-passed").length,
  };
}
