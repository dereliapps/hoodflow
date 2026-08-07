import infrastructure from "../config/robinhood-mainnet.json" with { type: "json" };

import { Contract, JsonRpcProvider, formatUnits } from "ethers";

import {
  prepareAgentQuote,
  type AgentQuote,
  type AgentQuoteRequest,
} from "@/lib/hoodflow-agent";
import { ROBINHOOD_MAINNET, ROBINHOOD_TOKENS } from "@/lib/hoodflow-mainnet";

const OFFICIAL_API_ORIGIN = "https://api.robinhood.com";
const OFFICIAL_ASSETS_URL = `${OFFICIAL_API_ORIGIN}/rhj/assets`;
const OFFICIAL_CORPORATE_ACTIONS_URL = `${OFFICIAL_API_ORIGIN}/rhj/corporate-actions`;
const OFFICIAL_SOURCE_LABEL = "Robinhood Stock Token APIs";
const OFFICIAL_ISSUER_NAME = "Robinhood Stock Token API";
const POLICY_ID = "hoodflow-action-lock" as const;
const POLICY_VERSION = "1.0.0" as const;
// Robinhood's public issuer endpoints can take several seconds from edge runtimes
// on a cold connection. Keep the request bounded, but leave enough room for the
// first production verification instead of downgrading healthy evidence to WATCH.
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_OFFICIAL_RESPONSE_CHARS = 2_000_000;
const ASSETS_CACHE_MS = 5 * 60_000;
const PRICES_CACHE_MS = 15_000;
const CORPORATE_ACTIONS_CACHE_MS = 60 * 60_000;
const ONCHAIN_MULTIPLIER_CACHE_MS = 10_000;
const OFFICIAL_PRICE_MAX_AGE_MS = 5 * 60_000;
const OFFICIAL_PRICE_MAX_DIVERGENCE_BPS = 300;

const ERC_8056_MULTIPLIER_ABI = [
  "function uiMultiplier() view returns (uint256)",
  "function newUIMultiplier() view returns (uint256)",
  "function effectiveAt() view returns (uint256)",
] as const;

const OFFICIAL_SYMBOL_ALIASES = infrastructure.onchainSymbolAliases as Readonly<Record<string, string>>;

export type ActionLockDecision = "clear" | "watch" | "blocked";
export type ActionLockCheckStatus = "pass" | "watch" | "block";
export type OfficialEvidenceStatus = "available" | "missing" | "unavailable";

type OfficialDeployment = {
  chainId: number;
  contractAddress: string;
};

export type OfficialTradingCapabilities = {
  fractionalTradability: string | null;
  allDayTradability: string | null;
  extendedHoursFractionalTradability: boolean | null;
  market: { whole: string | null; fractional: string | null } | null;
  extended: { whole: string | null; fractional: string | null } | null;
  overnight: { whole: string | null; fractional: string | null } | null;
};

export type OfficialActionLockAsset = {
  uid: string | null;
  tokenSymbol: string;
  tokenName: string | null;
  deployments: OfficialDeployment[];
  currentMultiplier: string | null;
  pendingMultiplier: string | null;
  pendingMultiplierEffectiveTime: string | null;
  status: string | null;
  tradingCapabilities: OfficialTradingCapabilities | null;
};

export type OfficialActionLockPrice = {
  tokenSymbol: string;
  deployments: OfficialDeployment[];
  bid: string | null;
  ask: string | null;
  currency: string | null;
  isTradingHalt: boolean | null;
  generatedAt: string | null;
};

export type OfficialCorporateAction = {
  id: string | null;
  tokenSymbol: string;
  type: string | null;
  status: string | null;
  effectiveAt: string | null;
  detailKind: string | null;
  detailValues: Record<string, string>;
};

export type OnchainMultiplierState = {
  currentMultiplier: string;
  pendingMultiplier: string;
  effectiveAt: string | null;
};

type EvidenceEnvelope<T> = {
  status: OfficialEvidenceStatus;
  source: string;
  fetchedAt: string;
  value: T | null;
};

export type OfficialActionLockEvidence = {
  asset: EvidenceEnvelope<OfficialActionLockAsset>;
  price: EvidenceEnvelope<OfficialActionLockPrice>;
  corporateActions: EvidenceEnvelope<OfficialCorporateAction[]>;
  onchainMultiplier: EvidenceEnvelope<OnchainMultiplierState>;
};

export type ActionLockCheck = {
  id: string;
  label: string;
  status: ActionLockCheckStatus;
  decision: ActionLockDecision;
  code: string;
  detail: string;
  source: string;
};

export type ActionLockReason = {
  code: string;
  severity: "watch" | "block";
  message: string;
  source: string;
};

export type ActionLockIssuerState = {
  issuerName: string | null;
  symbol: string;
  officialSymbol: string | null;
  marketStatus: "ACTIVE" | "INACTIVE" | "HALTED" | "UNKNOWN";
  officialBid: string | null;
  officialAsk: string | null;
  adjustedBid: string | null;
  adjustedAsk: string | null;
  currency: string | null;
  source: string;
  asOf: string | null;
  currentMultiplier: string | null;
  pendingMultiplier: string | null;
  pendingMultiplierEffectiveTime: string | null;
  tradingCapabilities: OfficialTradingCapabilities | null;
};

export type ActionLockCorporateAction = {
  type: string | null;
  label: string;
  status: string;
  effectiveAt: string | null;
  adjustment: string | null;
  detail: string;
};

type QuoteSnapshot = Omit<AgentQuote, "executionHandoff">;

export type ActionLockPassport = {
  feature: "HoodFlow ActionLock";
  passportVersion: "hoodflow-action-lock/1";
  policyVersion: typeof POLICY_VERSION;
  observedAt: string;
  status: "action-lock-passport";
  decision: ActionLockDecision;
  handoffAllowed: boolean;
  intent: AgentQuoteRequest;
  issuerState: ActionLockIssuerState;
  corporateAction: ActionLockCorporateAction;
  checks: ActionLockCheck[];
  reasons: ActionLockReason[];
  quote: QuoteSnapshot;
  evidence: OfficialActionLockEvidence;
  policy: {
    id: typeof POLICY_ID;
    version: typeof POLICY_VERSION;
    observedAt: string;
    validUntil: string;
  };
  custody: "self-custody";
  requiresUserSignature: true;
  capabilities: {
    signs: false;
    submitsTransaction: false;
    requestsWalletPermission: false;
  };
  executionHandoff: AgentQuote["executionHandoff"] | null;
  stateFingerprint: string;
  fingerprint: string;
};

type ActionLockEvaluation = Pick<
  ActionLockPassport,
  "decision" | "issuerState" | "corporateAction" | "checks" | "reasons"
>;

export type ActionLockPreparationOptions = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  useCache?: boolean;
  prepareQuote?: (request: AgentQuoteRequest) => Promise<AgentQuote>;
  readOnchainMultiplier?: (asset: string) => Promise<OnchainMultiplierState>;
};

type CacheEntry = { expiresAt: number; value: unknown };

const responseCache = new Map<string, CacheEntry>();
const inFlightLoads = new Map<string, Promise<unknown>>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, maxLength = 256): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function nullableString(value: unknown, maxLength = 256): string | null {
  if (value === "") return null;
  return boundedString(value, maxLength);
}

function decimalString(value: unknown): string | null {
  const candidate = boundedString(value, 96);
  return candidate && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(candidate) ? candidate : null;
}

function isoTimestamp(value: unknown): string | null {
  const candidate = boundedString(value, 96);
  if (!candidate) return null;
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function ethereumAddress(value: unknown): string | null {
  const candidate = boundedString(value, 42);
  return candidate && /^0x[0-9a-fA-F]{40}$/.test(candidate) ? candidate : null;
}

function parseDeployment(value: unknown): OfficialDeployment | null {
  const record = asRecord(value);
  if (!record) return null;
  const address = ethereumAddress(record.contractAddress);
  const chainId = typeof record.chainId === "number" ? record.chainId : Number(record.chainId);
  if (!address || !Number.isSafeInteger(chainId) || chainId <= 0) return null;
  return { chainId, contractAddress: address };
}

function parseDeployments(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 16).map(parseDeployment).filter((item): item is OfficialDeployment => Boolean(item));
}

function capabilityPair(value: unknown) {
  const record = asRecord(value);
  if (!record) return null;
  return {
    whole: nullableString(record.whole, 64),
    fractional: nullableString(record.fractional, 64),
  };
}

function parseTradingCapabilities(value: unknown): OfficialTradingCapabilities | null {
  const record = asRecord(value);
  if (!record) return null;
  return {
    fractionalTradability: nullableString(record.fractionalTradability, 64),
    allDayTradability: nullableString(record.allDayTradability, 64),
    extendedHoursFractionalTradability:
      typeof record.extendedHoursFractionalTradability === "boolean"
        ? record.extendedHoursFractionalTradability
        : null,
    market: capabilityPair(record.market),
    extended: capabilityPair(record.extended),
    overnight: capabilityPair(record.overnight),
  };
}

function parseAsset(value: unknown): OfficialActionLockAsset | null {
  const record = asRecord(value);
  const tokenSymbol = record && boundedString(record.tokenSymbol, 32)?.toUpperCase();
  if (!record || !tokenSymbol || !/^[A-Z0-9]{1,32}$/.test(tokenSymbol)) return null;
  const uid = boundedString(record.id, 130);
  return {
    uid: uid && /^0x[0-9a-fA-F]{64}$/.test(uid) ? uid.toLowerCase() : null,
    tokenSymbol,
    tokenName: nullableString(record.tokenName, 180),
    deployments: parseDeployments(record.deployments),
    currentMultiplier: decimalString(record.currentMultiplier),
    pendingMultiplier: decimalString(record.pendingMultiplier),
    pendingMultiplierEffectiveTime: isoTimestamp(record.pendingMultiplierEffectiveTime),
    status: nullableString(record.status, 64),
    tradingCapabilities: parseTradingCapabilities(record.tradingCapabilities),
  };
}

function parseAssetPayload(value: unknown): OfficialActionLockAsset[] {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.assets)) throw new Error("Invalid official asset payload.");
  return record.assets.slice(0, 5_000).map(parseAsset).filter((item): item is OfficialActionLockAsset => Boolean(item));
}

function parsePrice(value: unknown): OfficialActionLockPrice | null {
  const record = asRecord(value);
  const tokenSymbol = record && boundedString(record.tokenSymbol, 32)?.toUpperCase();
  if (!record || !tokenSymbol || !/^[A-Z0-9]{1,32}$/.test(tokenSymbol)) return null;
  return {
    tokenSymbol,
    deployments: parseDeployments(record.deployments),
    bid: decimalString(record.bid),
    ask: decimalString(record.ask),
    currency: nullableString(record.currency, 12),
    isTradingHalt: typeof record.isTradingHalt === "boolean" ? record.isTradingHalt : null,
    generatedAt: isoTimestamp(record.generatedAt),
  };
}

function parsePricePayload(value: unknown): OfficialActionLockPrice[] {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.quotes)) throw new Error("Invalid official price payload.");
  return record.quotes.slice(0, 100).map(parsePrice).filter((item): item is OfficialActionLockPrice => Boolean(item));
}

function processDateTimestamp(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  const year = Number(record.year);
  const month = Number(record.month);
  const day = Number(record.day);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString();
}

const CORPORATE_DETAIL_KEYS = new Set([
  "underlyingSymbol",
  "oldUnderlyingSymbol",
  "newUnderlyingSymbol",
  "sourceUnderlyingSymbol",
  "alternateUnderlyingSymbol",
  "acquirerUnderlyingSymbol",
  "acquireeUnderlyingSymbol",
  "rate",
  "oldRate",
  "newRate",
  "sourceRate",
  "alternateRate",
  "acquirerRate",
  "acquireeRate",
  "cashRate",
]);

function parseCorporateDetails(value: unknown) {
  const details = asRecord(value);
  if (!details) return { detailKind: null, detailValues: {} as Record<string, string> };
  const entry = Object.entries(details)
    .sort(([left], [right]) => left.localeCompare(right))
    .find(([, item]) => Boolean(asRecord(item)));
  if (!entry) return { detailKind: null, detailValues: {} as Record<string, string> };
  const detailRecord = asRecord(entry[1]);
  const detailValues: Record<string, string> = {};
  for (const key of [...CORPORATE_DETAIL_KEYS].sort()) {
    const parsed = detailRecord && boundedString(detailRecord[key], 96);
    if (parsed) detailValues[key] = parsed;
  }
  return { detailKind: entry[0].slice(0, 64), detailValues };
}

function parseCorporateAction(value: unknown): OfficialCorporateAction | null {
  const record = asRecord(value);
  const tokenSymbol = record && boundedString(record.tokenSymbol, 32)?.toUpperCase();
  if (!record || !tokenSymbol || !/^[A-Z0-9]{1,32}$/.test(tokenSymbol)) return null;
  const parsedDetails = parseCorporateDetails(record.details);
  return {
    id: nullableString(record.id, 130),
    tokenSymbol,
    type: nullableString(record.type, 96),
    status: nullableString(record.status, 96),
    effectiveAt: processDateTimestamp(record.processDate),
    ...parsedDetails,
  };
}

function parseCorporateActionPayload(value: unknown): OfficialCorporateAction[] {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.corpActions)) throw new Error("Invalid official corporate-action payload.");
  return record.corpActions
    .slice(0, 5_000)
    .map(parseCorporateAction)
    .filter((item): item is OfficialCorporateAction => Boolean(item));
}

async function fetchOfficialJson(url: string, fetchImpl: typeof fetch, timeoutMs: number) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("Official source timed out."));
        }, Math.max(1, timeoutMs));
      }),
    ]);
    if (!response.ok) throw new Error(`Official source returned ${response.status}.`);
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_OFFICIAL_RESPONSE_CHARS) {
      throw new Error("Official source response was too large.");
    }
    const text = await response.text();
    if (!text || text.length > MAX_OFFICIAL_RESPONSE_CHARS) throw new Error("Official source response was invalid.");
    return JSON.parse(text) as unknown;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function loadCached<T>(
  key: string,
  ttlMs: number,
  nowMs: number,
  useCache: boolean,
  loader: () => Promise<T>,
): Promise<T> {
  if (useCache) {
    const cached = responseCache.get(key);
    if (cached && cached.expiresAt > nowMs) return cached.value as T;
    const inFlight = inFlightLoads.get(key);
    if (inFlight) return inFlight as Promise<T>;
  }

  const pending = loader().then((value) => {
    if (useCache) responseCache.set(key, { expiresAt: nowMs + ttlMs, value });
    return value;
  }).finally(() => {
    if (useCache) inFlightLoads.delete(key);
  });
  if (useCache) inFlightLoads.set(key, pending);
  return pending;
}

function envelope<T>(
  status: OfficialEvidenceStatus,
  source: string,
  fetchedAt: string,
  value: T | null,
): EvidenceEnvelope<T> {
  return { status, source, fetchedAt, value };
}

function canonicalAddressFor(asset: string) {
  return ROBINHOOD_TOKENS[asset]?.toLowerCase() ?? null;
}

function configuredRpcUrls() {
  return [
    process.env.ROBINHOOD_MAINNET_RPC_URL_PRIMARY,
    process.env.ROBINHOOD_MAINNET_RPC_URL_SECONDARY,
    ...(process.env.ROBINHOOD_RPC_URLS ?? "").split(","),
    process.env.ROBINHOOD_RPC_URL,
    ...ROBINHOOD_MAINNET.rpcUrls,
  ].map((url) => url?.trim() ?? "").filter(
    (url, index, urls) => Boolean(url) && urls.indexOf(url) === index,
  );
}

async function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Onchain multiplier read timed out.")), Math.max(1, timeoutMs));
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readOnchainMultiplier(asset: string, timeoutMs: number): Promise<OnchainMultiplierState> {
  const tokenAddress = ROBINHOOD_TOKENS[asset];
  if (!tokenAddress) throw new Error("Canonical token is unavailable.");
  const deadline = Date.now() + Math.max(1, timeoutMs);
  for (const rpcUrl of configuredRpcUrls().slice(0, 3)) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const provider = new JsonRpcProvider(rpcUrl, ROBINHOOD_MAINNET.chainIdNumber, { staticNetwork: true });
    try {
      const token = new Contract(tokenAddress, ERC_8056_MULTIPLIER_ABI, provider);
      const [current, pending, effectiveAt] = await promiseWithTimeout(Promise.all([
        token.uiMultiplier() as Promise<bigint>,
        token.newUIMultiplier() as Promise<bigint>,
        token.effectiveAt() as Promise<bigint>,
      ]), remainingMs);
      if (current <= 0n || pending <= 0n || effectiveAt < 0n) throw new Error("Invalid onchain multiplier state.");
      if (effectiveAt > 253_402_300_799n) throw new Error("Invalid onchain multiplier effective time.");
      return {
        currentMultiplier: formatUnits(current, 18),
        pendingMultiplier: formatUnits(pending, 18),
        effectiveAt: effectiveAt === 0n ? null : new Date(Number(effectiveAt) * 1_000).toISOString(),
      };
    } catch {
      // Try the next configured read-only endpoint.
    } finally {
      provider.destroy();
    }
  }
  throw new Error("Onchain multiplier state is temporarily unavailable.");
}

function matchesOfficialAsset(
  item: { tokenSymbol: string; deployments: OfficialDeployment[] },
  officialSymbol: string,
  canonicalAddress: string | null,
) {
  if (item.tokenSymbol === officialSymbol) return true;
  return Boolean(canonicalAddress && item.deployments.some(
    (deployment) => deployment.chainId === ROBINHOOD_MAINNET.chainIdNumber
      && deployment.contractAddress.toLowerCase() === canonicalAddress,
  ));
}

export function clearActionLockCache() {
  responseCache.clear();
  inFlightLoads.clear();
}

export async function fetchOfficialActionLockEvidence(
  asset: string,
  options: Pick<ActionLockPreparationOptions, "fetchImpl" | "now" | "timeoutMs" | "useCache" | "readOnchainMultiplier"> = {},
): Promise<OfficialActionLockEvidence> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const observedAt = (options.now?.() ?? new Date()).toISOString();
  const nowMs = Date.parse(observedAt);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const useCache = options.useCache !== false;
  const officialSymbol = (OFFICIAL_SYMBOL_ALIASES[asset] ?? asset).toUpperCase();
  const priceUrl = `${OFFICIAL_API_ORIGIN}/rhj/prices/${encodeURIComponent(officialSymbol)}`;
  const canonicalAddress = canonicalAddressFor(asset);

  const [assetsResult, pricesResult, actionsResult, onchainMultiplierResult] = await Promise.allSettled([
    loadCached(OFFICIAL_ASSETS_URL, ASSETS_CACHE_MS, nowMs, useCache, async () =>
      parseAssetPayload(await fetchOfficialJson(OFFICIAL_ASSETS_URL, fetchImpl, timeoutMs))),
    loadCached(priceUrl, PRICES_CACHE_MS, nowMs, useCache, async () =>
      parsePricePayload(await fetchOfficialJson(priceUrl, fetchImpl, timeoutMs))),
    loadCached(OFFICIAL_CORPORATE_ACTIONS_URL, CORPORATE_ACTIONS_CACHE_MS, nowMs, useCache, async () =>
      parseCorporateActionPayload(await fetchOfficialJson(OFFICIAL_CORPORATE_ACTIONS_URL, fetchImpl, timeoutMs))),
    loadCached(`erc8056:${asset}`, ONCHAIN_MULTIPLIER_CACHE_MS, nowMs, useCache, () =>
      options.readOnchainMultiplier
        ? options.readOnchainMultiplier(asset)
        : readOnchainMultiplier(asset, timeoutMs)),
  ]);

  const officialAsset = assetsResult.status === "fulfilled"
    ? assetsResult.value.find((item) => matchesOfficialAsset(item, officialSymbol, canonicalAddress)) ?? null
    : null;
  const officialPrice = pricesResult.status === "fulfilled"
    ? pricesResult.value.find((item) => matchesOfficialAsset(item, officialSymbol, canonicalAddress)) ?? null
    : null;
  const corporateActions = actionsResult.status === "fulfilled"
    ? actionsResult.value
      .filter((item) => item.tokenSymbol === officialSymbol)
      .sort(compareCorporateActions)
    : null;

  return {
    asset: assetsResult.status === "rejected"
      ? envelope<OfficialActionLockAsset>("unavailable", OFFICIAL_ASSETS_URL, observedAt, null)
      : envelope<OfficialActionLockAsset>(officialAsset ? "available" : "missing", OFFICIAL_ASSETS_URL, observedAt, officialAsset),
    price: pricesResult.status === "rejected"
      ? envelope<OfficialActionLockPrice>("unavailable", priceUrl, observedAt, null)
      : envelope<OfficialActionLockPrice>(officialPrice ? "available" : "missing", priceUrl, observedAt, officialPrice),
    corporateActions: actionsResult.status === "rejected"
      ? envelope<OfficialCorporateAction[]>("unavailable", OFFICIAL_CORPORATE_ACTIONS_URL, observedAt, null)
      : envelope<OfficialCorporateAction[]>("available", OFFICIAL_CORPORATE_ACTIONS_URL, observedAt, corporateActions ?? []),
    onchainMultiplier: onchainMultiplierResult.status === "rejected"
      ? envelope<OnchainMultiplierState>("unavailable", "Robinhood Chain ERC-8056", observedAt, null)
      : envelope<OnchainMultiplierState>("available", "Robinhood Chain ERC-8056", observedAt, onchainMultiplierResult.value),
  };
}

function compareCorporateActions(left: OfficialCorporateAction, right: OfficialCorporateAction) {
  const leftInProgress = left.status === "CORPORATE_ACTION_STATUS_IN_PROGRESS" ? 1 : 0;
  const rightInProgress = right.status === "CORPORATE_ACTION_STATUS_IN_PROGRESS" ? 1 : 0;
  if (leftInProgress !== rightInProgress) return rightInProgress - leftInProgress;
  const leftTime = left.effectiveAt ? Date.parse(left.effectiveAt) : -1;
  const rightTime = right.effectiveAt ? Date.parse(right.effectiveAt) : -1;
  if (leftTime !== rightTime) return rightTime - leftTime;
  return (left.id ?? "").localeCompare(right.id ?? "");
}

function multiplyDecimalStrings(left: string | null, right: string | null): string | null {
  if (!left || !right) return null;
  const parse = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return { integer: BigInt(`${whole}${fraction}`), scale: fraction.length };
  };
  try {
    const leftValue = parse(left);
    const rightValue = parse(right);
    const product = leftValue.integer * rightValue.integer;
    const scale = leftValue.scale + rightValue.scale;
    if (scale === 0) return product.toString();
    const padded = product.toString().padStart(scale + 1, "0");
    const whole = padded.slice(0, -scale);
    const fraction = padded.slice(-scale).replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole;
  } catch {
    return null;
  }
}

function normalizedDecimal(value: string | null) {
  if (!value || !decimalString(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const normalizedWhole = BigInt(whole).toString();
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

function humanCorporateActionLabel(type: string | null) {
  if (!type) return "Corporate action";
  const cleaned = type.replace(/^CORPORATE_ACTION_TYPE_/, "").toLowerCase();
  return cleaned.split("_").map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`).join(" ");
}

function corporateActionAdjustment(action: OfficialCorporateAction | null) {
  if (!action) return null;
  const values = action.detailValues;
  if (values.oldRate && values.newRate) return `${values.oldRate} -> ${values.newRate}`;
  if (values.cashRate) return `${values.cashRate} USD`;
  if (action.detailKind === "cashDividend" && values.rate) return `${values.rate} USD per share`;
  if (action.detailKind === "stockDividend" && values.rate) return `${values.rate} shares per share`;
  if (values.rate) return values.rate;
  if (values.oldUnderlyingSymbol && values.newUnderlyingSymbol) {
    return `${values.oldUnderlyingSymbol} -> ${values.newUnderlyingSymbol}`;
  }
  return null;
}

function corporateActionDetail(action: OfficialCorporateAction | null, sourceStatus: OfficialEvidenceStatus) {
  if (sourceStatus !== "available") return "The official corporate-action feed is temporarily unavailable.";
  if (!action) return "No corporate action is currently reported for this token.";
  const status = action.status === "CORPORATE_ACTION_STATUS_IN_PROGRESS" ? "in progress" : "reported";
  const adjustment = corporateActionAdjustment(action);
  return `${humanCorporateActionLabel(action.type)} is ${status}${adjustment ? ` (${adjustment})` : ""}.`;
}

function makeCheck(
  id: string,
  label: string,
  status: ActionLockCheckStatus,
  code: string,
  detail: string,
  source: string,
): ActionLockCheck {
  const decision: ActionLockDecision = status === "pass" ? "clear" : status === "block" ? "blocked" : "watch";
  return { id, label, status, decision, code, detail, source };
}

function officialSourceUnavailableCode(status: OfficialEvidenceStatus, unavailableCode: string, missingCode: string) {
  return status === "unavailable" ? unavailableCode : missingCode;
}

function buildIssuerState(quote: AgentQuote, evidence: OfficialActionLockEvidence): ActionLockIssuerState {
  const asset = evidence.asset.value;
  const price = evidence.price.value;
  let marketStatus: ActionLockIssuerState["marketStatus"] = "UNKNOWN";
  if (asset?.status === "ASSET_STATUS_INACTIVE") marketStatus = "INACTIVE";
  else if (price?.isTradingHalt === true) marketStatus = "HALTED";
  else if (asset?.status === "ASSET_STATUS_ACTIVE") marketStatus = "ACTIVE";
  return {
    issuerName: asset ? OFFICIAL_ISSUER_NAME : null,
    symbol: quote.asset,
    officialSymbol: asset?.tokenSymbol ?? price?.tokenSymbol ?? null,
    marketStatus,
    officialBid: price?.bid ?? null,
    officialAsk: price?.ask ?? null,
    adjustedBid: multiplyDecimalStrings(price?.bid ?? null, asset?.currentMultiplier ?? null),
    adjustedAsk: multiplyDecimalStrings(price?.ask ?? null, asset?.currentMultiplier ?? null),
    currency: price?.currency ?? null,
    source: OFFICIAL_SOURCE_LABEL,
    asOf: price?.generatedAt ?? null,
    currentMultiplier: asset?.currentMultiplier ?? null,
    pendingMultiplier: asset?.pendingMultiplier ?? null,
    pendingMultiplierEffectiveTime: asset?.pendingMultiplierEffectiveTime ?? null,
    tradingCapabilities: asset?.tradingCapabilities ?? null,
  };
}

function buildCorporateAction(evidence: OfficialActionLockEvidence): ActionLockCorporateAction {
  const action = evidence.corporateActions.value?.[0] ?? null;
  if (evidence.corporateActions.status !== "available") {
    return {
      type: null,
      label: "Corporate action status unavailable",
      status: "UNAVAILABLE",
      effectiveAt: null,
      adjustment: null,
      detail: corporateActionDetail(null, evidence.corporateActions.status),
    };
  }
  if (!action) {
    return {
      type: null,
      label: "No reported corporate action",
      status: "NONE",
      effectiveAt: null,
      adjustment: null,
      detail: corporateActionDetail(null, "available"),
    };
  }
  return {
    type: action.type,
    label: humanCorporateActionLabel(action.type),
    status: action.status ?? "UNKNOWN",
    effectiveAt: action.effectiveAt,
    adjustment: corporateActionAdjustment(action),
    detail: corporateActionDetail(action, "available"),
  };
}

export function evaluateActionLock(
  quote: AgentQuote,
  evidence: OfficialActionLockEvidence,
  observedAt = new Date().toISOString(),
): ActionLockEvaluation {
  const checks: ActionLockCheck[] = [];
  const asset = evidence.asset.value;
  const price = evidence.price.value;
  const canonicalAddress = canonicalAddressFor(quote.asset);
  const officialDeployment = asset?.deployments.find(
    (deployment) => deployment.chainId === ROBINHOOD_MAINNET.chainIdNumber,
  ) ?? null;

  if (evidence.asset.status !== "available" || !asset) {
    checks.push(makeCheck(
      "issuer-status",
      "Issuer asset status",
      "watch",
      officialSourceUnavailableCode(evidence.asset.status, "OFFICIAL_ASSET_UNAVAILABLE", "OFFICIAL_ASSET_NOT_FOUND"),
      "Official asset state could not be confirmed.",
      evidence.asset.source,
    ));
  } else if (asset.status === "ASSET_STATUS_INACTIVE") {
    checks.push(makeCheck("issuer-status", "Issuer asset status", "block", "TOKEN_INACTIVE", "Robinhood marks this token inactive.", evidence.asset.source));
  } else if (asset.status === "ASSET_STATUS_ACTIVE") {
    checks.push(makeCheck("issuer-status", "Issuer asset status", "pass", "TOKEN_ACTIVE", "Robinhood marks this token active.", evidence.asset.source));
  } else {
    checks.push(makeCheck("issuer-status", "Issuer asset status", "watch", "TOKEN_STATUS_UNKNOWN", "The official token status is not explicit.", evidence.asset.source));
  }

  if (!asset || !canonicalAddress || !officialDeployment) {
    checks.push(makeCheck("canonical-deployment", "Canonical deployment", "watch", "CANONICAL_DEPLOYMENT_UNAVAILABLE", "The chain 4663 deployment could not be compared.", evidence.asset.source));
  } else if (officialDeployment.contractAddress.toLowerCase() !== canonicalAddress) {
    checks.push(makeCheck("canonical-deployment", "Canonical deployment", "block", "CANONICAL_DEPLOYMENT_MISMATCH", "The official chain 4663 address does not match HoodFlow's reviewed token.", evidence.asset.source));
  } else {
    checks.push(makeCheck("canonical-deployment", "Canonical deployment", "pass", "CANONICAL_DEPLOYMENT_MATCH", "The official and reviewed chain 4663 addresses match.", evidence.asset.source));
  }

  if (evidence.price.status !== "available" || !price) {
    checks.push(makeCheck(
      "trading-halt",
      "Official halt signal",
      "watch",
      officialSourceUnavailableCode(evidence.price.status, "OFFICIAL_PRICE_UNAVAILABLE", "OFFICIAL_PRICE_NOT_FOUND"),
      "The official halt signal could not be confirmed.",
      evidence.price.source,
    ));
  } else if (price.isTradingHalt === true) {
    checks.push(makeCheck("trading-halt", "Official halt signal", "block", "TRADING_HALT", "Robinhood reports an active trading halt.", evidence.price.source));
  } else if (price.isTradingHalt === false) {
    checks.push(makeCheck("trading-halt", "Official halt signal", "pass", "NO_TRADING_HALT", "Robinhood reports no active trading halt.", evidence.price.source));
  } else {
    checks.push(makeCheck("trading-halt", "Official halt signal", "watch", "TRADING_HALT_UNKNOWN", "The official response omitted an explicit halt signal.", evidence.price.source));
  }

  if (!price?.generatedAt) {
    checks.push(makeCheck("official-price-freshness", "Official price freshness", "watch", "OFFICIAL_PRICE_TIME_UNAVAILABLE", "The official price response has no usable generation time.", evidence.price.source));
  } else {
    const generatedAt = Date.parse(price.generatedAt);
    const observedAtMs = Date.parse(observedAt);
    const ageMs = observedAtMs - generatedAt;
    if (!Number.isFinite(generatedAt) || !Number.isFinite(observedAtMs) || ageMs < -60_000 || ageMs > OFFICIAL_PRICE_MAX_AGE_MS) {
      checks.push(makeCheck("official-price-freshness", "Official price freshness", "watch", "OFFICIAL_PRICE_STALE", "The official bid/ask observation is outside ActionLock's five-minute context window.", evidence.price.source));
    } else {
      checks.push(makeCheck("official-price-freshness", "Official price freshness", "pass", "OFFICIAL_PRICE_FRESH", "The official bid/ask observation is inside ActionLock's five-minute context window.", evidence.price.source));
    }
  }

  const adjustedBid = Number(multiplyDecimalStrings(price?.bid ?? null, asset?.currentMultiplier ?? null));
  const adjustedAsk = Number(multiplyDecimalStrings(price?.ask ?? null, asset?.currentMultiplier ?? null));
  const oraclePrice = quote.reference.price;
  if (
    !Number.isFinite(adjustedBid)
    || !Number.isFinite(adjustedAsk)
    || adjustedBid <= 0
    || adjustedAsk <= 0
    || adjustedAsk < adjustedBid
    || !Number.isFinite(oraclePrice)
    || oraclePrice <= 0
  ) {
    checks.push(makeCheck("official-price-context", "Official price context", "watch", "OFFICIAL_PRICE_CONTEXT_UNAVAILABLE", "Adjusted official bid/ask could not be compared with the live oracle.", evidence.price.source));
  } else {
    const boundary = oraclePrice < adjustedBid ? adjustedBid : oraclePrice > adjustedAsk ? adjustedAsk : oraclePrice;
    const divergenceBps = boundary === oraclePrice ? 0 : Math.round(Math.abs(oraclePrice - boundary) / boundary * 10_000);
    checks.push(divergenceBps > OFFICIAL_PRICE_MAX_DIVERGENCE_BPS
      ? makeCheck("official-price-context", "Official price context", "block", "OFFICIAL_PRICE_DIVERGENCE", `The live oracle is ${divergenceBps} bps outside the adjusted official bid/ask range.`, evidence.price.source)
      : makeCheck("official-price-context", "Official price context", "pass", "OFFICIAL_PRICE_CONTEXT_ALIGNED", `The live oracle is within ${OFFICIAL_PRICE_MAX_DIVERGENCE_BPS} bps of the adjusted official bid/ask range.`, evidence.price.source));
  }

  if (!asset?.currentMultiplier) {
    checks.push(makeCheck("multiplier-window", "Multiplier window", "watch", "CURRENT_MULTIPLIER_UNAVAILABLE", "The current shares-per-token multiplier could not be verified.", evidence.asset.source));
  } else if (!asset.pendingMultiplier) {
    checks.push(makeCheck("multiplier-window", "Multiplier window", "pass", "MULTIPLIER_STABLE_DURING_TTL", "No pending multiplier change is reported.", evidence.asset.source));
  } else if (!asset.pendingMultiplierEffectiveTime) {
    checks.push(makeCheck("multiplier-window", "Multiplier window", "watch", "PENDING_MULTIPLIER_EFFECTIVE_TIME_UNKNOWN", "A pending multiplier exists without a valid effective time.", evidence.asset.source));
  } else {
    const effectiveAt = Date.parse(asset.pendingMultiplierEffectiveTime);
    const expiresAt = Date.parse(quote.protection.dataExpiresAt);
    if (Number.isFinite(effectiveAt) && Number.isFinite(expiresAt) && effectiveAt <= expiresAt) {
      checks.push(makeCheck("multiplier-window", "Multiplier window", "block", "MULTIPLIER_CHANGES_DURING_TTL", "The shares-per-token multiplier changes before this quote expires.", evidence.asset.source));
    } else {
      checks.push(makeCheck("multiplier-window", "Multiplier window", "pass", "MULTIPLIER_STABLE_DURING_TTL", "The pending multiplier takes effect after this quote expires.", evidence.asset.source));
    }
  }

  const onchainMultiplier = evidence.onchainMultiplier.value;
  if (evidence.onchainMultiplier.status !== "available" || !onchainMultiplier) {
    checks.push(makeCheck("multiplier-source", "Onchain multiplier", "watch", "ONCHAIN_MULTIPLIER_UNAVAILABLE", "ERC-8056 multiplier state could not be read from the canonical token.", evidence.onchainMultiplier.source));
  } else if (!asset?.currentMultiplier) {
    checks.push(makeCheck("multiplier-source", "Onchain multiplier", "watch", "MULTIPLIER_API_UNAVAILABLE", "The onchain multiplier is available, but the official API value could not be compared.", evidence.onchainMultiplier.source));
  } else if (
    normalizedDecimal(asset.currentMultiplier) !== normalizedDecimal(onchainMultiplier.currentMultiplier)
    || normalizedDecimal(quote.uiScaling.multiplier) !== normalizedDecimal(onchainMultiplier.currentMultiplier)
  ) {
    checks.push(makeCheck("multiplier-source", "Onchain multiplier", "block", "MULTIPLIER_SOURCE_MISMATCH", "The official API and canonical ERC-8056 current multipliers disagree.", evidence.onchainMultiplier.source));
  } else {
    const onchainChanges = normalizedDecimal(onchainMultiplier.pendingMultiplier)
      !== normalizedDecimal(onchainMultiplier.currentMultiplier);
    const onchainEffectiveAt = onchainMultiplier.effectiveAt ? Date.parse(onchainMultiplier.effectiveAt) : Number.NaN;
    const quoteExpiresAt = Date.parse(quote.protection.dataExpiresAt);
    const apiPending = normalizedDecimal(asset.pendingMultiplier);
    const onchainPending = normalizedDecimal(onchainMultiplier.pendingMultiplier);
    const apiEffectiveAt = asset.pendingMultiplierEffectiveTime
      ? Date.parse(asset.pendingMultiplierEffectiveTime)
      : Number.NaN;
    if (onchainChanges && Number.isFinite(onchainEffectiveAt) && Number.isFinite(quoteExpiresAt) && onchainEffectiveAt <= quoteExpiresAt) {
      checks.push(makeCheck("multiplier-source", "Onchain multiplier", "block", "MULTIPLIER_CHANGES_DURING_TTL", "The canonical ERC-8056 multiplier changes before this quote expires.", evidence.onchainMultiplier.source));
    } else if (
      (apiPending && apiPending !== onchainPending)
      || (Number.isFinite(apiEffectiveAt) && Number.isFinite(onchainEffectiveAt) && apiEffectiveAt !== onchainEffectiveAt)
      || (!apiPending && onchainChanges)
    ) {
      checks.push(makeCheck("multiplier-source", "Onchain multiplier", "watch", "PENDING_MULTIPLIER_SOURCE_DIVERGENCE", "Pending multiplier state is not aligned across the official API and canonical token.", evidence.onchainMultiplier.source));
    } else {
      checks.push(makeCheck("multiplier-source", "Onchain multiplier", "pass", "MULTIPLIER_SOURCES_MATCH", "The official API and canonical ERC-8056 multiplier state agree.", evidence.onchainMultiplier.source));
    }
  }

  if (evidence.corporateActions.status !== "available" || !evidence.corporateActions.value) {
    checks.push(makeCheck("corporate-action", "Corporate action", "watch", "CORPORATE_ACTIONS_UNAVAILABLE", "The official corporate-action feed could not be checked.", evidence.corporateActions.source));
  } else if (evidence.corporateActions.value.some((action) => action.status === "CORPORATE_ACTION_STATUS_IN_PROGRESS")) {
    checks.push(makeCheck("corporate-action", "Corporate action", "block", "CORPORATE_ACTION_IN_PROGRESS", "Robinhood reports an in-progress corporate action for this token.", evidence.corporateActions.source));
  } else {
    checks.push(makeCheck("corporate-action", "Corporate action", "pass", "NO_CORPORATE_ACTION_IN_PROGRESS", "No in-progress corporate action is reported.", evidence.corporateActions.source));
  }

  const expiresAt = Date.parse(quote.protection.dataExpiresAt);
  const observedAtMs = Date.parse(observedAt);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(observedAtMs) || expiresAt <= observedAtMs) {
    checks.push(makeCheck("quote-window", "Quote validity", "block", "QUOTE_EXPIRED", "The protected quote window is invalid or expired.", "HoodFlow quote engine"));
  } else {
    checks.push(makeCheck("quote-window", "Quote validity", "pass", "QUOTE_TTL_VALID", "The quote remains inside its short-lived validity window.", "HoodFlow quote engine"));
  }

  const routeIsReviewed = (quote.route.protocol === "Uniswap V3" || quote.route.protocol === "Uniswap V4")
    && Number.isFinite(quote.route.fee)
    && quote.route.fee > 0;
  checks.push(routeIsReviewed
    ? makeCheck("reviewed-route", "Reviewed route", "pass", "ROUTE_REVIEWED", `${quote.route.protocol} route metadata is present.`, "HoodFlow quote engine")
    : makeCheck("reviewed-route", "Reviewed route", "block", "ROUTE_INVALID", "The quote does not identify a reviewed execution route.", "HoodFlow quote engine"));

  const oracleIsValid = quote.reference.status === "live"
    && quote.reference.oraclePaused === false
    && Number.isFinite(quote.reference.price)
    && quote.reference.price > 0
    && Number.isFinite(quote.reference.deviationBps)
    && quote.reference.deviationBps <= quote.reference.maxDeviationBps;
  checks.push(oracleIsValid
    ? makeCheck("oracle-guard", "Oracle guard", "pass", "ORACLE_GUARD_PASSED", "The live oracle and DEX deviation guard passed.", "HoodFlow quote engine")
    : makeCheck("oracle-guard", "Oracle guard", "block", "ORACLE_GUARD_FAILED", "The quote does not satisfy HoodFlow's live oracle guard.", "HoodFlow quote engine"));

  let minimumOutputIsValid = false;
  try {
    const estimated = BigInt(quote.receive.rawEstimatedAmount);
    const minimum = BigInt(quote.receive.rawIndicativeMinimumAmount);
    minimumOutputIsValid = minimum > 0n && estimated >= minimum;
  } catch {
    minimumOutputIsValid = false;
  }
  checks.push(minimumOutputIsValid
    ? makeCheck("minimum-output", "Protected minimum", "pass", "MINIMUM_OUTPUT_PROTECTED", "A positive slippage-protected minimum output is pinned to the quote.", "HoodFlow quote engine")
    : makeCheck("minimum-output", "Protected minimum", "block", "MINIMUM_OUTPUT_INVALID", "The quote has no valid protected minimum output.", "HoodFlow quote engine"));

  const decision: ActionLockDecision = checks.some((check) => check.status === "block")
    ? "blocked"
    : checks.some((check) => check.status === "watch")
      ? "watch"
      : "clear";
  const reasons = checks
    .filter((check) => check.status !== "pass")
    .map((check): ActionLockReason => ({
      code: check.code,
      severity: check.status === "block" ? "block" : "watch",
      message: check.detail,
      source: check.source,
    }));

  return {
    decision,
    issuerState: buildIssuerState(quote, evidence),
    corporateAction: buildCorporateAction(evidence),
    checks,
    reasons,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]),
  );
}

export async function stableActionLockFingerprint(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

function actionLockStatePayload(
  quote: AgentQuote,
  evidence: OfficialActionLockEvidence,
  evaluation: ActionLockEvaluation,
) {
  const officialDeployment = evidence.asset.value?.deployments.find(
    (deployment) => deployment.chainId === ROBINHOOD_MAINNET.chainIdNumber,
  ) ?? null;
  return {
    asset: {
      symbol: quote.asset,
      officialSymbol: evidence.asset.value?.tokenSymbol ?? evidence.price.value?.tokenSymbol ?? null,
      status: evidence.asset.value?.status ?? null,
      canonicalAddress: canonicalAddressFor(quote.asset),
      officialAddress: officialDeployment?.contractAddress.toLowerCase() ?? null,
      currentMultiplier: evidence.asset.value?.currentMultiplier ?? null,
      pendingMultiplier: evidence.asset.value?.pendingMultiplier ?? null,
      pendingMultiplierEffectiveTime: evidence.asset.value?.pendingMultiplierEffectiveTime ?? null,
    },
    halt: evidence.price.value?.isTradingHalt ?? null,
    onchainMultiplier: evidence.onchainMultiplier.value,
    corporateActions: evidence.corporateActions.value?.map((action) => ({
      id: action.id,
      type: action.type,
      status: action.status,
      effectiveAt: action.effectiveAt,
      detailKind: action.detailKind,
      detailValues: action.detailValues,
    })) ?? null,
    checks: evaluation.checks.map((check) => ({
      id: check.id,
      code: check.code,
      status: check.status,
    })),
  };
}

export async function createActionLockPassport(
  request: AgentQuoteRequest,
  quote: AgentQuote,
  evidence: OfficialActionLockEvidence,
  observedAt = new Date().toISOString(),
): Promise<ActionLockPassport> {
  const evaluation = evaluateActionLock(quote, evidence, observedAt);
  const { executionHandoff, ...quoteSnapshot } = quote;
  const handoffAllowed = evaluation.decision !== "blocked";
  const stateFingerprint = await stableActionLockFingerprint(
    actionLockStatePayload(quote, evidence, evaluation),
  );
  const unsignedPassport = {
    feature: "HoodFlow ActionLock" as const,
    passportVersion: "hoodflow-action-lock/1" as const,
    policyVersion: POLICY_VERSION,
    observedAt,
    status: "action-lock-passport" as const,
    decision: evaluation.decision,
    handoffAllowed,
    intent: request,
    issuerState: evaluation.issuerState,
    corporateAction: evaluation.corporateAction,
    checks: evaluation.checks,
    reasons: evaluation.reasons,
    quote: quoteSnapshot,
    evidence,
    policy: {
      id: POLICY_ID,
      version: POLICY_VERSION,
      observedAt,
      validUntil: quote.protection.dataExpiresAt,
    },
    custody: "self-custody" as const,
    requiresUserSignature: true as const,
    capabilities: {
      signs: false as const,
      submitsTransaction: false as const,
      requestsWalletPermission: false as const,
    },
    executionHandoff: handoffAllowed ? executionHandoff : null,
    stateFingerprint,
  };
  return {
    ...unsignedPassport,
    fingerprint: await stableActionLockFingerprint(unsignedPassport),
  };
}

export async function prepareActionLockPassport(
  request: AgentQuoteRequest,
  options: ActionLockPreparationOptions = {},
) {
  const quote = await (options.prepareQuote ?? prepareAgentQuote)(request);
  const evidence = await fetchOfficialActionLockEvidence(request.asset, options);
  const observedAt = (options.now?.() ?? new Date()).toISOString();
  return createActionLockPassport(request, quote, evidence, observedAt);
}
