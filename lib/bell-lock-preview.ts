import {
  stableActionLockFingerprint,
  type OfficialActionLockEvidence,
} from "@/lib/action-lock";
import { listAgentMarkets } from "@/lib/hoodflow-agent";
import {
  ROBINHOOD_MAINNET,
  ROBINHOOD_TOKENS,
} from "@/lib/hoodflow-mainnet";

const POLICY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const USDG_AMOUNT = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
const MAX_AMOUNT_USDG = 50_000;
const MAX_ARMED_AGE_MS = 31 * 24 * 60 * 60_000;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const OFFICIAL_PRICE_MAX_AGE_MS = 5 * 60_000;
const PREVIEW_RECHECK_MS = 15_000;

const FLAT_THRESHOLD_KEYS = [
  "maxGapBps",
  "maxSpreadBps",
  "maxOracleDexDeviationBps",
  "maxImpactBps",
  "convergenceSamples",
  "stressMultiplier",
] as const;

const FLAT_WINDOW_KEYS = ["windowExpirySeconds", "targetSession"] as const;

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "policyId",
  "chainId",
  "asset",
  "side",
  "amountUsdg",
  "armedAt",
  "thresholds",
  "window",
  ...FLAT_THRESHOLD_KEYS,
  ...FLAT_WINDOW_KEYS,
]);

const FORBIDDEN_CLIENT_FIELDS = [
  "evidence",
  "observation",
  "signature",
  "source",
  "depth",
  "provenance",
  "verifierreceipt",
  "reportid",
  "sessionreport",
  "memory",
  "proof",
  "handoff",
] as const;

export type BellLockPreviewPolicy = {
  policyId: string;
  chainId: typeof ROBINHOOD_MAINNET.chainIdNumber;
  asset: string;
  side: "buy";
  amountUsdg: string;
  armedAt: string;
  thresholds: {
    maxGapBps: number;
    maxSpreadBps: number;
    maxOracleDexDeviationBps: number;
    maxImpactBps: number;
    convergenceSamples: 2;
    stressMultiplier: 2;
  };
  window: {
    targetSession: "regular";
    expirySeconds: number;
    expiresAt: string | null;
  };
};

export type BellLockPreviewCheck = {
  id: string;
  label: string;
  status: "pass" | "wait" | "fail";
  value: string;
  limit?: string;
  detail?: string;
};

export type BellLockPreviewState =
  | "armed"
  | "warming"
  | "blocked"
  | "expired"
  | "unavailable";

export type BellLockPreviewEvaluation = {
  policyId: string;
  state: BellLockPreviewState;
  evaluatedAt: string;
  nextCheckAt?: string;
  windowExpiresAt?: string;
  summary: string;
  checks: BellLockPreviewCheck[];
  proof: {
    kind: "RefusalProof";
    verification: "source-observed";
    verificationTier: "source-observed-preview";
    signedSessionState: false;
    signedSessionVerified: false;
    policyId: string;
    state: BellLockPreviewState;
    issuedAt: string;
    generatedAt: string;
    expiresAt?: string;
    proofHash: string;
    checks: BellLockPreviewCheck[];
    reasons: Array<{ id: string; status: "wait" | "fail"; detail: string }>;
    capabilities: {
      signs: false;
      submitsTransaction: false;
      requestsWalletPermission: false;
    };
    handoffAllowed: false;
    notice: string;
    integrity: {
      algorithm: "SHA-256";
      digest: string;
      scope: "bell-lock-source-observed-preview";
      authenticatesPublisher: false;
    };
  };
  handoffAllowed: false;
  handoff: null;
  executionHandoff: null;
};

export class BellLockPreviewValidationError extends Error {}

function record(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BellLockPreviewValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function rejectClientEvidence(value: unknown, depth = 0) {
  if (depth > 8 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) rejectClientEvidence(item, depth + 1);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (FORBIDDEN_CLIENT_FIELDS.some((field) => normalized.includes(field))) {
      throw new BellLockPreviewValidationError(
        "Client-supplied evidence, observations, signatures, sources, depth, proofs, and handoffs are not accepted.",
      );
    }
    rejectClientEvidence(nested, depth + 1);
  }
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  required: readonly string[],
  label: string,
) {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = required.filter((key) => !(key in value));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new BellLockPreviewValidationError(`${label} has invalid fields.`);
  }
}

function boundedString(value: unknown, label: string, pattern: RegExp, maximumLength: number) {
  if (typeof value !== "string" || value.length > maximumLength || !pattern.test(value)) {
    throw new BellLockPreviewValidationError(`${label} is invalid.`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new BellLockPreviewValidationError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value as number;
}

function exactInteger<const Value extends number>(value: unknown, label: string, expected: Value): Value {
  if (value !== expected) {
    throw new BellLockPreviewValidationError(`${label} must be ${expected}.`);
  }
  return expected;
}

function isoTimestamp(value: unknown, label: string) {
  if (typeof value !== "string") throw new BellLockPreviewValidationError(`${label} must be an ISO timestamp.`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new BellLockPreviewValidationError(`${label} must be a canonical ISO timestamp.`);
  }
  return value;
}

function nestedPolicyParts(input: Record<string, unknown>) {
  const flatPresent = [...FLAT_THRESHOLD_KEYS, ...FLAT_WINDOW_KEYS].some((key) => key in input);
  const nestedPresent = "thresholds" in input || "window" in input;
  if (flatPresent && nestedPresent) {
    throw new BellLockPreviewValidationError("BellLock thresholds and window cannot mix flat and nested forms.");
  }

  if (!nestedPresent) {
    return {
      thresholds: input,
      window: input,
      expiresAt: null,
      expirySecondsKey: "windowExpirySeconds" as const,
    };
  }

  const thresholds = record(input.thresholds, "BellLock thresholds");
  exactKeys(
    thresholds,
    new Set(FLAT_THRESHOLD_KEYS),
    FLAT_THRESHOLD_KEYS,
    "BellLock thresholds",
  );
  const window = record(input.window, "BellLock window");
  exactKeys(
    window,
    new Set(["targetSession", "expirySeconds", "windowExpirySeconds", "expiresAt"]),
    ["targetSession"],
    "BellLock window",
  );
  const hasExpirySeconds = "expirySeconds" in window;
  const hasWindowExpirySeconds = "windowExpirySeconds" in window;
  if (hasExpirySeconds === hasWindowExpirySeconds) {
    throw new BellLockPreviewValidationError("BellLock window must include exactly one expiry-seconds field.");
  }
  return {
    thresholds,
    window,
    expiresAt: window.expiresAt === undefined ? null : isoTimestamp(window.expiresAt, "window.expiresAt"),
    expirySecondsKey: hasExpirySeconds ? "expirySeconds" as const : "windowExpirySeconds" as const,
  };
}

export function parseBellLockPreviewRequest(
  value: unknown,
  nowMs = Date.now(),
): BellLockPreviewPolicy {
  rejectClientEvidence(value);
  const input = record(value, "BellLock request");
  exactKeys(
    input,
    ALLOWED_TOP_LEVEL_KEYS,
    ["policyId", "asset", "amountUsdg", "armedAt"],
    "BellLock request",
  );

  const chainId = input.chainId ?? ROBINHOOD_MAINNET.chainIdNumber;
  if (chainId !== ROBINHOOD_MAINNET.chainIdNumber) {
    throw new BellLockPreviewValidationError("chainId must identify Robinhood Chain mainnet (4663).");
  }
  const side = input.side ?? "buy";
  if (side !== "buy") throw new BellLockPreviewValidationError("BellLock preview supports buy intent only.");

  if (typeof input.asset !== "string" || !/^[A-Za-z0-9]{1,16}$/.test(input.asset)) {
    throw new BellLockPreviewValidationError("asset is invalid.");
  }
  const asset = input.asset.toUpperCase();
  const market = listAgentMarkets().find((item) => item.ticker === asset);
  if (!market || !ROBINHOOD_TOKENS[asset]) {
    throw new BellLockPreviewValidationError("asset must be a route-reviewed Robinhood Chain market.");
  }

  const amountUsdg = boundedString(input.amountUsdg, "amountUsdg", USDG_AMOUNT, 32);
  const amount = Number(amountUsdg);
  if (!Number.isFinite(amount) || amount < 1 || amount > MAX_AMOUNT_USDG) {
    throw new BellLockPreviewValidationError("amountUsdg must be between 1 and 50,000 with up to six decimals.");
  }

  const policyId = boundedString(input.policyId, "policyId", POLICY_ID, 128);
  const armedAt = isoTimestamp(input.armedAt, "armedAt");
  const armedAtMs = Date.parse(armedAt);
  if (armedAtMs > nowMs + MAX_CLOCK_SKEW_MS || armedAtMs < nowMs - MAX_ARMED_AGE_MS) {
    throw new BellLockPreviewValidationError("armedAt is outside the bounded policy arming period.");
  }

  const parts = nestedPolicyParts(input);
  const expiresAt = parts.expiresAt;
  if (expiresAt) {
    const expiresAtMs = Date.parse(expiresAt);
    if (expiresAtMs <= armedAtMs || expiresAtMs - armedAtMs > MAX_ARMED_AGE_MS) {
      throw new BellLockPreviewValidationError("window.expiresAt is outside the bounded policy lifetime.");
    }
  }
  if (parts.window.targetSession !== "regular") {
    throw new BellLockPreviewValidationError("targetSession must be regular.");
  }

  return {
    policyId,
    chainId: ROBINHOOD_MAINNET.chainIdNumber,
    asset,
    side: "buy",
    amountUsdg,
    armedAt,
    thresholds: {
      maxGapBps: integer(parts.thresholds.maxGapBps, "maxGapBps", 10, 2_500),
      maxSpreadBps: integer(parts.thresholds.maxSpreadBps, "maxSpreadBps", 5, 1_000),
      maxOracleDexDeviationBps: integer(
        parts.thresholds.maxOracleDexDeviationBps,
        "maxOracleDexDeviationBps",
        5,
        1_000,
      ),
      maxImpactBps: integer(parts.thresholds.maxImpactBps, "maxImpactBps", 5, 1_000),
      convergenceSamples: exactInteger(parts.thresholds.convergenceSamples, "convergenceSamples", 2),
      stressMultiplier: exactInteger(parts.thresholds.stressMultiplier, "stressMultiplier", 2),
    },
    window: {
      targetSession: "regular",
      expirySeconds: integer(parts.window[parts.expirySecondsKey], "windowExpirySeconds", 30, 300),
      expiresAt,
    },
  };
}

function percentFromBps(value: number) {
  return `${(value / 100).toFixed(2)}%`;
}

function normalizeDecimal(value: string | null | undefined) {
  if (!value || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${BigInt(whole)}.${normalizedFraction}` : BigInt(whole).toString();
}

function newYorkWeekdayHeuristic(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = values.weekday ?? "Unknown";
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  const minuteOfDay = hour * 60 + minute;
  const weekdaySession = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
  return {
    appearsOpen: weekdaySession && minuteOfDay >= 9 * 60 + 30 && minuteOfDay < 16 * 60,
    label: `${weekday} ${values.hour ?? "--"}:${values.minute ?? "--"} America/New_York`,
  };
}

function officialPriceSpreadCheck(
  evidence: OfficialActionLockEvidence | null,
  policy: BellLockPreviewPolicy,
  evaluatedAtMs: number,
): BellLockPreviewCheck {
  const envelope = evidence?.price;
  const price = envelope?.status === "available" ? envelope.value : null;
  const generatedAtMs = price?.generatedAt ? Date.parse(price.generatedAt) : Number.NaN;
  const ageMs = evaluatedAtMs - generatedAtMs;
  const bid = Number(price?.bid);
  const ask = Number(price?.ask);
  if (
    !price
    || !Number.isFinite(generatedAtMs)
    || ageMs < -60_000
    || ageMs > OFFICIAL_PRICE_MAX_AGE_MS
    || !Number.isFinite(bid)
    || !Number.isFinite(ask)
    || bid <= 0
    || ask < bid
  ) {
    return {
      id: "spread",
      label: "Bid / ask spread",
      status: "wait",
      value: "Fresh official REST bid / ask unavailable",
      limit: `\u2264 ${percentFromBps(policy.thresholds.maxSpreadBps)}`,
      detail: "Unsigned official REST context is incomplete or older than five minutes; it is not cryptographic price evidence.",
    };
  }
  const midpoint = (ask + bid) / 2;
  const spreadBps = midpoint > 0 ? Math.round((ask - bid) / midpoint * 10_000) : Number.POSITIVE_INFINITY;
  const failed = spreadBps > policy.thresholds.maxSpreadBps;
  return {
    id: "spread",
    label: "Bid / ask spread",
    status: failed ? "fail" : "pass",
    value: `${percentFromBps(spreadBps)} unsigned official REST preview`,
    limit: `\u2264 ${percentFromBps(policy.thresholds.maxSpreadBps)}`,
    detail: failed
      ? "The source-observed preview spread exceeds the policy boundary; no handoff is permitted."
      : "This is an unsigned Robinhood Stock Token REST observation, not a verified Data Streams report.",
  };
}

function issuerCheck(
  evidence: OfficialActionLockEvidence | null,
  policy: BellLockPreviewPolicy,
): BellLockPreviewCheck {
  const asset = evidence?.asset.status === "available" ? evidence.asset.value : null;
  const price = evidence?.price.status === "available" ? evidence.price.value : null;
  const actions = evidence?.corporateActions.status === "available"
    ? evidence.corporateActions.value
    : null;
  const onchain = evidence?.onchainMultiplier.status === "available"
    ? evidence.onchainMultiplier.value
    : null;
  const deployment = asset?.deployments.find(
    (item) => item.chainId === ROBINHOOD_MAINNET.chainIdNumber,
  );
  const canonicalAddress = ROBINHOOD_TOKENS[policy.asset]?.toLowerCase();
  const deploymentMismatch = Boolean(
    deployment
    && canonicalAddress
    && deployment.contractAddress.toLowerCase() !== canonicalAddress,
  );
  const inProgressAction = actions?.some(
    (action) => action.status === "CORPORATE_ACTION_STATUS_IN_PROGRESS",
  ) ?? false;
  const officialCurrent = normalizeDecimal(asset?.currentMultiplier);
  const officialPending = normalizeDecimal(asset?.pendingMultiplier);
  const onchainCurrent = normalizeDecimal(onchain?.currentMultiplier);
  const onchainPending = normalizeDecimal(onchain?.pendingMultiplier);
  const multiplierMismatch = Boolean(
    officialCurrent
    && onchainCurrent
    && officialCurrent !== onchainCurrent,
  );
  const multiplierChange = Boolean(
    (officialCurrent && officialPending && officialCurrent !== officialPending)
    || (onchainCurrent && onchainPending && onchainCurrent !== onchainPending),
  );
  const failed = asset?.status === "ASSET_STATUS_INACTIVE"
    || price?.isTradingHalt === true
    || deploymentMismatch
    || inProgressAction
    || multiplierMismatch
    || multiplierChange;
  if (failed) {
    const reasons = [
      asset?.status === "ASSET_STATUS_INACTIVE" ? "inactive token" : null,
      price?.isTradingHalt === true ? "reported trading halt" : null,
      deploymentMismatch ? "chain 4663 deployment mismatch" : null,
      inProgressAction ? "in-progress corporate action" : null,
      multiplierMismatch ? "API/onchain multiplier mismatch" : null,
      multiplierChange ? "pending multiplier change" : null,
    ].filter((reason): reason is string => Boolean(reason));
    return {
      id: "issuer",
      label: "Halt + corporate action",
      status: "fail",
      value: reasons.join(", "),
      detail: "One or more unsigned official REST/onchain preview observations fail closed.",
    };
  }

  const complete = Boolean(
    asset
    && price
    && actions
    && onchain
    && deployment
    && canonicalAddress
    && asset.status === "ASSET_STATUS_ACTIVE"
    && price.isTradingHalt === false
    && officialCurrent
    && onchainCurrent,
  );
  return complete
    ? {
        id: "issuer",
        label: "Halt + corporate action",
        status: "pass",
        value: "No unsafe condition in source-observed preview",
        detail: "Unsigned official REST state and the canonical ERC-8056 read align; this is not a signed session proof.",
      }
    : {
        id: "issuer",
        label: "Halt + corporate action",
        status: "wait",
        value: "Official REST/onchain context incomplete",
        detail: "The preview cannot confirm every issuer, halt, corporate-action, deployment, and multiplier field.",
      };
}

function allOfficialSourcesUnavailable(evidence: OfficialActionLockEvidence | null) {
  if (!evidence) return true;
  return [
    evidence.asset.status,
    evidence.price.status,
    evidence.corporateActions.status,
    evidence.onchainMultiplier.status,
  ].every((status) => status !== "available");
}

function summaryFor(state: BellLockPreviewState) {
  switch (state) {
    case "blocked":
      return "An unsigned official preview observation crossed a policy boundary. BellLock refused every execution handoff.";
    case "expired":
      return "The bounded policy window expired. BellLock refused every execution handoff.";
    case "unavailable":
      return "Official preview observations are unavailable. BellLock failed closed and created no execution handoff.";
    case "warming":
      return "The New York weekday-hours heuristic is inside regular hours, but signed session and price evidence are unavailable. BellLock remains closed.";
    case "armed":
      return "BellLock remains armed outside the New York weekday-hours heuristic. No holiday or signed-session claim is made.";
  }
}

export async function buildBellLockPreviewEvaluation(
  policy: BellLockPreviewPolicy,
  evidence: OfficialActionLockEvidence | null,
  now = new Date(),
): Promise<BellLockPreviewEvaluation> {
  const evaluatedAt = now.toISOString();
  const evaluatedAtMs = now.getTime();
  const heuristic = newYorkWeekdayHeuristic(now);
  const expiresAt = policy.window.expiresAt;
  const expired = Boolean(expiresAt && Date.parse(expiresAt) <= evaluatedAtMs);

  const checks: BellLockPreviewCheck[] = [
    {
      id: "session",
      label: "Regular session state",
      status: "wait",
      value: `${heuristic.appearsOpen ? "Inside" : "Outside"} weekday-hours heuristic (${heuristic.label})`,
      limit: "NY weekdays 09:30–16:00 (heuristic only)",
      detail: "Unverified schedule heuristic only. It does not consult a holiday calendar and is not a signed market-session observation.",
    },
    {
      id: "convergence",
      label: "Two opening observations",
      status: "wait",
      value: `0 / ${policy.thresholds.convergenceSamples} cryptographically verified observations`,
      limit: `${policy.thresholds.convergenceSamples} distinct signed observations`,
      detail: "Data Streams credentials and feed mapping are not configured, so client observations are ignored and convergence cannot pass.",
    },
    {
      id: "gap",
      label: "Opening gap",
      status: "wait",
      value: "Verified previous close and opening report unavailable",
      limit: `\u2264 ${percentFromBps(policy.thresholds.maxGapBps)}`,
      detail: "Unsigned REST context cannot establish the signed previous-close-to-open gap required by this policy.",
    },
    officialPriceSpreadCheck(evidence, policy, evaluatedAtMs),
    {
      id: "deviation",
      label: "Oracle / DEX deviation",
      status: "wait",
      value: "Execution-bound oracle / DEX comparison unavailable",
      limit: `\u2264 ${percentFromBps(policy.thresholds.maxOracleDexDeviationBps)}`,
      detail: "The preview does not treat unsigned official prices as cryptographic oracle evidence and does not create an executable quote.",
    },
    {
      id: "depth",
      label: "Exact-size route",
      status: "wait",
      value: `${policy.amountUsdg} USDG route depth not evaluated`,
      limit: `\u2264 ${percentFromBps(policy.thresholds.maxImpactBps)} impact`,
      detail: "No client depth or quote is accepted. A fresh server-side execution preflight would be required in a separate user-signature flow.",
    },
    {
      id: "stress",
      label: `${policy.thresholds.stressMultiplier}\u00d7 stress size`,
      status: "wait",
      value: `${(Number(policy.amountUsdg) * policy.thresholds.stressMultiplier).toFixed(6).replace(/\.?0+$/, "")} USDG route depth not evaluated`,
      limit: `\u2264 ${percentFromBps(policy.thresholds.maxImpactBps)} impact`,
      detail: "No client depth or quote is accepted. Preview-only source observations cannot satisfy route-depth policy checks.",
    },
    issuerCheck(evidence, policy),
  ];

  const state: BellLockPreviewState = expired
    ? "expired"
    : checks.some((check) => check.status === "fail")
      ? "blocked"
      : allOfficialSourcesUnavailable(evidence)
        ? "unavailable"
        : heuristic.appearsOpen
          ? "warming"
          : "armed";
  const summary = summaryFor(state);
  const proofCore = {
    kind: "RefusalProof" as const,
    verification: "source-observed" as const,
    verificationTier: "source-observed-preview" as const,
    signedSessionState: false as const,
    signedSessionVerified: false as const,
    policyId: policy.policyId,
    state,
    issuedAt: evaluatedAt,
    generatedAt: evaluatedAt,
    ...(expiresAt ? { expiresAt } : {}),
    policy: {
      chainId: policy.chainId,
      asset: policy.asset,
      side: policy.side,
      amountUsdg: policy.amountUsdg,
      armedAt: policy.armedAt,
      thresholds: policy.thresholds,
      window: policy.window,
    },
    checks,
    reasons: checks
      .filter((check): check is BellLockPreviewCheck & { status: "wait" | "fail" } => check.status !== "pass")
      .map((check) => ({ id: check.id, status: check.status, detail: check.detail ?? check.value })),
    capabilities: {
      signs: false as const,
      submitsTransaction: false as const,
      requestsWalletPermission: false as const,
    },
    handoffAllowed: false as const,
    notice: "RefusalProof records a fail-closed source-observed preview only. It is not a Data Streams attestation, does not authenticate a publisher, and cannot authorize execution.",
  };
  const proofHash = await stableActionLockFingerprint(proofCore);
  const proof = {
    ...proofCore,
    proofHash,
    integrity: {
      algorithm: "SHA-256" as const,
      digest: proofHash,
      scope: "bell-lock-source-observed-preview" as const,
      authenticatesPublisher: false as const,
    },
  };

  return {
    policyId: policy.policyId,
    state,
    evaluatedAt,
    ...(!["blocked", "expired", "unavailable"].includes(state)
      ? { nextCheckAt: new Date(evaluatedAtMs + PREVIEW_RECHECK_MS).toISOString() }
      : {}),
    ...(expiresAt ? { windowExpiresAt: expiresAt } : {}),
    summary,
    checks,
    proof,
    handoffAllowed: false,
    handoff: null,
    executionHandoff: null,
  };
}
