import { sha256, toUtf8Bytes } from "ethers";

/**
 * Trust boundary: this module is a deterministic policy evaluator, not a report
 * verifier or network collector. `BellLockObservation` must be constructed by a
 * trusted server-side collector after raw Data Streams verification and
 * server-side route simulation. Never pass public request bodies directly to
 * `evaluateBellLock` and treat its SHA-256 digest as integrity, not identity.
 */

export const BELL_LOCK_POLICY_SCHEMA = "hoodflow.belllock.policy.v1" as const;
export const BELL_LOCK_OBSERVATION_SCHEMA = "hoodflow.belllock.observation.v1" as const;
export const BELL_PROOF_SCHEMA = "hoodflow.bellproof.v1" as const;
export const REFUSAL_PROOF_SCHEMA = "hoodflow.refusalproof.v1" as const;
export const BELL_LOCK_CHAIN_ID = 4663 as const;

const MAX_STRING_LENGTH = 256;
const MAX_SOURCE_COUNT = 32;
const MAX_PRICE_OBSERVATIONS = 8;
const MAX_REVIEWED_ROUTES = 32;
const MAX_POLICY_LIFETIME_MS = 31 * 24 * 60 * 60_000;
const MAX_UINT256 = (1n << 256n) - 1n;
const RFC_3339_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export type BellLockState = "armed" | "warming" | "blocked" | "ready" | "expired";
export type BellLockSide = "buy" | "sell";
export type BellLockSourceKind =
  | "chainlink-data-streams"
  | "robinhood-stock-token-api"
  | "erc-8056"
  | "hoodflow-route-scan";
export type BellLockSourceAssurance =
  | "cryptographically-verified"
  | "official-api-observation"
  | "onchain-read"
  | "reviewed-route-evaluation";

export type BellLockVerifierReceipt = {
  verifier: "robinhood-chain-data-streams-verifier";
  chainId: typeof BELL_LOCK_CHAIN_ID;
  subject: "market-session" | "equity-price" | "previous-close";
  feedId: string;
  reportId: string;
  reportDigest: string;
  verifiedAt: string;
  expiresAt: string;
  priceDecimals: number | null;
};

export type BellLockProvenance = {
  id: string;
  kind: BellLockSourceKind;
  assurance: BellLockSourceAssurance;
  label: string;
  reference: string;
  observedAt: string;
  verifierReceipt: BellLockVerifierReceipt | null;
};

export type BellLockPolicy = {
  schema: typeof BELL_LOCK_POLICY_SCHEMA;
  policyId: string;
  chainId: typeof BELL_LOCK_CHAIN_ID;
  asset: string;
  side: BellLockSide;
  armedAt: string;
  expiresAt: string;
  input: {
    token: string;
    decimals: number;
    exactRaw: string;
    stressRaw: string;
  };
  thresholds: {
    sessionMaxAgeMs: number;
    observationMaxAgeMs: number;
    minObservationSpacingMs: number;
    maxConvergenceBps: number;
    maxOpeningGapBps: number;
    maxSpreadBps: number;
    maxOracleDexDeviationBps: number;
    maxExactPriceImpactBps: number;
    maxStressPriceImpactBps: number;
    signatureWindowMs: number;
  };
};

export type BellLockAssetEvidence = {
  status: "active" | "inactive" | "unknown";
  tradingHalt: boolean | null;
  corporateAction: "clear" | "pending" | "active" | "unknown";
  pendingMultiplier: "none" | "consistent" | "conflict" | "unknown";
  source: BellLockProvenance;
  multiplierSource: BellLockProvenance;
};

export type BellLockSessionEvidence = {
  state: "open" | "closed" | "unknown";
  transition: "offline-to-active" | "active" | "none" | "unknown";
  signatureVerified: boolean;
  reportId: string;
  observedAt: string;
  openedAt: string | null;
  source: BellLockProvenance;
  previousReport: {
    state: "closed";
    reportId: string;
    observedAt: string;
    source: BellLockProvenance;
  } | null;
};

export type BellLockPricePoint = {
  id: string;
  observedAt: string;
  oraclePriceRaw: string;
  dexPriceRaw: string;
  bidRaw: string;
  askRaw: string;
  oracleSource: BellLockProvenance;
  dexSource: BellLockProvenance;
  issuerSource: BellLockProvenance;
};

export type BellLockDepthPoint = {
  status: "available" | "unavailable" | "rate-limited" | "error";
  inputRaw: string;
  priceImpactBps: number | null;
  minimumOutputRaw: string | null;
  quoteExpiresAt: string | null;
  selectedRouteId: string | null;
  reviewedRouteIds: string[];
  source: BellLockProvenance;
};

export type BellLockObservation = {
  schema: typeof BELL_LOCK_OBSERVATION_SCHEMA;
  capturedAt: string;
  asset: string;
  chainId: typeof BELL_LOCK_CHAIN_ID;
  priceDecimals: number;
  assetEvidence: BellLockAssetEvidence;
  sessionEvidence: BellLockSessionEvidence;
  previousClose: {
    priceRaw: string;
    observedAt: string;
    source: BellLockProvenance;
  };
  prices: BellLockPricePoint[];
  depth: {
    exactSize: BellLockDepthPoint;
    stressSize: BellLockDepthPoint;
  };
};

export type BellLockCheck = {
  code: string;
  status: "pass" | "wait" | "block";
  label: string;
  detail: string;
  sourceIds: string[];
};

export type BellLockMetricSummary = {
  openingGapBps: number | null;
  openingGapAbsoluteBps: number | null;
  convergenceBps: number | null;
  spreadBps: number | null;
  oracleDexDeviationBps: number | null;
  exactPriceImpactBps: number | null;
  stressPriceImpactBps: number | null;
};

export type BellLockExecutionScope = {
  claim: "selected-from-reviewed-route-set";
  globalBestExecutionClaimed: false;
  selectedRouteId: string | null;
  reviewedRouteIds: string[];
  notice: string;
};

type ProofBase = {
  generatedAt: string;
  chainId: typeof BELL_LOCK_CHAIN_ID;
  asset: string;
  side: BellLockSide;
  policyId: string;
  policyDigest: string;
  checks: BellLockCheck[];
  metrics: BellLockMetricSummary;
  sources: BellLockProvenance[];
  executionScope: BellLockExecutionScope;
  custody: "self-custody";
  requiresFreshUserSignature: true;
  capabilities: {
    signs: false;
    submitsTransaction: false;
    requestsWalletPermission: false;
  };
  integrity: {
    algorithm: "SHA-256";
    digest: string;
    scope: "bell-lock-evaluation";
    authenticatesPublisher: false;
  };
};

export type BellProof = ProofBase & {
  schema: typeof BELL_PROOF_SCHEMA;
  kind: "bell-proof";
  state: "ready";
  validUntil: string;
  observations: {
    previousCloseRaw: string;
    firstVerifiedPriceRaw: string;
    confirmationPriceRaw: string;
    firstObservedAt: string;
    confirmationObservedAt: string;
    sessionReportId: string;
  };
  depth: {
    exactInputRaw: string;
    exactMinimumOutputRaw: string;
    stressInputRaw: string;
    stressMinimumOutputRaw: string;
  };
  notice: string;
};

export type RefusalProof = ProofBase & {
  schema: typeof REFUSAL_PROOF_SCHEMA;
  kind: "refusal-proof";
  state: Exclude<BellLockState, "ready">;
  reasons: Array<{
    code: string;
    status: "wait" | "block";
    message: string;
    sourceIds: string[];
  }>;
  notice: string;
};

export type BellLockProof = BellProof | RefusalProof;

export type BellLockEvaluationInput = {
  policy: unknown;
  observation: unknown;
  evaluatedAt: string;
};

export type BellLockEvaluation = {
  state: BellLockState;
  checks: BellLockCheck[];
  metrics: BellLockMetricSummary;
  proof: BellLockProof;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
  const allowed = new Set(expected);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = expected.filter((key) => !Object.hasOwn(value, key));
  if (unexpected.length || missing.length) {
    throw new TypeError(`${label} has invalid fields.`);
  }
}

function boundedString(value: unknown, label: string, pattern?: RegExp, max = MAX_STRING_LENGTH) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max || (pattern && !pattern.test(normalized))) {
    throw new TypeError(`${label} is invalid.`);
  }
  return normalized;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value as T;
}

function integer(value: unknown, label: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new TypeError(`${label} is outside its allowed bounds.`);
  }
  return value as number;
}

function boolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean.`);
  return value;
}

function nullableBoolean(value: unknown, label: string) {
  return value === null ? null : boolean(value, label);
}

function rawInteger(value: unknown, label: string, positive = true) {
  const pattern = positive ? /^[1-9][0-9]{0,77}$/ : /^(?:0|[1-9][0-9]{0,77})$/;
  const raw = boundedString(value, label, pattern, 78);
  if (BigInt(raw) > MAX_UINT256) throw new TypeError(`${label} exceeds uint256.`);
  return raw;
}

function isoTimestamp(value: unknown, label: string) {
  const candidate = boundedString(value, label, undefined, 96);
  if (!RFC_3339_TIMESTAMP.test(candidate)) throw new TypeError(`${label} must be an RFC 3339 timestamp.`);
  const time = Date.parse(candidate);
  if (!Number.isFinite(time)) throw new TypeError(`${label} must be an ISO timestamp.`);
  return new Date(time).toISOString();
}

function nullableIsoTimestamp(value: unknown, label: string) {
  return value === null ? null : isoTimestamp(value, label);
}

function nullableString(value: unknown, label: string, pattern?: RegExp, max = MAX_STRING_LENGTH) {
  return value === null ? null : boundedString(value, label, pattern, max);
}

function nullableInteger(value: unknown, label: string, minimum: number, maximum: number) {
  return value === null ? null : integer(value, label, minimum, maximum);
}

const SOURCE_KINDS = [
  "chainlink-data-streams",
  "robinhood-stock-token-api",
  "erc-8056",
  "hoodflow-route-scan",
] as const;
const SOURCE_ASSURANCES = [
  "cryptographically-verified",
  "official-api-observation",
  "onchain-read",
  "reviewed-route-evaluation",
] as const;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;

function sanitizeProvenance(value: unknown, label: string): BellLockProvenance {
  const item = record(value, label);
  exactKeys(item, ["id", "kind", "assurance", "label", "reference", "observedAt", "verifierReceipt"], label);
  const source: BellLockProvenance = {
    id: boundedString(item.id, `${label}.id`, IDENTIFIER, 128),
    kind: enumValue(item.kind, SOURCE_KINDS, `${label}.kind`),
    assurance: enumValue(item.assurance, SOURCE_ASSURANCES, `${label}.assurance`),
    label: boundedString(item.label, `${label}.label`, undefined, 96),
    reference: boundedString(item.reference, `${label}.reference`, undefined, 256),
    observedAt: isoTimestamp(item.observedAt, `${label}.observedAt`),
    verifierReceipt: item.verifierReceipt === null
      ? null
      : sanitizeVerifierReceipt(item.verifierReceipt, `${label}.verifierReceipt`),
  };
  const expectedAssurance: Record<BellLockSourceKind, BellLockSourceAssurance> = {
    "chainlink-data-streams": "cryptographically-verified",
    "robinhood-stock-token-api": "official-api-observation",
    "erc-8056": "onchain-read",
    "hoodflow-route-scan": "reviewed-route-evaluation",
  };
  if (source.assurance !== expectedAssurance[source.kind]) {
    throw new TypeError(`${label} has inconsistent source assurance.`);
  }
  if (source.kind === "chainlink-data-streams") {
    if (!source.verifierReceipt || source.reference !== source.verifierReceipt.reportDigest) {
      throw new TypeError(`${label} is not bound to a Data Streams verifier receipt.`);
    }
    if (Date.parse(source.verifierReceipt.verifiedAt) < Date.parse(source.observedAt)) {
      throw new TypeError(`${label} was allegedly verified before it was observed.`);
    }
  } else if (source.verifierReceipt !== null) {
    throw new TypeError(`${label} cannot attach a Data Streams verifier receipt.`);
  }
  return source;
}

function sanitizeVerifierReceipt(value: unknown, label: string): BellLockVerifierReceipt {
  const receipt = record(value, label);
  exactKeys(receipt, [
    "verifier",
    "chainId",
    "subject",
    "feedId",
    "reportId",
    "reportDigest",
    "verifiedAt",
    "expiresAt",
    "priceDecimals",
  ], label);
  if (receipt.verifier !== "robinhood-chain-data-streams-verifier" || receipt.chainId !== BELL_LOCK_CHAIN_ID) {
    throw new TypeError(`${label} verifier binding is invalid.`);
  }
  const verifiedAt = isoTimestamp(receipt.verifiedAt, `${label}.verifiedAt`);
  const expiresAt = isoTimestamp(receipt.expiresAt, `${label}.expiresAt`);
  if (Date.parse(expiresAt) <= Date.parse(verifiedAt)) throw new TypeError(`${label} expiry is invalid.`);
  return {
    verifier: "robinhood-chain-data-streams-verifier",
    chainId: BELL_LOCK_CHAIN_ID,
    subject: enumValue(receipt.subject, ["market-session", "equity-price", "previous-close"], `${label}.subject`),
    feedId: boundedString(receipt.feedId, `${label}.feedId`, /^0x[a-fA-F0-9]{64}$/, 66).toLowerCase(),
    reportId: boundedString(receipt.reportId, `${label}.reportId`, IDENTIFIER, 128),
    reportDigest: boundedString(receipt.reportDigest, `${label}.reportDigest`, /^0x[a-fA-F0-9]{64}$/, 66).toLowerCase(),
    verifiedAt,
    expiresAt,
    priceDecimals: receipt.priceDecimals === null
      ? null
      : integer(receipt.priceDecimals, `${label}.priceDecimals`, 0, 36),
  };
}

export function sanitizeBellLockPolicy(value: unknown): BellLockPolicy {
  const policy = record(value, "BellLock policy");
  exactKeys(policy, ["schema", "policyId", "chainId", "asset", "side", "armedAt", "expiresAt", "input", "thresholds"], "BellLock policy");
  if (policy.schema !== BELL_LOCK_POLICY_SCHEMA) throw new TypeError("BellLock policy schema is unsupported.");
  if (policy.chainId !== BELL_LOCK_CHAIN_ID) throw new TypeError("BellLock only supports Robinhood Chain mainnet.");

  const input = record(policy.input, "BellLock policy input");
  exactKeys(input, ["token", "decimals", "exactRaw", "stressRaw"], "BellLock policy input");
  const thresholds = record(policy.thresholds, "BellLock policy thresholds");
  exactKeys(thresholds, [
    "sessionMaxAgeMs",
    "observationMaxAgeMs",
    "minObservationSpacingMs",
    "maxConvergenceBps",
    "maxOpeningGapBps",
    "maxSpreadBps",
    "maxOracleDexDeviationBps",
    "maxExactPriceImpactBps",
    "maxStressPriceImpactBps",
    "signatureWindowMs",
  ], "BellLock policy thresholds");

  const armedAt = isoTimestamp(policy.armedAt, "BellLock policy armedAt");
  const expiresAt = isoTimestamp(policy.expiresAt, "BellLock policy expiresAt");
  const armedMs = Date.parse(armedAt);
  const expiresMs = Date.parse(expiresAt);
  if (expiresMs <= armedMs || expiresMs - armedMs > MAX_POLICY_LIFETIME_MS) {
    throw new TypeError("BellLock policy lifetime is invalid.");
  }

  const sanitized: BellLockPolicy = {
    schema: BELL_LOCK_POLICY_SCHEMA,
    policyId: boundedString(policy.policyId, "BellLock policyId", IDENTIFIER, 128),
    chainId: BELL_LOCK_CHAIN_ID,
    asset: boundedString(policy.asset, "BellLock asset", SYMBOL, 32),
    side: enumValue(policy.side, ["buy", "sell"], "BellLock side"),
    armedAt,
    expiresAt,
    input: {
      token: boundedString(input.token, "BellLock input token", SYMBOL, 32),
      decimals: integer(input.decimals, "BellLock input decimals", 0, 36),
      exactRaw: rawInteger(input.exactRaw, "BellLock exact input"),
      stressRaw: rawInteger(input.stressRaw, "BellLock stress input"),
    },
    thresholds: {
      sessionMaxAgeMs: integer(thresholds.sessionMaxAgeMs, "sessionMaxAgeMs", 1_000, 15 * 60_000),
      observationMaxAgeMs: integer(thresholds.observationMaxAgeMs, "observationMaxAgeMs", 1_000, 15 * 60_000),
      minObservationSpacingMs: integer(thresholds.minObservationSpacingMs, "minObservationSpacingMs", 1, 5 * 60_000),
      maxConvergenceBps: integer(thresholds.maxConvergenceBps, "maxConvergenceBps", 0, 5_000),
      maxOpeningGapBps: integer(thresholds.maxOpeningGapBps, "maxOpeningGapBps", 0, 10_000),
      maxSpreadBps: integer(thresholds.maxSpreadBps, "maxSpreadBps", 0, 5_000),
      maxOracleDexDeviationBps: integer(thresholds.maxOracleDexDeviationBps, "maxOracleDexDeviationBps", 0, 5_000),
      maxExactPriceImpactBps: integer(thresholds.maxExactPriceImpactBps, "maxExactPriceImpactBps", 0, 5_000),
      maxStressPriceImpactBps: integer(thresholds.maxStressPriceImpactBps, "maxStressPriceImpactBps", 0, 5_000),
      signatureWindowMs: integer(thresholds.signatureWindowMs, "signatureWindowMs", 1_000, 5 * 60_000),
    },
  };
  if (BigInt(sanitized.input.stressRaw) <= BigInt(sanitized.input.exactRaw)) {
    throw new TypeError("BellLock stress input must be larger than the exact input.");
  }
  return sanitized;
}

function sanitizeDepthPoint(value: unknown, label: string): BellLockDepthPoint {
  const point = record(value, label);
  exactKeys(point, [
    "status",
    "inputRaw",
    "priceImpactBps",
    "minimumOutputRaw",
    "quoteExpiresAt",
    "selectedRouteId",
    "reviewedRouteIds",
    "source",
  ], label);
  if (!Array.isArray(point.reviewedRouteIds) || point.reviewedRouteIds.length > MAX_REVIEWED_ROUTES) {
    throw new TypeError(`${label}.reviewedRouteIds is invalid.`);
  }
  const reviewedRouteIds = point.reviewedRouteIds.map((item, index) =>
    boundedString(item, `${label}.reviewedRouteIds[${index}]`, IDENTIFIER, 128));
  if (new Set(reviewedRouteIds).size !== reviewedRouteIds.length) {
    throw new TypeError(`${label}.reviewedRouteIds must be unique.`);
  }
  return {
    status: enumValue(point.status, ["available", "unavailable", "rate-limited", "error"], `${label}.status`),
    inputRaw: rawInteger(point.inputRaw, `${label}.inputRaw`),
    priceImpactBps: nullableInteger(point.priceImpactBps, `${label}.priceImpactBps`, 0, 10_000),
    minimumOutputRaw: point.minimumOutputRaw === null ? null : rawInteger(point.minimumOutputRaw, `${label}.minimumOutputRaw`),
    quoteExpiresAt: nullableIsoTimestamp(point.quoteExpiresAt, `${label}.quoteExpiresAt`),
    selectedRouteId: nullableString(point.selectedRouteId, `${label}.selectedRouteId`, IDENTIFIER, 128),
    reviewedRouteIds,
    source: sanitizeProvenance(point.source, `${label}.source`),
  };
}

function sanitizePricePoint(value: unknown, label: string): BellLockPricePoint {
  const point = record(value, label);
  exactKeys(point, [
    "id",
    "observedAt",
    "oraclePriceRaw",
    "dexPriceRaw",
    "bidRaw",
    "askRaw",
    "oracleSource",
    "dexSource",
    "issuerSource",
  ], label);
  return {
    id: boundedString(point.id, `${label}.id`, IDENTIFIER, 128),
    observedAt: isoTimestamp(point.observedAt, `${label}.observedAt`),
    oraclePriceRaw: rawInteger(point.oraclePriceRaw, `${label}.oraclePriceRaw`),
    dexPriceRaw: rawInteger(point.dexPriceRaw, `${label}.dexPriceRaw`),
    bidRaw: rawInteger(point.bidRaw, `${label}.bidRaw`),
    askRaw: rawInteger(point.askRaw, `${label}.askRaw`),
    oracleSource: sanitizeProvenance(point.oracleSource, `${label}.oracleSource`),
    dexSource: sanitizeProvenance(point.dexSource, `${label}.dexSource`),
    issuerSource: sanitizeProvenance(point.issuerSource, `${label}.issuerSource`),
  };
}

export function sanitizeBellLockObservation(value: unknown): BellLockObservation {
  const observation = record(value, "BellLock observation");
  exactKeys(observation, [
    "schema",
    "capturedAt",
    "asset",
    "chainId",
    "priceDecimals",
    "assetEvidence",
    "sessionEvidence",
    "previousClose",
    "prices",
    "depth",
  ], "BellLock observation");
  if (observation.schema !== BELL_LOCK_OBSERVATION_SCHEMA) throw new TypeError("BellLock observation schema is unsupported.");
  if (observation.chainId !== BELL_LOCK_CHAIN_ID) throw new TypeError("BellLock observation chain is unsupported.");

  const assetEvidence = record(observation.assetEvidence, "BellLock asset evidence");
  exactKeys(assetEvidence, ["status", "tradingHalt", "corporateAction", "pendingMultiplier", "source", "multiplierSource"], "BellLock asset evidence");
  const sessionEvidence = record(observation.sessionEvidence, "BellLock session evidence");
  exactKeys(sessionEvidence, ["state", "transition", "signatureVerified", "reportId", "observedAt", "openedAt", "source", "previousReport"], "BellLock session evidence");
  const previousClose = record(observation.previousClose, "BellLock previous close");
  exactKeys(previousClose, ["priceRaw", "observedAt", "source"], "BellLock previous close");
  const depth = record(observation.depth, "BellLock depth evidence");
  exactKeys(depth, ["exactSize", "stressSize"], "BellLock depth evidence");
  if (!Array.isArray(observation.prices) || observation.prices.length > MAX_PRICE_OBSERVATIONS) {
    throw new TypeError("BellLock prices must be a bounded array.");
  }

  let previousSessionReport: BellLockSessionEvidence["previousReport"] = null;
  if (sessionEvidence.previousReport !== null) {
    const previousReport = record(sessionEvidence.previousReport, "BellLock previous session report");
    exactKeys(previousReport, ["state", "reportId", "observedAt", "source"], "BellLock previous session report");
    if (previousReport.state !== "closed") throw new TypeError("BellLock previous session report must be closed.");
    previousSessionReport = {
      state: "closed",
      reportId: boundedString(previousReport.reportId, "previous session reportId", IDENTIFIER, 128),
      observedAt: isoTimestamp(previousReport.observedAt, "previous session observedAt"),
      source: sanitizeProvenance(previousReport.source, "BellLock previous session source"),
    };
  }

  return {
    schema: BELL_LOCK_OBSERVATION_SCHEMA,
    capturedAt: isoTimestamp(observation.capturedAt, "BellLock capturedAt"),
    asset: boundedString(observation.asset, "BellLock observation asset", SYMBOL, 32),
    chainId: BELL_LOCK_CHAIN_ID,
    priceDecimals: integer(observation.priceDecimals, "BellLock price decimals", 0, 36),
    assetEvidence: {
      status: enumValue(assetEvidence.status, ["active", "inactive", "unknown"], "asset status"),
      tradingHalt: nullableBoolean(assetEvidence.tradingHalt, "trading halt"),
      corporateAction: enumValue(assetEvidence.corporateAction, ["clear", "pending", "active", "unknown"], "corporate action"),
      pendingMultiplier: enumValue(assetEvidence.pendingMultiplier, ["none", "consistent", "conflict", "unknown"], "pending multiplier"),
      source: sanitizeProvenance(assetEvidence.source, "BellLock asset source"),
      multiplierSource: sanitizeProvenance(assetEvidence.multiplierSource, "BellLock multiplier source"),
    },
    sessionEvidence: {
      state: enumValue(sessionEvidence.state, ["open", "closed", "unknown"], "session state"),
      transition: enumValue(sessionEvidence.transition, ["offline-to-active", "active", "none", "unknown"], "session transition"),
      signatureVerified: boolean(sessionEvidence.signatureVerified, "session signatureVerified"),
      reportId: boundedString(sessionEvidence.reportId, "session reportId", IDENTIFIER, 128),
      observedAt: isoTimestamp(sessionEvidence.observedAt, "session observedAt"),
      openedAt: nullableIsoTimestamp(sessionEvidence.openedAt, "session openedAt"),
      source: sanitizeProvenance(sessionEvidence.source, "BellLock session source"),
      previousReport: previousSessionReport,
    },
    previousClose: {
      priceRaw: rawInteger(previousClose.priceRaw, "previous close price"),
      observedAt: isoTimestamp(previousClose.observedAt, "previous close observedAt"),
      source: sanitizeProvenance(previousClose.source, "previous close source"),
    },
    prices: observation.prices.map((item, index) => sanitizePricePoint(item, `BellLock prices[${index}]`)),
    depth: {
      exactSize: sanitizeDepthPoint(depth.exactSize, "BellLock exact depth"),
      stressSize: sanitizeDepthPoint(depth.stressSize, "BellLock stress depth"),
    },
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

export function canonicalBellLockJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export function bellLockDigest(value: unknown) {
  return sha256(toUtf8Bytes(canonicalBellLockJson(value)));
}

function ceilDivision(numerator: bigint, denominator: bigint) {
  return (numerator + denominator - 1n) / denominator;
}

function absoluteBps(value: bigint, reference: bigint) {
  if (reference <= 0n) return null;
  const delta = value >= reference ? value - reference : reference - value;
  return Number(ceilDivision(delta * 10_000n, reference));
}

function signedBps(value: bigint, reference: bigint) {
  if (reference <= 0n) return null;
  return Number((value - reference) * 10_000n / reference);
}

function spreadBps(bid: bigint, ask: bigint) {
  if (bid <= 0n || ask < bid) return null;
  return Number(ceilDivision((ask - bid) * 20_000n, ask + bid));
}

function uniqueSources(observation: BellLockObservation) {
  const values = [
    observation.assetEvidence.source,
    observation.assetEvidence.multiplierSource,
    observation.sessionEvidence.source,
    ...(observation.sessionEvidence.previousReport ? [observation.sessionEvidence.previousReport.source] : []),
    observation.previousClose.source,
    ...observation.prices.flatMap((point) => [point.oracleSource, point.dexSource, point.issuerSource]),
    observation.depth.exactSize.source,
    observation.depth.stressSize.source,
  ];
  const byId = new Map<string, BellLockProvenance>();
  for (const source of values) {
    const previous = byId.get(source.id);
    if (previous && canonicalBellLockJson(previous) !== canonicalBellLockJson(source)) {
      throw new TypeError(`BellLock source id ${source.id} has conflicting provenance.`);
    }
    byId.set(source.id, source);
  }
  if (byId.size > MAX_SOURCE_COUNT) throw new TypeError("BellLock provenance exceeds its source bound.");
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function check(
  checks: BellLockCheck[],
  code: string,
  status: BellLockCheck["status"],
  label: string,
  detail: string,
  sourceIds: string[],
) {
  checks.push({ code, status, label, detail, sourceIds: [...new Set(sourceIds)].sort() });
}

function evaluateDepth(
  checks: BellLockCheck[],
  label: "exact" | "stress",
  point: BellLockDepthPoint,
  expectedInputRaw: string,
  maxImpactBps: number,
  nowMs: number,
  maxSourceAgeMs: number,
) {
  const codePrefix = label === "exact" ? "EXACT_SIZE" : "STRESS_SIZE";
  const sourceIds = [point.source.id];
  if (
    point.source.kind !== "hoodflow-route-scan"
    || point.source.assurance !== "reviewed-route-evaluation"
  ) {
    check(checks, `${codePrefix}_PROVENANCE`, "block", `${label} size provenance`, "Depth evidence is not a HoodFlow reviewed-route evaluation.", sourceIds);
    return;
  }
  const sourceAge = nowMs - Date.parse(point.source.observedAt);
  if (sourceAge < 0 || sourceAge > maxSourceAgeMs) {
    check(checks, `${codePrefix}_SOURCE_STALE`, "block", `${label} size provenance freshness`, "Depth evidence provenance is stale or future-dated.", sourceIds);
    return;
  }
  if (point.inputRaw !== expectedInputRaw) {
    check(checks, `${codePrefix}_INPUT_MISMATCH`, "block", `${label} size input`, "Depth evidence does not match the policy input.", sourceIds);
    return;
  }
  if (point.status !== "available") {
    check(checks, `${codePrefix}_DEPTH_UNAVAILABLE`, "block", `${label} size depth`, "A fresh executable depth quote is unavailable.", sourceIds);
    return;
  }
  if (
    point.priceImpactBps === null
    || point.minimumOutputRaw === null
    || point.quoteExpiresAt === null
    || point.selectedRouteId === null
    || point.reviewedRouteIds.length === 0
  ) {
    check(checks, `${codePrefix}_DEPTH_INCOMPLETE`, "block", `${label} size depth`, "Available depth evidence is incomplete.", sourceIds);
    return;
  }
  if (!point.reviewedRouteIds.includes(point.selectedRouteId)) {
    check(checks, `${codePrefix}_ROUTE_SCOPE_INVALID`, "block", `${label} size route scope`, "The selected route is not in the reviewed route set.", sourceIds);
    return;
  }
  if (Date.parse(point.quoteExpiresAt) <= nowMs) {
    check(checks, `${codePrefix}_QUOTE_EXPIRED`, "block", `${label} size quote freshness`, "The reviewed depth quote has expired.", sourceIds);
    return;
  }
  if (point.priceImpactBps > maxImpactBps) {
    check(checks, `${codePrefix}_PRICE_IMPACT`, "block", `${label} size price impact`, `Price impact ${point.priceImpactBps} bps exceeds the ${maxImpactBps} bps policy limit.`, sourceIds);
    return;
  }
  check(checks, `${codePrefix}_DEPTH`, "pass", `${label} size depth`, `Reviewed depth passed at ${point.priceImpactBps} bps price impact.`, sourceIds);
}

function executionScope(observation: BellLockObservation): BellLockExecutionScope {
  const point = observation.depth.exactSize;
  return {
    claim: "selected-from-reviewed-route-set",
    globalBestExecutionClaimed: false,
    selectedRouteId: point.selectedRouteId,
    reviewedRouteIds: [...point.reviewedRouteIds].sort(),
    notice: "Route selection is limited to HoodFlow's explicitly reviewed route set at the observed time; it is not a claim of global best execution.",
  };
}

function proofBase(
  policy: BellLockPolicy,
  observation: BellLockObservation,
  generatedAt: string,
  checks: BellLockCheck[],
  metrics: BellLockMetricSummary,
) {
  return {
    generatedAt,
    chainId: BELL_LOCK_CHAIN_ID,
    asset: policy.asset,
    side: policy.side,
    policyId: policy.policyId,
    policyDigest: bellLockDigest(policy),
    checks,
    metrics,
    sources: uniqueSources(observation),
    executionScope: executionScope(observation),
    custody: "self-custody" as const,
    requiresFreshUserSignature: true as const,
    capabilities: {
      signs: false as const,
      submitsTransaction: false as const,
      requestsWalletPermission: false as const,
    },
  };
}

function finalizeProof<T extends Omit<BellLockProof, "integrity">>(proof: T): T & { integrity: ProofBase["integrity"] } {
  return {
    ...proof,
    integrity: {
      algorithm: "SHA-256",
      digest: bellLockDigest(proof),
      scope: "bell-lock-evaluation",
      authenticatesPublisher: false,
    },
  };
}

function asRefusal(
  state: Exclude<BellLockState, "ready">,
  policy: BellLockPolicy,
  observation: BellLockObservation,
  generatedAt: string,
  checks: BellLockCheck[],
  metrics: BellLockMetricSummary,
): RefusalProof {
  const reasons = checks
    .filter((item): item is BellLockCheck & { status: "wait" | "block" } => item.status !== "pass")
    .map((item) => ({ code: item.code, status: item.status, message: item.detail, sourceIds: item.sourceIds }));
  return finalizeProof({
    schema: REFUSAL_PROOF_SCHEMA,
    kind: "refusal-proof",
    state,
    ...proofBase(policy, observation, generatedAt, checks, metrics),
    reasons,
    notice: "No transaction was signed or submitted. This proof records why BellLock did not open a user signature window. Its SHA-256 digest detects mutation but does not authenticate a publisher.",
  });
}

export function evaluateBellLock(input: BellLockEvaluationInput): BellLockEvaluation {
  const policy = sanitizeBellLockPolicy(input.policy);
  const observation = sanitizeBellLockObservation(input.observation);
  const evaluatedAt = isoTimestamp(input.evaluatedAt, "BellLock evaluatedAt");
  const nowMs = Date.parse(evaluatedAt);
  const checks: BellLockCheck[] = [];
  const sources = uniqueSources(observation);
  const metrics: BellLockMetricSummary = {
    openingGapBps: null,
    openingGapAbsoluteBps: null,
    convergenceBps: null,
    spreadBps: null,
    oracleDexDeviationBps: null,
    exactPriceImpactBps: observation.depth.exactSize.priceImpactBps,
    stressPriceImpactBps: observation.depth.stressSize.priceImpactBps,
  };

  if (observation.asset !== policy.asset || observation.chainId !== policy.chainId) {
    check(checks, "POLICY_EVIDENCE_MISMATCH", "block", "Policy binding", "Evidence does not match the policy asset and chain.", []);
  } else {
    check(checks, "POLICY_EVIDENCE_BINDING", "pass", "Policy binding", "Evidence is bound to the policy asset and chain.", []);
  }

  const captureMs = Date.parse(observation.capturedAt);
  check(checks, "EVIDENCE_CAPTURE_TIME", captureMs <= nowMs ? "pass" : "block", "Evidence capture time", captureMs <= nowMs ? "The observation bundle is not future-dated." : "The observation bundle is future-dated.", []);
  const futureSources = sources.filter((source) => Date.parse(source.observedAt) > nowMs);
  check(checks, "SOURCE_TIMESTAMPS", futureSources.length === 0 ? "pass" : "block", "Source timestamps", futureSources.length === 0 ? "All source observations are at or before evaluation time." : "One or more source observations are future-dated.", futureSources.map((source) => source.id));

  if (nowMs < Date.parse(policy.armedAt)) {
    check(checks, "POLICY_NOT_ARMED", "block", "Policy time", "The policy is not armed yet.", []);
  }
  if (nowMs >= Date.parse(policy.expiresAt)) {
    check(checks, "POLICY_EXPIRED", "block", "Policy expiry", "The BellLock policy has expired.", []);
    const proof = asRefusal("expired", policy, observation, evaluatedAt, checks, metrics);
    return { state: "expired", checks, metrics, proof };
  }
  check(checks, "POLICY_ACTIVE", "pass", "Policy expiry", "The BellLock policy is active.", []);

  const assetSources = [observation.assetEvidence.source.id, observation.assetEvidence.multiplierSource.id];
  const assetProvenanceValid = observation.assetEvidence.source.kind === "robinhood-stock-token-api"
    && observation.assetEvidence.source.assurance === "official-api-observation";
  const multiplierProvenanceValid = observation.assetEvidence.multiplierSource.kind === "erc-8056"
    && observation.assetEvidence.multiplierSource.assurance === "onchain-read";
  check(checks, "ASSET_PROVENANCE", assetProvenanceValid ? "pass" : "block", "Asset provenance", assetProvenanceValid ? "Asset state is attributed to the official Robinhood Stock Token API." : "Asset-state provenance is not an official API observation.", [observation.assetEvidence.source.id]);
  check(checks, "MULTIPLIER_PROVENANCE", multiplierProvenanceValid ? "pass" : "block", "Multiplier provenance", multiplierProvenanceValid ? "Multiplier state is attributed to an ERC-8056 onchain read." : "Multiplier provenance is not an ERC-8056 onchain read.", [observation.assetEvidence.multiplierSource.id]);
  const issuerEvidenceAges = [
    nowMs - Date.parse(observation.assetEvidence.source.observedAt),
    nowMs - Date.parse(observation.assetEvidence.multiplierSource.observedAt),
  ];
  const issuerEvidenceFresh = issuerEvidenceAges.every((age) => age >= 0 && age <= policy.thresholds.sessionMaxAgeMs);
  check(checks, "ISSUER_EVIDENCE_FRESHNESS", issuerEvidenceFresh ? "pass" : "block", "Issuer evidence freshness", issuerEvidenceFresh ? "Asset and multiplier observations are fresh." : "Asset or multiplier evidence is stale or future-dated.", assetSources);
  check(checks, "ASSET_ACTIVE", observation.assetEvidence.status === "active" ? "pass" : "block", "Asset status", observation.assetEvidence.status === "active" ? "Official asset state is active." : "Official asset state is not confirmed active.", assetSources);
  check(checks, "TRADING_HALT_CLEAR", observation.assetEvidence.tradingHalt === false ? "pass" : "block", "Trading halt", observation.assetEvidence.tradingHalt === false ? "No trading halt is reported." : "Trading halt state is halted or unknown.", assetSources);
  check(checks, "CORPORATE_ACTION_CLEAR", observation.assetEvidence.corporateAction === "clear" ? "pass" : "block", "Corporate action", observation.assetEvidence.corporateAction === "clear" ? "No conflicting corporate action is reported." : "Corporate-action state is pending, active, or unknown.", assetSources);
  check(checks, "PENDING_MULTIPLIER_CLEAR", ["none", "consistent"].includes(observation.assetEvidence.pendingMultiplier) ? "pass" : "block", "Pending multiplier", ["none", "consistent"].includes(observation.assetEvidence.pendingMultiplier) ? "No pending multiplier conflict is reported." : "Pending multiplier state is conflicting or unknown.", assetSources);

  const session = observation.sessionEvidence;
  const sessionSource = [session.source.id];
  const sessionAge = nowMs - Date.parse(session.observedAt);
  const sessionReceipt = session.source.verifierReceipt;
  const sessionReceiptBound = Boolean(
    sessionReceipt
    && sessionReceipt.subject === "market-session"
    && sessionReceipt.priceDecimals === null
    && sessionReceipt.reportId === session.reportId
    && sessionReceipt.verifiedAt <= evaluatedAt
    && Date.parse(sessionReceipt.expiresAt) > nowMs,
  );
  const sessionSigned = session.signatureVerified
    && session.source.kind === "chainlink-data-streams"
    && session.source.assurance === "cryptographically-verified"
    && sessionReceiptBound;
  check(checks, "SESSION_SIGNATURE", sessionSigned ? "pass" : "block", "Session signature", sessionSigned ? "Market-session evidence is cryptographically verified." : "Cryptographically verified market-session evidence is unavailable.", sessionSource);
  const sessionSourceBound = session.source.observedAt === session.observedAt;
  check(checks, "SESSION_SOURCE_BINDING", sessionSourceBound ? "pass" : "block", "Session source binding", sessionSourceBound ? "The normalized session timestamp matches its verified source timestamp." : "Session evidence timestamp does not match its source provenance.", sessionSource);
  check(checks, "SESSION_FRESHNESS", sessionAge >= 0 && sessionAge <= policy.thresholds.sessionMaxAgeMs ? "pass" : "block", "Session freshness", sessionAge >= 0 && sessionAge <= policy.thresholds.sessionMaxAgeMs ? "Market-session evidence is fresh." : "Market-session evidence is stale or future-dated.", sessionSource);

  if (session.state === "closed" && sessionSigned && sessionAge >= 0 && sessionAge <= policy.thresholds.sessionMaxAgeMs) {
    check(checks, "SESSION_CLOSED", "wait", "Market session", "The verified market session is closed; BellLock remains armed.", sessionSource);
    const state = checks.some((item) => item.status === "block") ? "blocked" : "armed";
    const proof = asRefusal(state, policy, observation, evaluatedAt, checks, metrics);
    return { state, checks, metrics, proof };
  }
  check(checks, "SESSION_OPEN", session.state === "open" ? "pass" : "block", "Market session", session.state === "open" ? "The verified market session is open." : "The market session is not confirmed open.", sessionSource);
  const previousSession = session.previousReport;
  const previousSessionReceipt = previousSession?.source.verifierReceipt ?? null;
  const transitionReportsBound = Boolean(
    previousSession
    && previousSessionReceipt
    && previousSession.source.kind === "chainlink-data-streams"
    && previousSession.source.assurance === "cryptographically-verified"
    && previousSessionReceipt.subject === "market-session"
    && previousSessionReceipt.priceDecimals === null
    && previousSessionReceipt.reportId === previousSession.reportId
    && previousSession.source.observedAt === previousSession.observedAt
    && sessionReceipt
    && previousSessionReceipt.reportId !== sessionReceipt.reportId
    && previousSessionReceipt.reportDigest !== sessionReceipt.reportDigest
    && previousSessionReceipt.feedId === sessionReceipt.feedId
    && Date.parse(previousSession.observedAt) < Date.parse(session.observedAt)
    && previousSessionReceipt.verifiedAt <= evaluatedAt,
  );
  const transitionValid = session.transition === "offline-to-active"
    && session.openedAt !== null
    && transitionReportsBound;
  check(checks, "SESSION_TRANSITION", transitionValid ? "pass" : "block", "Opening transition", transitionValid ? "The offline-to-active transition is recorded." : "The reopening transition is not proven.", sessionSource);
  if (session.openedAt && Date.parse(session.openedAt) > nowMs) {
    check(checks, "SESSION_OPENED_AT", "block", "Opening time", "The reported opening time is future-dated.", sessionSource);
  }
  if (session.openedAt && Date.parse(session.openedAt) < Date.parse(policy.armedAt)) {
    check(checks, "SESSION_TRANSITION_REPLAY", "block", "Opening transition binding", "The recorded opening transition predates this BellLock policy.", sessionSource);
  }
  if (session.openedAt && Date.parse(session.observedAt) < Date.parse(session.openedAt)) {
    check(checks, "SESSION_REPORT_ORDER", "block", "Session report order", "The session report predates its claimed opening time.", sessionSource);
  }
  if (
    session.openedAt
    && previousSession
    && !(Date.parse(previousSession.observedAt) < Date.parse(session.openedAt))
  ) {
    check(checks, "SESSION_TRANSITION_ORDER", "block", "Opening transition order", "The verified closed report does not precede the reported opening time.", [previousSession.source.id, session.source.id]);
  }

  const openedAtMs = session.openedAt ? Date.parse(session.openedAt) : Number.POSITIVE_INFINITY;
  const freshPrices = observation.prices
    .filter((point) => {
      const observedMs = Date.parse(point.observedAt);
      return observedMs >= openedAtMs
        && observedMs <= nowMs
        && nowMs - observedMs <= policy.thresholds.observationMaxAgeMs;
    })
    .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt) || left.id.localeCompare(right.id));
  const distinctPrices = freshPrices.filter((point, index, values) =>
    values.findIndex((candidate) => candidate.id === point.id) === index);
  const first = distinctPrices[0] ?? null;
  const confirmation = distinctPrices.length > 1 ? distinctPrices[distinctPrices.length - 1] : null;
  const priceSourceIds = distinctPrices.flatMap((point) => [point.oracleSource.id, point.dexSource.id, point.issuerSource.id]);
  const spacing = first && confirmation ? Date.parse(confirmation.observedAt) - Date.parse(first.observedAt) : -1;
  const observationsReady = Boolean(
    first
    && confirmation
    && first.id !== confirmation.id
    && spacing >= policy.thresholds.minObservationSpacingMs,
  );
  check(checks, "TWO_FRESH_OBSERVATIONS", observationsReady ? "pass" : "wait", "Price convergence warm-up", observationsReady ? "Two fresh, distinct, sufficiently spaced price observations are available." : "BellLock is waiting for two fresh, distinct price observations.", priceSourceIds);

  if (!observationsReady || !first || !confirmation) {
    const hasBlock = checks.some((item) => item.status === "block");
    const state = hasBlock ? "blocked" : "warming";
    const proof = asRefusal(state, policy, observation, evaluatedAt, checks, metrics);
    return { state, checks, metrics, proof };
  }

  const firstOracle = BigInt(first.oraclePriceRaw);
  const confirmationOracle = BigInt(confirmation.oraclePriceRaw);
  const confirmationDex = BigInt(confirmation.dexPriceRaw);
  const confirmationBid = BigInt(confirmation.bidRaw);
  const confirmationAsk = BigInt(confirmation.askRaw);
  const previousClose = BigInt(observation.previousClose.priceRaw);
  metrics.openingGapBps = signedBps(firstOracle, previousClose);
  metrics.openingGapAbsoluteBps = absoluteBps(firstOracle, previousClose);
  metrics.convergenceBps = absoluteBps(confirmationOracle, firstOracle);
  metrics.spreadBps = spreadBps(confirmationBid, confirmationAsk);
  metrics.oracleDexDeviationBps = absoluteBps(confirmationDex, confirmationOracle);

  const oracleSourcesVerified = [first, confirmation].every((point) =>
    point.oracleSource.kind === "chainlink-data-streams"
    && point.oracleSource.assurance === "cryptographically-verified"
    && point.oracleSource.verifierReceipt?.subject === "equity-price"
    && point.oracleSource.verifierReceipt.priceDecimals === observation.priceDecimals
    && point.oracleSource.verifierReceipt.reportId === point.id
    && point.oracleSource.verifierReceipt.verifiedAt <= evaluatedAt
    && Date.parse(point.oracleSource.verifierReceipt.expiresAt) > nowMs);
  check(checks, "ORACLE_PROVENANCE", oracleSourcesVerified ? "pass" : "block", "Oracle provenance", oracleSourcesVerified ? "Both oracle observations are cryptographically verified." : "Oracle observation provenance is not cryptographically verified.", [first.oracleSource.id, confirmation.oracleSource.id]);
  const priceSourcesTimeBound = [first, confirmation].every((point) => {
    const pointMs = Date.parse(point.observedAt);
    const oracleMs = Date.parse(point.oracleSource.observedAt);
    const dexMs = Date.parse(point.dexSource.observedAt);
    const issuerMs = Date.parse(point.issuerSource.observedAt);
    return oracleMs === pointMs
      && dexMs <= pointMs
      && issuerMs <= pointMs
      && pointMs - dexMs <= policy.thresholds.observationMaxAgeMs
      && pointMs - issuerMs <= policy.thresholds.observationMaxAgeMs;
  });
  check(checks, "PRICE_SOURCE_TIME_BINDING", priceSourcesTimeBound ? "pass" : "block", "Price source time binding", priceSourcesTimeBound ? "Price timestamps are bound to fresh source observations." : "A price timestamp is not bound to its source observation time.", [first.oracleSource.id, first.dexSource.id, first.issuerSource.id, confirmation.oracleSource.id, confirmation.dexSource.id, confirmation.issuerSource.id]);
  const previousCloseVerified = observation.previousClose.source.kind === "chainlink-data-streams"
    && observation.previousClose.source.assurance === "cryptographically-verified"
    && observation.previousClose.source.verifierReceipt?.subject === "previous-close"
    && observation.previousClose.source.verifierReceipt.priceDecimals === observation.priceDecimals;
  check(checks, "PREVIOUS_CLOSE_PROVENANCE", previousCloseVerified ? "pass" : "block", "Previous close provenance", previousCloseVerified ? "The previous close is attributed to a cryptographically verified report." : "Previous-close provenance is not cryptographically verified.", [observation.previousClose.source.id]);
  const previousCloseTimeBound = observation.previousClose.source.observedAt === observation.previousClose.observedAt;
  check(checks, "PREVIOUS_CLOSE_TIME_BINDING", previousCloseTimeBound ? "pass" : "block", "Previous close time binding", previousCloseTimeBound ? "The previous-close timestamp matches its source provenance." : "Previous-close timestamp does not match its source provenance.", [observation.previousClose.source.id]);
  const marketPriceProvenanceValid = [first, confirmation].every((point) =>
    point.dexSource.kind === "hoodflow-route-scan"
    && point.dexSource.assurance === "reviewed-route-evaluation"
    && point.issuerSource.kind === "robinhood-stock-token-api"
    && point.issuerSource.assurance === "official-api-observation");
  check(checks, "MARKET_PRICE_PROVENANCE", marketPriceProvenanceValid ? "pass" : "block", "Market price provenance", marketPriceProvenanceValid ? "DEX and issuer observations have their expected provenance." : "DEX or issuer price provenance is inconsistent.", [first.dexSource.id, first.issuerSource.id, confirmation.dexSource.id, confirmation.issuerSource.id]);
  const firstReceipt = first.oracleSource.verifierReceipt;
  const confirmationReceipt = confirmation.oracleSource.verifierReceipt;
  const previousCloseReceipt = observation.previousClose.source.verifierReceipt;
  const priceReportsBound = Boolean(
    firstReceipt
    && confirmationReceipt
    && previousCloseReceipt
    && firstReceipt.reportId !== confirmationReceipt.reportId
    && firstReceipt.reportDigest !== confirmationReceipt.reportDigest
    && firstReceipt.feedId === confirmationReceipt.feedId
    && firstReceipt.feedId === previousCloseReceipt.feedId
    && firstReceipt.priceDecimals === confirmationReceipt.priceDecimals
    && firstReceipt.priceDecimals === previousCloseReceipt.priceDecimals,
  );
  check(checks, "PRICE_REPORT_BINDING", priceReportsBound ? "pass" : "block", "Price report binding", priceReportsBound ? "The distinct opening reports and previous close share a verified feed and unit scale." : "Price reports are not distinct or do not share a verified feed and unit scale.", [first.oracleSource.id, confirmation.oracleSource.id, observation.previousClose.source.id]);
  const openingObservationDelay = Date.parse(first.observedAt) - openedAtMs;
  check(checks, "OPENING_OBSERVATION_DELAY", openingObservationDelay >= 0 && openingObservationDelay <= policy.thresholds.observationMaxAgeMs ? "pass" : "block", "Opening observation timing", openingObservationDelay >= 0 && openingObservationDelay <= policy.thresholds.observationMaxAgeMs ? "The first verified price is within the policy's opening-observation window." : "The first verified price arrived too late to represent the reopening window.", [first.oracleSource.id, session.source.id]);
  check(checks, "OBSERVATION_CONVERGENCE", metrics.convergenceBps !== null && metrics.convergenceBps <= policy.thresholds.maxConvergenceBps ? "pass" : "block", "Price convergence", metrics.convergenceBps !== null ? `Observed convergence is ${metrics.convergenceBps} bps; policy maximum is ${policy.thresholds.maxConvergenceBps} bps.` : "Price convergence could not be calculated.", [first.oracleSource.id, confirmation.oracleSource.id]);
  check(checks, "OPENING_GAP", metrics.openingGapAbsoluteBps !== null && metrics.openingGapAbsoluteBps <= policy.thresholds.maxOpeningGapBps ? "pass" : "block", "Opening gap", metrics.openingGapAbsoluteBps !== null ? `Absolute opening gap is ${metrics.openingGapAbsoluteBps} bps; policy maximum is ${policy.thresholds.maxOpeningGapBps} bps.` : "Opening gap could not be calculated.", [observation.previousClose.source.id, first.oracleSource.id]);
  check(checks, "BID_ASK_SPREAD", metrics.spreadBps !== null && metrics.spreadBps <= policy.thresholds.maxSpreadBps ? "pass" : "block", "Bid/ask spread", metrics.spreadBps !== null ? `Observed spread is ${metrics.spreadBps} bps; policy maximum is ${policy.thresholds.maxSpreadBps} bps.` : "The bid/ask book is invalid.", [confirmation.issuerSource.id]);
  check(checks, "ORACLE_DEX_DEVIATION", metrics.oracleDexDeviationBps !== null && metrics.oracleDexDeviationBps <= policy.thresholds.maxOracleDexDeviationBps ? "pass" : "block", "Oracle/DEX deviation", metrics.oracleDexDeviationBps !== null ? `Observed deviation is ${metrics.oracleDexDeviationBps} bps; policy maximum is ${policy.thresholds.maxOracleDexDeviationBps} bps.` : "Oracle/DEX deviation could not be calculated.", [confirmation.oracleSource.id, confirmation.dexSource.id]);

  evaluateDepth(checks, "exact", observation.depth.exactSize, policy.input.exactRaw, policy.thresholds.maxExactPriceImpactBps, nowMs, policy.thresholds.observationMaxAgeMs);
  evaluateDepth(checks, "stress", observation.depth.stressSize, policy.input.stressRaw, policy.thresholds.maxStressPriceImpactBps, nowMs, policy.thresholds.observationMaxAgeMs);

  if (checks.some((item) => item.status === "block")) {
    const proof = asRefusal("blocked", policy, observation, evaluatedAt, checks, metrics);
    return { state: "blocked", checks, metrics, proof };
  }

  const validUntilMs = Math.min(
    Date.parse(policy.expiresAt),
    Date.parse(confirmation.observedAt) + policy.thresholds.signatureWindowMs,
    Date.parse(sessionReceipt!.expiresAt),
    Date.parse(firstReceipt!.expiresAt),
    Date.parse(confirmationReceipt!.expiresAt),
    Date.parse(observation.depth.exactSize.quoteExpiresAt!),
    Date.parse(observation.depth.stressSize.quoteExpiresAt!),
  );
  if (validUntilMs <= nowMs) {
    check(checks, "SIGNATURE_WINDOW_EXPIRED", "block", "Signature window", "The fresh user-signature window has expired.", [confirmation.oracleSource.id, observation.depth.exactSize.source.id]);
    const proof = asRefusal("expired", policy, observation, evaluatedAt, checks, metrics);
    return { state: "expired", checks, metrics, proof };
  }
  const validUntil = new Date(validUntilMs).toISOString();
  check(checks, "SIGNATURE_WINDOW", "pass", "Signature window", `A fresh user signature may be requested until ${validUntil}.`, [confirmation.oracleSource.id, observation.depth.exactSize.source.id]);

  const unsigned = {
    schema: BELL_PROOF_SCHEMA,
    kind: "bell-proof" as const,
    state: "ready" as const,
    ...proofBase(policy, observation, evaluatedAt, checks, metrics),
    validUntil,
    observations: {
      previousCloseRaw: observation.previousClose.priceRaw,
      firstVerifiedPriceRaw: first.oraclePriceRaw,
      confirmationPriceRaw: confirmation.oraclePriceRaw,
      firstObservedAt: first.observedAt,
      confirmationObservedAt: confirmation.observedAt,
      sessionReportId: session.reportId,
    },
    depth: {
      exactInputRaw: observation.depth.exactSize.inputRaw,
      exactMinimumOutputRaw: observation.depth.exactSize.minimumOutputRaw!,
      stressInputRaw: observation.depth.stressSize.inputRaw,
      stressMinimumOutputRaw: observation.depth.stressSize.minimumOutputRaw!,
    },
    notice: "BellLock opened a short-lived review window only. HoodFlow did not sign or submit a transaction; the user must review a freshly requoted order and provide the final signature. The SHA-256 digest detects mutation but is not a publisher signature.",
  };
  const proof = finalizeProof(unsigned) as BellProof;
  return { state: "ready", checks, metrics, proof };
}
