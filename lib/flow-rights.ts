import infrastructure from "../config/robinhood-mainnet.json" with { type: "json" };
import { Contract, JsonRpcProvider, formatUnits } from "ethers";

const OFFICIAL_API_ORIGIN = "https://api.robinhood.com";
export const OFFICIAL_PAYDAY_ASSETS_URL = `${OFFICIAL_API_ORIGIN}/rhj/assets`;
export const OFFICIAL_PAYDAY_ACTIONS_URL = `${OFFICIAL_API_ORIGIN}/rhj/corporate-actions`;
export const PAYDAY_CHAIN_ID = 4_663;

const CASH_DIVIDEND = "CORPORATE_ACTION_TYPE_CASH_DIVIDEND";
const COMPLETED = "CORPORATE_ACTION_STATUS_COMPLETED";
const IN_PROGRESS = "CORPORATE_ACTION_STATUS_IN_PROGRESS";
const ACTIVE = "ASSET_STATUS_ACTIVE";
const SCALE = 10n ** 18n;
const MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_TIMEOUT_MS = 6_000;
const SOURCE_CACHE_MS = 60_000;
const ERC_8056_ABI = [
  "function uid() view returns (bytes32)",
  "function uiMultiplier() view returns (uint256)",
  "function newUIMultiplier() view returns (uint256)",
  "function effectiveAt() view returns (uint256)",
] as const;

type RecordValue = Record<string, unknown>;

type Deployment = {
  chainId: number;
  contractAddress: string;
};

type SourceAsset = {
  uid: string;
  ticker: string;
  name: string | null;
  logoUrl: string | null;
  status: string;
  tokenDecimals: number;
  deployments: Deployment[];
  currentMultiplier: string;
  pendingMultiplier: string | null;
  pendingMultiplierEffectiveTime: string | null;
};

type SourceCorporateAction = {
  uid: string | null;
  ticker: string;
  type: string | null;
  status: string | null;
  processDate: string | null;
  deployments: Deployment[];
  amountPerUnit: string | null;
  currency: string | null;
  underlyingSymbol: string | null;
};

type OfficialSource = {
  assets: SourceAsset[];
  actions: SourceCorporateAction[];
  fetchedAt: string;
};

export type PaydayOnchainState = {
  chainId: 4663 | number;
  uid: string;
  currentMultiplier: string;
  pendingMultiplier: string;
  effectiveAt: string | null;
};

export type PaydayEligibilityState = "eligible" | "pending" | "blocked" | "unavailable";

export type PaydayEvidence = {
  id: string;
  label: string;
  status: "pass" | "pending" | "block";
  detail: string;
  source: string;
};

export type PaydayPreview = {
  oldMultiplier: string;
  newMultiplier: string;
  rawBalance: "1.000000000000000000";
  principalPreservingRawBalance: string;
  harvestRawAmount: string;
  estimatedUsdg: null;
  formula: "principalRaw = ceil(rawBalance * oldMultiplier / newMultiplier); harvestRaw = rawBalance - principalRaw";
  rounding: "All multiplier math uses unsigned 18-decimal integers. Principal is rounded up so the preview never overstates harvestable raw tokens.";
};

export type PaydayData = {
  feature: "HoodFlow FlowRights / Payday Preview";
  version: "hoodflow-payday/1";
  asset: {
    uid: string | null;
    ticker: string;
    name: string | null;
    type: "stock" | "etf" | "unknown";
    logoUrl: string | null;
    chainId: 4663;
    contractAddress: string;
    currentMultiplier: string | null;
    pendingMultiplier: string | null;
    pendingMultiplierEffectiveTime: string | null;
  };
  corporateAction: {
    uid: string;
    type: string;
    status: string;
    processDate: string | null;
    sourceUpdatedAt: null;
    amountPerUnit: string | null;
    currency: string | null;
    classification:
      | "multiplier-transition-concurrent-with-cash-dividend-process-date"
      | "cash-dividend-record-only"
      | "not-qualified";
  } | null;
  eligibility: {
    state: PaydayEligibilityState;
    reason: string;
    code: string;
  };
  evidence: PaydayEvidence[];
  preview: PaydayPreview | null;
  integrity: {
    algorithm: "sha256";
    checksum: string;
    authenticating: false;
    notice: "This checksum detects accidental response changes. It is not a signature, attestation, proof of execution, or proof of entitlement.";
  };
  capabilities: {
    readsOfficialSources: true;
    signs: false;
    submitsTransaction: false;
    requestsWalletPermission: false;
    createsClaimToken: false;
    controlsFunds: false;
    createsEntitlement: false;
  };
  generatedAt: string;
  disclaimer: string;
  safety: "Read-only preview. No transaction, wallet permission, signature, entitlement, or execution handoff is created.";
  handoffAllowed: false;
  handoff: null;
  executionHandoff: null;
};

export type PaydayOptions = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  useCache?: boolean;
  readOnchainState?: (ticker: string, contractAddress: string) => Promise<PaydayOnchainState>;
};

export class PaydayValidationError extends Error {}
export class PaydaySourceUnavailableError extends Error {}

const aliases = infrastructure.onchainSymbolAliases as Readonly<Record<string, string>>;
const configuredTokens = infrastructure.tokens as Readonly<Record<string, string>>;
const stocks = new Set(infrastructure.assetTypes.stocks);
const etfs = new Set(infrastructure.assetTypes.etfs);

let cachedSource: { expiresAt: number; value: OfficialSource } | null = null;
let sourceInFlight: Promise<OfficialSource> | null = null;

function asRecord(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function boundedString(value: unknown, max = 256): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function nullableString(value: unknown, max = 256) {
  if (value === "" || value === null || value === undefined) return null;
  return boundedString(value, max);
}

function uid(value: unknown) {
  const candidate = boundedString(value, 66);
  return candidate && /^0x[0-9a-fA-F]{64}$/.test(candidate)
    ? candidate.toLowerCase()
    : null;
}

function address(value: unknown) {
  const candidate = boundedString(value, 42);
  return candidate && /^0x[0-9a-fA-F]{40}$/.test(candidate)
    ? candidate.toLowerCase()
    : null;
}

function decimal(value: unknown) {
  const candidate = boundedString(value, 96);
  if (!candidate || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(candidate)) return null;
  return candidate;
}

function positiveDecimal(value: unknown) {
  const candidate = decimal(value);
  return candidate && decimalToAtomic(candidate) > 0n ? candidate : null;
}

function isoTimestamp(value: unknown) {
  const candidate = boundedString(value, 96);
  if (!candidate) return null;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeDecimal(value: string | null) {
  if (!value) return null;
  try {
    const [whole, fraction = ""] = value.split(".");
    const normalizedFraction = fraction.replace(/0+$/, "");
    return normalizedFraction
      ? `${BigInt(whole).toString()}.${normalizedFraction}`
      : BigInt(whole).toString();
  } catch {
    return null;
  }
}

function parseProcessDate(value: unknown) {
  const record = asRecord(value);
  if (!record) return null;
  const year = Number(record.year);
  const month = Number(record.month);
  const day = Number(record.day);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const result = new Date(Date.UTC(year, month - 1, day));
  if (
    result.getUTCFullYear() !== year
    || result.getUTCMonth() !== month - 1
    || result.getUTCDate() !== day
  ) return null;
  return result.toISOString().slice(0, 10);
}

function parseDeployments(value: unknown) {
  if (!Array.isArray(value) || value.length > 16) return [];
  return value.flatMap((item): Deployment[] => {
    const record = asRecord(item);
    const contractAddress = record && address(record.contractAddress);
    const chainId = record ? Number(record.chainId) : Number.NaN;
    return contractAddress && Number.isSafeInteger(chainId) && chainId > 0
      ? [{ chainId, contractAddress }]
      : [];
  });
}

function parseSourceAsset(value: unknown): SourceAsset | null {
  const record = asRecord(value);
  const parsedUid = record && uid(record.id);
  const ticker = record && boundedString(record.tokenSymbol, 32)?.toUpperCase();
  const status = record && boundedString(record.status, 64);
  const currentMultiplier = record && positiveDecimal(record.currentMultiplier);
  const tokenDecimals = record ? Number(record.tokenDecimals) : Number.NaN;
  if (
    !record || !parsedUid || !ticker || !/^[A-Z0-9]{1,32}$/.test(ticker)
    || !status || !currentMultiplier || !Number.isInteger(tokenDecimals)
  ) return null;
  const parsedLogo = nullableString(record.logoUrl, 512);
  return {
    uid: parsedUid,
    ticker,
    name: nullableString(record.tokenName, 180),
    logoUrl: parsedLogo && /^https:\/\//i.test(parsedLogo) ? parsedLogo : null,
    status,
    tokenDecimals,
    deployments: parseDeployments(record.deployments),
    currentMultiplier,
    pendingMultiplier: record.pendingMultiplier === ""
      ? null
      : positiveDecimal(record.pendingMultiplier),
    pendingMultiplierEffectiveTime: isoTimestamp(record.pendingMultiplierEffectiveTime),
  };
}

function cashDividendDetails(value: unknown) {
  const details = asRecord(value);
  const cashDividend = details && asRecord(details.cashDividend);
  if (!cashDividend) return { amountPerUnit: null, currency: null, underlyingSymbol: null };
  const currency = nullableString(cashDividend.currency, 12)?.toUpperCase() ?? null;
  const underlyingSymbol = nullableString(cashDividend.underlyingSymbol, 32)?.toUpperCase() ?? null;
  return {
    amountPerUnit: positiveDecimal(cashDividend.rate),
    currency: currency && /^[A-Z]{3,8}$/.test(currency) ? currency : null,
    underlyingSymbol: underlyingSymbol && /^[A-Z0-9]{1,32}$/.test(underlyingSymbol)
      ? underlyingSymbol
      : null,
  };
}

function parseSourceAction(value: unknown): SourceCorporateAction | null {
  const record = asRecord(value);
  const ticker = record && boundedString(record.tokenSymbol, 32)?.toUpperCase();
  if (!record || !ticker || !/^[A-Z0-9]{1,32}$/.test(ticker)) return null;
  return {
    uid: uid(record.id),
    ticker,
    type: nullableString(record.type, 96),
    status: nullableString(record.status, 96),
    processDate: parseProcessDate(record.processDate),
    deployments: parseDeployments(record.deployments),
    ...cashDividendDetails(record.details),
  };
}

async function fetchBoundedJson(url: string, fetchImpl: typeof fetch, timeoutMs: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Official source timed out."));
        }, Math.max(1, timeoutMs));
      }),
    ]);
    if (!response.ok) throw new Error(`Official source returned ${response.status}.`);
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error("Official source response was too large.");
    }
    const body = await response.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("Official source response size was invalid.");
    }
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseAssetsPayload(payload: unknown) {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.assets) || record.assets.length > 5_000) {
    throw new Error("Official assets response shape was invalid.");
  }
  return record.assets.map(parseSourceAsset).filter((item): item is SourceAsset => Boolean(item));
}

function parseActionsPayload(payload: unknown) {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.corpActions) || record.corpActions.length > 5_000) {
    throw new Error("Official corporate-actions response shape was invalid.");
  }
  return record.corpActions.map(parseSourceAction).filter((item): item is SourceCorporateAction => Boolean(item));
}

async function loadOfficialSource(options: PaydayOptions): Promise<OfficialSource> {
  const now = options.now?.() ?? new Date();
  const nowMs = now.getTime();
  const useCache = options.useCache !== false;
  if (useCache && cachedSource && cachedSource.expiresAt > nowMs) return cachedSource.value;
  if (useCache && sourceInFlight) return sourceInFlight;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pending = Promise.all([
    fetchBoundedJson(OFFICIAL_PAYDAY_ASSETS_URL, fetchImpl, timeoutMs),
    fetchBoundedJson(OFFICIAL_PAYDAY_ACTIONS_URL, fetchImpl, timeoutMs),
  ]).then(([assets, actions]) => ({
    assets: parseAssetsPayload(assets),
    actions: parseActionsPayload(actions),
    fetchedAt: now.toISOString(),
  })).catch(() => {
    throw new PaydaySourceUnavailableError("Official Payday evidence is temporarily unavailable.");
  }).finally(() => {
    if (useCache) sourceInFlight = null;
  });
  if (useCache) sourceInFlight = pending;
  const result = await pending;
  if (useCache) cachedSource = { expiresAt: nowMs + SOURCE_CACHE_MS, value: result };
  return result;
}

function configuredRpcUrls() {
  return [
    process.env.ROBINHOOD_MAINNET_RPC_URL_PRIMARY,
    process.env.ROBINHOOD_MAINNET_RPC_URL_SECONDARY,
    ...(process.env.ROBINHOOD_RPC_URLS ?? "").split(","),
    process.env.ROBINHOOD_RPC_URL,
    infrastructure.rpcUrl,
  ].map((url) => url?.trim() ?? "").filter(
    (url, index, urls) => Boolean(url) && urls.indexOf(url) === index,
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Onchain Payday read timed out.")), Math.max(1, timeoutMs));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readCanonicalOnchainState(
  contractAddress: string,
  timeoutMs: number,
): Promise<PaydayOnchainState> {
  const deadline = Date.now() + Math.max(1, timeoutMs);
  for (const rpcUrl of configuredRpcUrls().slice(0, 3)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const provider = new JsonRpcProvider(rpcUrl);
    try {
      const rawChainId = await withTimeout(
        provider.send("eth_chainId", []) as Promise<unknown>,
        remaining,
      );
      let verifiedChainId: bigint;
      try {
        verifiedChainId = typeof rawChainId === "string"
          || typeof rawChainId === "number"
          || typeof rawChainId === "bigint"
          ? BigInt(rawChainId)
          : -1n;
      } catch {
        verifiedChainId = -1n;
      }
      if (verifiedChainId !== BigInt(PAYDAY_CHAIN_ID)) {
        throw new Error("RPC endpoint is not Robinhood Chain mainnet.");
      }
      const contractReadBudget = deadline - Date.now();
      if (contractReadBudget <= 0) throw new Error("Onchain Payday read timed out.");
      const token = new Contract(contractAddress, ERC_8056_ABI, provider);
      const [rawUid, current, pending, effectiveAt] = await withTimeout(Promise.all([
        token.uid() as Promise<string>,
        token.uiMultiplier() as Promise<bigint>,
        token.newUIMultiplier() as Promise<bigint>,
        token.effectiveAt() as Promise<bigint>,
      ]), contractReadBudget);
      const parsedUid = uid(rawUid);
      if (!parsedUid || current <= 0n || pending <= 0n || effectiveAt < 0n || effectiveAt > 253_402_300_799n) {
        throw new Error("Canonical token returned invalid ERC-8056 state.");
      }
      return {
        chainId: PAYDAY_CHAIN_ID,
        uid: parsedUid,
        currentMultiplier: formatUnits(current, 18),
        pendingMultiplier: formatUnits(pending, 18),
        effectiveAt: effectiveAt === 0n ? null : new Date(Number(effectiveAt) * 1_000).toISOString(),
      };
    } catch {
      // Continue to the next bounded read-only RPC.
    } finally {
      provider.destroy();
    }
  }
  throw new Error("Canonical ERC-8056 state is temporarily unavailable.");
}

function decimalToAtomic(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(18, "0"));
}

function atomicToDecimal(value: bigint) {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(18, "0");
  return `${whole}.${fraction}`;
}

export function buildMultiplierPreview(oldMultiplier: string, newMultiplier: string): PaydayPreview | null {
  try {
    const oldAtomic = decimalToAtomic(oldMultiplier);
    const newAtomic = decimalToAtomic(newMultiplier);
    if (oldAtomic <= 0n || newAtomic <= oldAtomic) return null;
    const rawBalance = SCALE;
    const numerator = rawBalance * oldAtomic;
    const principal = (numerator + newAtomic - 1n) / newAtomic;
    const harvest = rawBalance - principal;
    return {
      oldMultiplier,
      newMultiplier,
      rawBalance: "1.000000000000000000",
      principalPreservingRawBalance: atomicToDecimal(principal),
      harvestRawAmount: atomicToDecimal(harvest),
      estimatedUsdg: null,
      formula: "principalRaw = ceil(rawBalance * oldMultiplier / newMultiplier); harvestRaw = rawBalance - principalRaw",
      rounding: "All multiplier math uses unsigned 18-decimal integers. Principal is rounded up so the preview never overstates harvestable raw tokens.",
    };
  } catch {
    return null;
  }
}

function assetType(ticker: string): PaydayData["asset"]["type"] {
  if (stocks.has(ticker)) return "stock";
  if (etfs.has(ticker)) return "etf";
  return "unknown";
}

function exactChainDeployment(deployments: Deployment[], canonicalAddress: string) {
  const matches = deployments.filter((deployment) => deployment.chainId === PAYDAY_CHAIN_ID);
  if (matches.length !== 1) return null;
  return matches[0].contractAddress === canonicalAddress ? matches[0] : null;
}

function actionTimestamp(action: SourceCorporateAction) {
  return action.processDate ? Date.parse(action.processDate) : -1;
}

function sameUtcDate(left: string, right: string) {
  return left.slice(0, 10) === right.slice(0, 10);
}

function selectRelevantAction(actions: SourceCorporateAction[]) {
  const inProgress = actions.filter((action) => action.status === IN_PROGRESS);
  if (inProgress.length === 1) return { action: inProgress[0], ambiguous: false };
  if (inProgress.length > 1) return { action: inProgress.sort((a, b) => actionTimestamp(b) - actionTimestamp(a))[0], ambiguous: true };
  const unknownStatus = actions.filter((action) => action.status !== COMPLETED);
  if (unknownStatus.length) return { action: unknownStatus.sort((a, b) => actionTimestamp(b) - actionTimestamp(a))[0], ambiguous: false };
  return {
    action: [...actions].sort((a, b) => actionTimestamp(b) - actionTimestamp(a))[0] ?? null,
    ambiguous: false,
  };
}

function actionsOnProcessDate(
  actions: SourceCorporateAction[],
  selected: SourceCorporateAction | null,
) {
  if (!selected?.processDate) return [];
  return actions.filter((action) =>
    Boolean(action.processDate && sameUtcDate(action.processDate, selected.processDate!)));
}

function evidence(
  id: string,
  label: string,
  status: PaydayEvidence["status"],
  detail: string,
  source: string,
): PaydayEvidence {
  return { id, label, status, detail, source };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
}

async function checksum(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

function unavailableData(ticker: string, canonicalAddress: string, generatedAt: string): Omit<PaydayData, "integrity"> {
  return {
    feature: "HoodFlow FlowRights / Payday Preview",
    version: "hoodflow-payday/1",
    asset: {
      uid: null,
      ticker,
      name: null,
      type: assetType(ticker),
      logoUrl: null,
      chainId: PAYDAY_CHAIN_ID,
      contractAddress: canonicalAddress,
      currentMultiplier: null,
      pendingMultiplier: null,
      pendingMultiplierEffectiveTime: null,
    },
    corporateAction: null,
    eligibility: {
      state: "unavailable",
      code: "OFFICIAL_SOURCE_UNAVAILABLE",
      reason: "Robinhood's official asset or corporate-action source could not be verified.",
    },
    evidence: [evidence(
      "official-source",
      "Official source",
      "block",
      "The preview fails closed while official evidence is unavailable.",
      "Robinhood Stock Token APIs",
    )],
    preview: null,
    capabilities: {
      readsOfficialSources: true,
      signs: false,
      submitsTransaction: false,
      requestsWalletPermission: false,
      createsClaimToken: false,
      controlsFunds: false,
      createsEntitlement: false,
    },
    generatedAt,
    disclaimer: "Stock Tokens are not shares. Temporal concurrency with a CASH_DIVIDEND record does not prove causality or entitlement. This read-only calculation is not a dividend, quote, execution promise, or investment recommendation.",
    safety: "Read-only preview. No transaction, wallet permission, signature, entitlement, or execution handoff is created.",
    handoffAllowed: false,
    handoff: null,
    executionHandoff: null,
  };
}

export function normalizePaydayTicker(value: string | null) {
  const ticker = value?.trim().toUpperCase() ?? "";
  if (!/^[A-Z0-9]{1,16}$/.test(ticker) || !configuredTokens[ticker]) {
    throw new PaydayValidationError("Payday requires one HoodFlow-indexed asset ticker.");
  }
  return ticker;
}

export function clearPaydayCache() {
  cachedSource = null;
  sourceInFlight = null;
}

export async function getPaydayData(assetInput: string, options: PaydayOptions = {}): Promise<PaydayData> {
  const ticker = normalizePaydayTicker(assetInput);
  const officialTicker = (aliases[ticker] ?? ticker).toUpperCase();
  const canonicalAddress = configuredTokens[ticker].toLowerCase();
  const generatedAt = (options.now?.() ?? new Date()).toISOString();
  const onchainPromise = Promise.resolve().then(() => options.readOnchainState
    ? options.readOnchainState(ticker, canonicalAddress)
    : readCanonicalOnchainState(canonicalAddress, options.timeoutMs ?? DEFAULT_TIMEOUT_MS))
    .then((value) => ({ ok: true as const, value }))
    .catch(() => ({ ok: false as const, value: null }));
  let source: OfficialSource;
  try {
    source = await loadOfficialSource(options);
  } catch (error) {
    if (!(error instanceof PaydaySourceUnavailableError)) throw error;
    const base = unavailableData(ticker, canonicalAddress, generatedAt);
    return {
      ...base,
      integrity: {
        algorithm: "sha256",
        checksum: await checksum(base),
        authenticating: false,
        notice: "This checksum detects accidental response changes. It is not a signature, attestation, proof of execution, or proof of entitlement.",
      },
    };
  }

  const onchainResult = await onchainPromise;
  const onchain: PaydayOnchainState | null = onchainResult.ok ? onchainResult.value : null;

  const candidates = source.assets.filter((asset) =>
    asset.ticker === officialTicker
    || asset.deployments.some((deployment) => deployment.chainId === PAYDAY_CHAIN_ID && deployment.contractAddress === canonicalAddress));
  const asset = candidates.length === 1 ? candidates[0] : null;
  const checks: PaydayEvidence[] = [];
  let state: PaydayEligibilityState = "pending";
  let code = "NO_DIVIDEND_EVENT";
  let reason = "No completed or in-progress cash-dividend event is currently available for this asset.";

  if (!asset) {
    state = "blocked";
    code = candidates.length > 1 ? "AMBIGUOUS_OFFICIAL_ASSET" : "OFFICIAL_ASSET_NOT_FOUND";
    reason = "The official asset could not be matched unambiguously to HoodFlow's reviewed chain 4663 token.";
    checks.push(evidence("canonical-asset", "Canonical asset", "block", reason, OFFICIAL_PAYDAY_ASSETS_URL));
  } else if (asset.tokenDecimals !== 18) {
    state = "blocked";
    code = "TOKEN_DECIMALS_UNSUPPORTED";
    reason = "The official token does not report the required 18 decimals.";
    checks.push(evidence("token-decimals", "Token decimals", "block", reason, OFFICIAL_PAYDAY_ASSETS_URL));
  } else if (!exactChainDeployment(asset.deployments, canonicalAddress)) {
    state = "blocked";
    code = "CANONICAL_DEPLOYMENT_MISMATCH";
    reason = "The official chain 4663 deployment does not exactly match HoodFlow's reviewed token address.";
    checks.push(evidence("canonical-deployment", "Canonical deployment", "block", reason, OFFICIAL_PAYDAY_ASSETS_URL));
  } else if (asset.status !== ACTIVE) {
    state = "blocked";
    code = "ASSET_NOT_ACTIVE";
    reason = "Robinhood does not currently mark this Stock Token active.";
    checks.push(evidence("asset-status", "Asset status", "block", reason, OFFICIAL_PAYDAY_ASSETS_URL));
  } else {
    checks.push(
      evidence("canonical-uid", "Canonical UID", "pass", "The official asset has a valid stable UID.", OFFICIAL_PAYDAY_ASSETS_URL),
      evidence("canonical-deployment", "Canonical deployment", "pass", "The official chain 4663 address exactly matches HoodFlow's reviewed token.", OFFICIAL_PAYDAY_ASSETS_URL),
      evidence("asset-status", "Asset status", "pass", "Robinhood marks the asset active.", OFFICIAL_PAYDAY_ASSETS_URL),
    );
  }

  if (asset && state !== "blocked") {
    const apiPending = normalizeDecimal(asset.pendingMultiplier ?? asset.currentMultiplier);
    const expectedEffective = asset.pendingMultiplier ? asset.pendingMultiplierEffectiveTime : null;
    const aligned = Boolean(
      onchain
      && onchain.chainId === PAYDAY_CHAIN_ID
      && onchain.uid === asset.uid
      && normalizeDecimal(onchain.currentMultiplier) === normalizeDecimal(asset.currentMultiplier)
      && normalizeDecimal(onchain.pendingMultiplier) === apiPending
      && onchain.effectiveAt === expectedEffective,
    );
    if (!onchain) {
      state = "unavailable";
      code = "ONCHAIN_STATE_UNAVAILABLE";
      reason = "The canonical token's ERC-8056 UID and multiplier state could not be read from chain 4663.";
      checks.push(evidence("onchain-state", "Onchain ERC-8056 state", "block", reason, "Robinhood Chain ERC-8056"));
    } else if (!aligned) {
      state = "blocked";
      code = "ONCHAIN_STATE_MISMATCH";
      reason = "The verified chain ID, canonical token UID, current multiplier, pending multiplier, or effective time does not exactly match chain 4663 and the official API.";
      checks.push(evidence("onchain-state", "Onchain ERC-8056 state", "block", reason, "Robinhood Chain ERC-8056"));
    } else {
      checks.push(evidence(
        "onchain-state",
        "Onchain ERC-8056 state",
        "pass",
        "The RPC reports chain 4663, and canonical uid(), uiMultiplier(), newUIMultiplier(), and effectiveAt() match the official API.",
        "Robinhood Chain ERC-8056",
      ));
    }
  }

  const relatedActions = asset
    ? source.actions.filter((action) => action.ticker === officialTicker)
    : [];
  const selected = selectRelevantAction(relatedActions);
  const action = selected.action;
  const processDateActions = actionsOnProcessDate(relatedActions, action);
  let corporateAction: PaydayData["corporateAction"] = null;
  let preview: PaydayPreview | null = null;

  if (asset && !["blocked", "unavailable"].includes(state) && action) {
    const canonicalAction = Boolean(
      action.uid === asset.uid
      && exactChainDeployment(action.deployments, canonicalAddress),
    );
    const recognizedStatus = action.status === COMPLETED || action.status === IN_PROGRESS;
    const isCashDividend = action.type === CASH_DIVIDEND;
    const validCashRecord = Boolean(
      !selected.ambiguous
      && canonicalAction
      && recognizedStatus
      && isCashDividend
      && action.amountPerUnit
      && action.underlyingSymbol === officialTicker
      && action.processDate
      && processDateActions.length === 1,
    );
    let concurrentTransition = false;

    if (selected.ambiguous) {
      state = "blocked";
      code = "AMBIGUOUS_ACTIVE_ACTIONS";
      reason = "Multiple in-progress corporate actions were reported; no multiplier transition was classified.";
    } else if (action.processDate && processDateActions.length !== 1) {
      state = "blocked";
      code = "AMBIGUOUS_PROCESS_DATE_ACTIONS";
      reason = "More than one corporate-action record exists for this asset on the selected process date, so temporal concurrency is ambiguous.";
    } else if (!canonicalAction) {
      state = "blocked";
      code = "ACTION_IDENTITY_MISMATCH";
      reason = "The corporate action UID or chain 4663 deployment does not match the canonical asset.";
    } else if (!recognizedStatus) {
      state = "blocked";
      code = "ACTION_STATUS_UNSUPPORTED";
      reason = "Only completed or in-progress corporate actions can be evaluated.";
    } else if (!isCashDividend) {
      state = "blocked";
      code = "NOT_CASH_DIVIDEND";
      reason = "This corporate action is not a cash dividend and is never treated as yield.";
    } else if (!action.amountPerUnit || action.underlyingSymbol !== officialTicker) {
      state = "blocked";
      code = "DIVIDEND_DETAILS_INVALID";
      reason = "The CASH_DIVIDEND rate or underlying symbol is missing or inconsistent, so the official record is not qualified.";
    } else if (action.status === COMPLETED) {
      state = "pending";
      code = "HISTORICAL_MULTIPLIER_BASELINE_UNAVAILABLE";
      reason = "The official CASH_DIVIDEND record is completed, but the endpoints do not expose a trustworthy pre-event multiplier baseline for this preview.";
    } else if (
      !asset.pendingMultiplier
      || !asset.pendingMultiplierEffectiveTime
      || !action.processDate
      || !sameUtcDate(action.processDate, asset.pendingMultiplierEffectiveTime)
      || !(preview = buildMultiplierPreview(asset.currentMultiplier, asset.pendingMultiplier))
    ) {
      state = "pending";
      code = "MULTIPLIER_TRANSITION_PENDING";
      reason = "The official CASH_DIVIDEND record is in progress, but a positive verified multiplier transition concurrent with its unique process date is not available yet.";
    } else {
      concurrentTransition = true;
      state = "eligible";
      code = "CONCURRENT_MULTIPLIER_TRANSITION_READY";
      reason = "A positive official/onchain multiplier transition is concurrent with one unambiguous official CASH_DIVIDEND process-date record. Robinhood processDate is a scheduling date, not an effective or payable timestamp. This is temporal correlation, not proof that the action caused the transition or created an entitlement.";
    }
    corporateAction = action.uid && action.type && action.status ? {
      uid: action.uid,
      type: action.type,
      status: action.status,
      processDate: action.processDate,
      sourceUpdatedAt: null,
      amountPerUnit: action.amountPerUnit,
      currency: action.currency,
      classification: concurrentTransition
        ? "multiplier-transition-concurrent-with-cash-dividend-process-date"
        : validCashRecord
          ? "cash-dividend-record-only"
          : "not-qualified",
    } : null;
    checks.push(evidence(
      "corporate-action",
      "Corporate action",
      state === "blocked" ? "block" : state === "eligible" ? "pass" : "pending",
      reason,
      OFFICIAL_PAYDAY_ACTIONS_URL,
    ));
  } else if (asset && !["blocked", "unavailable"].includes(state)) {
    checks.push(evidence(
      "corporate-action",
      "Corporate action",
      "pending",
      reason,
      OFFICIAL_PAYDAY_ACTIONS_URL,
    ));
  }

  const base: Omit<PaydayData, "integrity"> = {
    feature: "HoodFlow FlowRights / Payday Preview",
    version: "hoodflow-payday/1",
    asset: {
      uid: asset?.uid ?? null,
      ticker,
      name: asset?.name ?? null,
      type: assetType(ticker),
      logoUrl: asset?.logoUrl ?? null,
      chainId: PAYDAY_CHAIN_ID,
      contractAddress: canonicalAddress,
      currentMultiplier: asset?.currentMultiplier ?? null,
      pendingMultiplier: asset?.pendingMultiplier ?? null,
      pendingMultiplierEffectiveTime: asset?.pendingMultiplierEffectiveTime ?? null,
    },
    corporateAction,
    eligibility: { state, reason, code },
    evidence: checks,
    preview,
    capabilities: {
      readsOfficialSources: true,
      signs: false,
      submitsTransaction: false,
      requestsWalletPermission: false,
      createsClaimToken: false,
      controlsFunds: false,
      createsEntitlement: false,
    },
    generatedAt: source.fetchedAt,
    disclaimer: "Stock Tokens are not shares. Temporal concurrency with a CASH_DIVIDEND record does not prove causality or entitlement. This read-only calculation is not a dividend, quote, execution promise, or investment recommendation.",
    safety: "Read-only preview. No transaction, wallet permission, signature, entitlement, or execution handoff is created.",
    handoffAllowed: false,
    handoff: null,
    executionHandoff: null,
  };
  return {
    ...base,
    integrity: {
      algorithm: "sha256",
      checksum: await checksum(base),
      authenticating: false,
      notice: "This checksum detects accidental response changes. It is not a signature, attestation, proof of execution, or proof of entitlement.",
    },
  };
}
