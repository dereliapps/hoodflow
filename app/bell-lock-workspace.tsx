"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { seoAssets } from "@/lib/seo-assets";

import styles from "./bell-lock-workspace.module.css";

type BellState = "armed" | "warming" | "ready" | "refused" | "expired";
type CheckState = "pass" | "wait" | "fail";

type BellLockPolicy = {
  policyId: string;
  armedAt: string;
  asset: string;
  amountUsdg: string;
  maxGapBps: number;
  maxSpreadBps: number;
  maxOracleDexDeviationBps: number;
  maxImpactBps: number;
  convergenceSamples: 2;
  windowExpirySeconds: number;
  targetSession: "regular";
  stressMultiplier: 2;
};

type BellLockMemory = {
  baseline?: Record<string, unknown>;
  openingObservations: Record<string, unknown>[];
};

type BellCheck = {
  id: string;
  label: string;
  status: CheckState;
  value: string;
  limit?: string;
  detail?: string;
};

type BellProof = {
  kind: "BellProof" | "RefusalProof";
  verification: "source-observed" | "signed-session";
  proofHash?: string;
  issuedAt?: string;
  expiresAt?: string;
  raw: Record<string, unknown>;
};

type BellLockEvaluation = {
  policyId: string;
  state: BellState;
  evaluatedAt: string;
  nextCheckAt?: string;
  windowExpiresAt?: string;
  summary: string;
  checks: BellCheck[];
  proof?: BellProof;
  handoff?: { href: string };
  memory: BellLockMemory;
};

type StoredPolicy = {
  policy: BellLockPolicy;
  memory: BellLockMemory;
  lastState: BellState;
  lastSummary: string;
  lastEvaluatedAt: string;
};

type DraftPolicy = {
  asset: string;
  amountUsdg: string;
  maxGapPercent: string;
  maxSpreadPercent: string;
  maxDeviationPercent: string;
  maxImpactPercent: string;
  windowExpirySeconds: string;
};

type BellLockWorkspaceProps = {
  onOpenMarket?: (
    ticker: string,
    intent: { side: "buy"; amount: string; slippageBps: number },
  ) => void;
};

const STORAGE_KEY = "hoodflow-bell-lock-policies-v1";
const MAX_STORED_POLICIES = 12;
const MONITOR_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_MEMORY_ENTRY_BYTES = 12_000;
const MARKETS = seoAssets.filter((market) => market.fullFill);
const MARKET_TICKERS = new Set(MARKETS.map((market) => market.ticker));

const DEFAULT_DRAFT: DraftPolicy = {
  asset: "AAPL",
  amountUsdg: "100",
  maxGapPercent: "3",
  maxSpreadPercent: "0.40",
  maxDeviationPercent: "0.80",
  maxImpactPercent: "0.75",
  windowExpirySeconds: "90",
};

const DEFAULT_CHECKS: Array<Pick<BellCheck, "id" | "label">> = [
  { id: "session", label: "Regular session state" },
  { id: "convergence", label: "Two opening observations" },
  { id: "gap", label: "Opening gap" },
  { id: "spread", label: "Bid / ask spread" },
  { id: "deviation", label: "Oracle / DEX deviation" },
  { id: "depth", label: "Exact-size route" },
  { id: "stress", label: "2x stress size" },
  { id: "issuer", label: "Halt + corporate action" },
];

const STATE_COPY: Record<BellState, { label: string; eyebrow: string; description: string }> = {
  armed: {
    label: "Armed",
    eyebrow: "WAITING FOR THE BELL",
    description: "The policy is pinned to the next eligible regular-session transition.",
  },
  warming: {
    label: "Warming",
    eyebrow: "OPENING OBSERVATIONS",
    description: "The market moved, but two distinct post-open observations have not converged yet.",
  },
  ready: {
    label: "Ready",
    eyebrow: "SIGN WINDOW OPEN",
    description: "Every configured boundary passed. A fresh wallet decision is still required.",
  },
  refused: {
    label: "Refused",
    eyebrow: "POLICY HELD THE LINE",
    description: "At least one hard boundary failed, so HoodFlow did not open the trade handoff.",
  },
  expired: {
    label: "Expired",
    eyebrow: "WINDOW CLOSED",
    description: "The bounded signing window ended. Re-arm a new policy for a new observation window.",
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function boundedRecord(value: unknown) {
  const record = asRecord(value);
  if (!record) return undefined;
  try {
    if (JSON.stringify(record).length > MAX_MEMORY_ENTRY_BYTES) return undefined;
  } catch {
    return undefined;
  }
  return record;
}

function sanitizeMemory(value: unknown): BellLockMemory {
  const record = asRecord(value);
  const baseline = boundedRecord(record?.baseline);
  const observations = Array.isArray(record?.openingObservations)
    ? record.openingObservations.map(boundedRecord).filter((item): item is Record<string, unknown> => Boolean(item)).slice(-2)
    : [];
  return { ...(baseline ? { baseline } : {}), openingObservations: observations };
}

function mergeObservationMemory(
  previous: BellLockMemory,
  payload: Record<string, unknown>,
): BellLockMemory {
  if (payload.memory !== undefined) return sanitizeMemory(payload.memory);
  const baseline = boundedRecord(payload.baseline) ?? previous.baseline;
  const observation = boundedRecord(payload.observation);
  const observations = [...previous.openingObservations];
  if (observation) {
    const fingerprint = JSON.stringify(observation);
    if (!observations.some((item) => JSON.stringify(item) === fingerprint)) observations.push(observation);
  }
  return {
    ...(baseline ? { baseline } : {}),
    openingObservations: observations.slice(-2),
  };
}

function normalizeState(value: unknown): BellState | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  if (normalized === "armed" || normalized === "waiting" || normalized === "closed") return "armed";
  if (normalized === "warming" || normalized === "warm-up" || normalized === "observing") return "warming";
  if (normalized === "ready" || normalized === "verified-open") return "ready";
  if (normalized === "refused" || normalized === "blocked" || normalized === "failed" || normalized === "unavailable") return "refused";
  if (normalized === "expired" || normalized === "missed") return "expired";
  return null;
}

function normalizeCheckState(value: unknown): CheckState {
  if (typeof value !== "string") return "wait";
  const normalized = value.toLowerCase();
  if (["pass", "passed", "clear", "ready"].includes(normalized)) return "pass";
  if (["fail", "failed", "block", "blocked", "refused"].includes(normalized)) return "fail";
  return "wait";
}

function parseChecks(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index): BellCheck[] => {
    const check = asRecord(item);
    if (!check) return [];
    return [{
      id: typeof check.id === "string" ? check.id : typeof check.code === "string" ? check.code : `check-${index + 1}`,
      label: typeof check.label === "string" ? check.label : `Boundary ${index + 1}`,
      status: normalizeCheckState(check.status),
      value: typeof check.value === "string" || typeof check.value === "number" ? String(check.value) : "Awaiting observation",
      ...(typeof check.limit === "string" || typeof check.limit === "number" ? { limit: String(check.limit) } : {}),
      ...(typeof check.detail === "string" ? { detail: check.detail } : {}),
    }];
  }).slice(0, 16);
}

function parseProof(value: unknown, state: BellState): BellProof | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const rawKind = raw.kind;
  const kind = rawKind === "RefusalProof" || state === "refused" ? "RefusalProof" : "BellProof";
  const integrity = asRecord(raw.integrity);
  return {
    kind,
    verification: raw.verification === "signed-session"
      || raw.verificationTier === "signed-session"
      || raw.signedSessionVerified === true
      || raw.signedSessionState === true
      ? "signed-session"
      : "source-observed",
    ...(typeof raw.proofHash === "string" ? { proofHash: raw.proofHash } : typeof integrity?.digest === "string" ? { proofHash: integrity.digest } : {}),
    ...(typeof raw.issuedAt === "string" ? { issuedAt: raw.issuedAt } : typeof raw.generatedAt === "string" ? { issuedAt: raw.generatedAt } : {}),
    ...(typeof raw.expiresAt === "string" ? { expiresAt: raw.expiresAt } : typeof raw.validUntil === "string" ? { expiresAt: raw.validUntil } : {}),
    raw,
  };
}

function parseEvaluation(
  value: unknown,
  policy: BellLockPolicy,
  previousMemory: BellLockMemory,
): BellLockEvaluation {
  const outer = asRecord(value);
  const nested = asRecord(outer?.result);
  const payload = nested ?? outer;
  if (!payload) throw new Error("BellLock returned an unreadable evaluation.");
  const state = normalizeState(payload.state ?? payload.status ?? payload.decision);
  if (!state) throw new Error("BellLock returned an unknown policy state.");
  const policyId = typeof payload.policyId === "string" ? payload.policyId : policy.policyId;
  if (policyId !== policy.policyId) throw new Error("BellLock returned an evaluation for a different policy.");
  const handoffRecord = asRecord(payload.handoff);
  const href = typeof handoffRecord?.href === "string" && handoffRecord.href.startsWith("/") && !handoffRecord.href.startsWith("//")
    ? handoffRecord.href
    : undefined;
  const proof = parseProof(payload.proof, state);
  return {
    policyId,
    state,
    evaluatedAt: typeof payload.evaluatedAt === "string" ? payload.evaluatedAt : new Date().toISOString(),
    ...(typeof payload.nextCheckAt === "string" ? { nextCheckAt: payload.nextCheckAt } : {}),
    ...(typeof payload.windowExpiresAt === "string" ? { windowExpiresAt: payload.windowExpiresAt } : {}),
    summary: typeof payload.summary === "string" ? payload.summary : STATE_COPY[state].description,
    checks: parseChecks(payload.checks),
    ...(proof ? { proof } : {}),
    ...(href ? { handoff: { href } } : {}),
    memory: mergeObservationMemory(previousMemory, payload),
  };
}

function numberInRange(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function sanitizeStoredPolicy(value: unknown): StoredPolicy | null {
  const item = asRecord(value);
  const policy = asRecord(item?.policy);
  const state = normalizeState(item?.lastState);
  if (
    !item
    || !policy
    || typeof policy.policyId !== "string"
    || policy.policyId.length < 8
    || typeof policy.armedAt !== "string"
    || !MARKET_TICKERS.has(String(policy.asset))
    || typeof policy.amountUsdg !== "string"
    || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(policy.amountUsdg)
    || !numberInRange(Number(policy.amountUsdg), 1, 50_000)
    || !numberInRange(policy.maxGapBps, 10, 2_500)
    || !numberInRange(policy.maxSpreadBps, 5, 1_000)
    || !numberInRange(policy.maxOracleDexDeviationBps, 5, 1_000)
    || !numberInRange(policy.maxImpactBps, 5, 1_000)
    || policy.convergenceSamples !== 2
    || !numberInRange(policy.windowExpirySeconds, 30, 300)
    || policy.targetSession !== "regular"
    || policy.stressMultiplier !== 2
    || !state
  ) return null;
  return {
    policy: policy as BellLockPolicy,
    memory: sanitizeMemory(item.memory),
    lastState: state,
    lastSummary: typeof item.lastSummary === "string" ? item.lastSummary : STATE_COPY[state].description,
    lastEvaluatedAt: typeof item.lastEvaluatedAt === "string" ? item.lastEvaluatedAt : policy.armedAt,
  };
}

function loadStoredPolicies() {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeStoredPolicy).filter((item): item is StoredPolicy => Boolean(item)).slice(0, MAX_STORED_POLICIES);
  } catch {
    return [];
  }
}

function percentToBps(value: string) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : Number.NaN;
}

function formatPercentBps(value: number) {
  return `${(value / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function formatTimestamp(value?: string) {
  if (!value) return "Not observed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not observed";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function shortId(value: string) {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function policyToDraft(policy: BellLockPolicy): DraftPolicy {
  return {
    asset: policy.asset,
    amountUsdg: policy.amountUsdg,
    maxGapPercent: String(policy.maxGapBps / 100),
    maxSpreadPercent: String(policy.maxSpreadBps / 100),
    maxDeviationPercent: String(policy.maxOracleDexDeviationBps / 100),
    maxImpactPercent: String(policy.maxImpactBps / 100),
    windowExpirySeconds: String(policy.windowExpirySeconds),
  };
}

function localArmedEvaluation(policy: BellLockPolicy, memory: BellLockMemory): BellLockEvaluation {
  return {
    policyId: policy.policyId,
    state: "armed",
    evaluatedAt: policy.armedAt,
    summary: "Policy saved locally. Waiting for a bounded regular-session evaluation.",
    checks: [],
    memory,
  };
}

function createPolicyId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `bell-${crypto.randomUUID()}`;
  return `bell-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function BellLockWorkspace({ onOpenMarket }: BellLockWorkspaceProps) {
  const [draft, setDraft] = useState<DraftPolicy>(DEFAULT_DRAFT);
  const [storedPolicies, setStoredPolicies] = useState<StoredPolicy[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [activePolicy, setActivePolicy] = useState<BellLockPolicy | null>(null);
  const [memory, setMemory] = useState<BellLockMemory>({ openingObservations: [] });
  const [result, setResult] = useState<BellLockEvaluation | null>(null);
  const [monitoring, setMonitoring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const requestRef = useRef<AbortController | null>(null);

  const activeMarket = activePolicy ? MARKETS.find((market) => market.ticker === activePolicy.asset) : undefined;
  const displayedChecks = useMemo<BellCheck[]>(() => {
    if (result?.checks.length) return result.checks;
    return DEFAULT_CHECKS.map((check) => ({
      ...check,
      status: "wait" as const,
      value: "Awaiting evaluation",
    }));
  }, [result]);
  const expirySeconds = result?.windowExpiresAt
    ? Math.max(0, Math.ceil((Date.parse(result.windowExpiresAt) - clock) / 1_000))
    : null;
  const state: BellState = result?.state === "ready" && expirySeconds === 0 ? "expired" : result?.state ?? "armed";
  const stateCopy = STATE_COPY[state];

  useEffect(() => {
    const hydrate = window.setTimeout(() => {
      const requestedAsset = new URLSearchParams(window.location.search).get("bellAsset")?.trim().toUpperCase();
      if (requestedAsset && MARKET_TICKERS.has(requestedAsset)) {
        setDraft((current) => ({ ...current, asset: requestedAsset }));
      }
      setStoredPolicies(loadStoredPolicies());
      setStorageReady(true);
    }, 0);
    return () => window.clearTimeout(hydrate);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedPolicies.slice(0, MAX_STORED_POLICIES)));
    } catch {
      // Device storage is optional. The active in-memory policy remains usable.
    }
  }, [storageReady, storedPolicies]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => {
      window.clearInterval(timer);
      requestRef.current?.abort();
    };
  }, []);

  const persistSnapshot = useCallback((
    policy: BellLockPolicy,
    nextMemory: BellLockMemory,
    evaluation: BellLockEvaluation,
  ) => {
    setStoredPolicies((current) => {
      const record: StoredPolicy = {
        policy,
        memory: nextMemory,
        lastState: evaluation.state,
        lastSummary: evaluation.summary,
        lastEvaluatedAt: evaluation.evaluatedAt,
      };
      return [record, ...current.filter((item) => item.policy.policyId !== policy.policyId)].slice(0, MAX_STORED_POLICIES);
    });
  }, []);

  const evaluatePolicy = useCallback(async (
    policy: BellLockPolicy,
    priorMemory: BellLockMemory,
    manual = false,
  ) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    if (manual) setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/bell-lock/evaluate", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        // Device memory is deliberately not sent as authoritative evidence.
        body: JSON.stringify(policy),
        cache: "no-store",
        signal: controller.signal,
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        // The response error below is more useful than a JSON parsing exception.
      }
      if (!response.ok) {
        const apiError = asRecord(payload);
        const retryAfter = response.headers.get("retry-after");
        const suffix = retryAfter ? ` Retry in about ${retryAfter}s.` : "";
        throw new Error(`${typeof apiError?.error === "string" ? apiError.error : "BellLock could not evaluate this window."}${suffix}`);
      }
      const evaluation = parseEvaluation(payload, policy, priorMemory);
      setResult(evaluation);
      setMemory(evaluation.memory);
      setClock(Date.now());
      persistSnapshot(policy, evaluation.memory, evaluation);
      if (evaluation.state === "ready" || evaluation.state === "refused" || evaluation.state === "expired") {
        setMonitoring(false);
      }
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") {
        if (!timedOut) return;
        setError("The BellLock evaluation timed out. The passive policy remains armed on this device.");
      } else {
        setError(requestError instanceof Error ? requestError.message : "BellLock could not evaluate this window.");
      }
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) {
        requestRef.current = null;
        setBusy(false);
      }
    }
  }, [persistSnapshot]);

  useEffect(() => {
    if (!monitoring || !activePolicy || !["armed", "warming"].includes(result?.state ?? "armed")) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState === "visible" && !requestRef.current) {
        void evaluatePolicy(activePolicy, memory);
      }
    }, MONITOR_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [activePolicy, evaluatePolicy, memory, monitoring, result?.evaluatedAt, result?.state]);

  function updateDraft<Key extends keyof DraftPolicy>(key: Key, value: DraftPolicy[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setNotice("");
  }

  function buildPolicy(): BellLockPolicy {
    const amount = Number(draft.amountUsdg);
    const gap = percentToBps(draft.maxGapPercent);
    const spread = percentToBps(draft.maxSpreadPercent);
    const deviation = percentToBps(draft.maxDeviationPercent);
    const impact = percentToBps(draft.maxImpactPercent);
    const expiry = Number(draft.windowExpirySeconds);
    if (!MARKET_TICKERS.has(draft.asset)) throw new Error("Choose a reviewed Stock Token route.");
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(draft.amountUsdg) || amount < 1 || amount > 50_000) {
      throw new Error("USDG amount must be between 1 and 50,000 with up to six decimals.");
    }
    if (!numberInRange(gap, 10, 2_500)) throw new Error("Maximum opening gap must be between 0.10% and 25.00%.");
    if (!numberInRange(spread, 5, 1_000)) throw new Error("Maximum spread must be between 0.05% and 10.00%.");
    if (!numberInRange(deviation, 5, 1_000)) throw new Error("Oracle / DEX deviation must be between 0.05% and 10.00%.");
    if (!numberInRange(impact, 5, 1_000)) throw new Error("Maximum impact must be between 0.05% and 10.00%.");
    if (!numberInRange(expiry, 30, 300)) throw new Error("Signing window must be between 30 and 300 seconds.");
    return {
      policyId: createPolicyId(),
      armedAt: new Date().toISOString(),
      asset: draft.asset,
      amountUsdg: draft.amountUsdg,
      maxGapBps: gap,
      maxSpreadBps: spread,
      maxOracleDexDeviationBps: deviation,
      maxImpactBps: impact,
      convergenceSamples: 2,
      windowExpirySeconds: expiry,
      targetSession: "regular",
      stressMultiplier: 2,
    };
  }

  async function armPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const policy = buildPolicy();
      const emptyMemory: BellLockMemory = { openingObservations: [] };
      const armed = localArmedEvaluation(policy, emptyMemory);
      setActivePolicy(policy);
      setMemory(emptyMemory);
      setResult(armed);
      setMonitoring(true);
      setError("");
      setNotice("Passive policy armed on this device. No wallet permission was created.");
      persistSnapshot(policy, emptyMemory, armed);
      await evaluatePolicy(policy, emptyMemory, true);
    } catch (policyError) {
      setError(policyError instanceof Error ? policyError.message : "Review the policy values.");
    }
  }

  function loadPolicy(item: StoredPolicy) {
    requestRef.current?.abort();
    const loadedState: BellState = item.lastState === "ready" ? "expired" : item.lastState;
    setDraft(policyToDraft(item.policy));
    setActivePolicy(item.policy);
    setMemory(item.memory);
    setResult({
      policyId: item.policy.policyId,
      state: loadedState,
      evaluatedAt: item.lastEvaluatedAt,
      summary: item.lastState === "ready"
        ? "A previous ready window was stored on this device, but it cannot be reused. Arm a new policy for a fresh handoff."
        : item.lastSummary,
      checks: [],
      memory: item.memory,
    });
    setMonitoring(loadedState === "armed" || loadedState === "warming");
    setError("");
    setNotice("Loaded device-local policy. Run a fresh evaluation before relying on its last state.");
    window.requestAnimationFrame(() => document.getElementById("bell-lock-output")?.focus());
  }

  function removePolicy(policyId: string) {
    setStoredPolicies((current) => current.filter((item) => item.policy.policyId !== policyId));
    if (activePolicy?.policyId === policyId) {
      requestRef.current?.abort();
      setActivePolicy(null);
      setMemory({ openingObservations: [] });
      setResult(null);
      setMonitoring(false);
    }
  }

  function startNewPolicy() {
    requestRef.current?.abort();
    setDraft(DEFAULT_DRAFT);
    setActivePolicy(null);
    setMemory({ openingObservations: [] });
    setResult(null);
    setMonitoring(false);
    setError("");
    setNotice("New passive policy draft started.");
  }

  async function copyProof() {
    if (!result?.proof) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(result.proof.raw, null, 2));
      setNotice(`${result.proof.kind} JSON copied.`);
    } catch {
      setNotice("Clipboard access was blocked. Download the evidence JSON instead.");
    }
  }

  function downloadProof() {
    if (!result?.proof || !activePolicy) return;
    const blob = new Blob([JSON.stringify(result.proof.raw, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `hoodflow-${result.proof.kind.toLowerCase()}-${activePolicy.asset}-${Date.now()}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice(`${result.proof.kind} downloaded.`);
  }

  function openReadyTrade() {
    if (!activePolicy || state !== "ready") return;
    const intent = { side: "buy" as const, amount: activePolicy.amountUsdg, slippageBps: 50 };
    if (onOpenMarket) {
      onOpenMarket(activePolicy.asset, intent);
      return;
    }
    const fallback = new URL("/", window.location.origin);
    fallback.searchParams.set("asset", activePolicy.asset);
    fallback.searchParams.set("agentSide", "buy");
    fallback.searchParams.set("agentAmount", activePolicy.amountUsdg);
    fallback.searchParams.set("agentSlippageBps", "50");
    window.location.assign(result?.handoff?.href ?? `${fallback.pathname}${fallback.search}`);
  }

  return (
    <section className={styles.workspace} aria-labelledby="bell-lock-title">
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}><i aria-hidden="true" /> BELLLOCK / GUARDED OPEN</p>
          <h1 id="bell-lock-title">Wait for a safer opening.<br /><em>Keep the signature.</em></h1>
        </div>
        <div className={styles.heroProtocol} aria-label="BellLock safety model">
          <span>01</span><p><strong>Observe</strong><small>Regular-session transition</small></p>
          <span>02</span><p><strong>Converge</strong><small>Two distinct samples</small></p>
          <span>03</span><p><strong>Handoff</strong><small>Fresh user signature</small></p>
        </div>
      </header>

      <div className={styles.trustBar} role="note">
        <i aria-hidden="true" />
        <p><strong>Passive policy only.</strong> Saved on this device; no token approval, executable signature, custody or automatic trade is created.</p>
        <b>SELF-CUSTODY</b>
      </div>

      <div className={styles.frame}>
        <form className={styles.policyPanel} onSubmit={armPolicy}>
          <div className={styles.panelHead}>
            <div><span>POLICY CONSOLE</span><strong>Bound the reopen.</strong></div>
            <button type="button" onClick={startNewPolicy}>New</button>
          </div>

          <label className={styles.field}>
            <span>Stock Token</span>
            <select value={draft.asset} onChange={(event) => updateDraft("asset", event.target.value)}>
              {MARKETS.map((market) => <option key={market.ticker} value={market.ticker}>{market.ticker} / {market.name}</option>)}
            </select>
          </label>

          <label className={styles.field}>
            <span>USDG exact input</span>
            <div className={styles.unitInput}>
              <input
                value={draft.amountUsdg}
                onChange={(event) => updateDraft("amountUsdg", event.target.value)}
                inputMode="decimal"
                autoComplete="off"
                aria-describedby="bell-amount-help"
              />
              <b>USDG</b>
            </div>
            <small id="bell-amount-help">Also checks a fixed 2x stress size. It never expands your spend.</small>
          </label>

          <div className={styles.thresholdGrid}>
            <label className={styles.field}>
              <span>Max opening gap</span>
              <div className={styles.unitInput}><input value={draft.maxGapPercent} onChange={(event) => updateDraft("maxGapPercent", event.target.value)} inputMode="decimal" /><b>%</b></div>
            </label>
            <label className={styles.field}>
              <span>Max spread</span>
              <div className={styles.unitInput}><input value={draft.maxSpreadPercent} onChange={(event) => updateDraft("maxSpreadPercent", event.target.value)} inputMode="decimal" /><b>%</b></div>
            </label>
            <label className={styles.field}>
              <span>Oracle / DEX max</span>
              <div className={styles.unitInput}><input value={draft.maxDeviationPercent} onChange={(event) => updateDraft("maxDeviationPercent", event.target.value)} inputMode="decimal" /><b>%</b></div>
            </label>
            <label className={styles.field}>
              <span>Max price impact</span>
              <div className={styles.unitInput}><input value={draft.maxImpactPercent} onChange={(event) => updateDraft("maxImpactPercent", event.target.value)} inputMode="decimal" /><b>%</b></div>
            </label>
          </div>

          <div className={styles.fixedRules}>
            <div><span>Target</span><strong>US regular open</strong><small>Fixed policy session</small></div>
            <div><span>Convergence</span><strong>2 samples</strong><small>Distinct observations</small></div>
            <div><span>Stress read</span><strong>2x amount</strong><small>Never executable</small></div>
          </div>

          <label className={styles.field}>
            <span>Ready-window expiry</span>
            <select value={draft.windowExpirySeconds} onChange={(event) => updateDraft("windowExpirySeconds", event.target.value)}>
              <option value="60">60 seconds</option>
              <option value="75">75 seconds</option>
              <option value="90">90 seconds</option>
              <option value="120">120 seconds</option>
            </select>
          </label>

          <button className={styles.armButton} type="submit" disabled={busy}>
            <span>{busy ? "Evaluating window..." : "Arm passive BellLock"}</span><b aria-hidden="true">&rarr;</b>
          </button>
          <p className={styles.formFoot}>This tab performs read-only refreshes while visible. A ready result only opens a fresh HoodFlow trade review.</p>
        </form>

        <div className={styles.outputPanel} id="bell-lock-output" tabIndex={-1}>
          <div className={styles.stateHead} role="status" aria-live="polite">
            <div>
              <span>{stateCopy.eyebrow}</span>
              <h2>{result ? stateCopy.label : "Not armed"}</h2>
              <p>{result?.summary ?? "Set hard boundaries, then arm a passive policy for the next regular-session window."}</p>
            </div>
            <div className={`${styles.stateBadge} ${styles[state]}`}><i aria-hidden="true" />{result ? stateCopy.label : "Draft"}</div>
          </div>

          {activePolicy ? (
            <div className={styles.policyTape}>
              <div><span>ASSET</span><strong>{activePolicy.asset}</strong><small>{activeMarket?.name ?? "Stock Token"}</small></div>
              <div><span>INPUT</span><strong>{activePolicy.amountUsdg}</strong><small>USDG exact size</small></div>
              <div><span>ARMED</span><strong>{formatTimestamp(activePolicy.armedAt)}</strong><small>{shortId(activePolicy.policyId)}</small></div>
              <div><span>MEMORY</span><strong>{memory.openingObservations.length} / 2</strong><small>{memory.baseline ? "Baseline pinned" : "No baseline yet"}</small></div>
            </div>
          ) : null}

          {error ? <div className={styles.errorBox} role="alert"><i aria-hidden="true" /><p><strong>Evaluation unavailable</strong><span>{error}</span></p></div> : null}

          <div className={styles.checkBoard} aria-label="BellLock boundaries">
            {displayedChecks.map((check, index) => (
              <article key={`${check.id}-${index}`} className={`${styles.check} ${styles[check.status]}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p><strong>{check.label}</strong><small>{check.detail ?? check.value}</small></p>
                <div><b>{check.status === "pass" ? "PASS" : check.status === "fail" ? "FAIL" : "WAIT"}</b>{check.limit ? <small>Limit {check.limit}</small> : null}</div>
              </article>
            ))}
          </div>

          {state === "ready" && activePolicy ? (
            <div className={styles.readyRail}>
              <div><span>SIGN WINDOW</span><strong>{expirySeconds ?? activePolicy.windowExpirySeconds}s</strong><small>Requoted again inside the existing trade flow</small></div>
              <button type="button" onClick={openReadyTrade}>Review {activePolicy.asset} trade <b aria-hidden="true">&rarr;</b></button>
            </div>
          ) : (
            <div className={styles.monitorRail}>
              <p><i aria-hidden="true" /><span><strong>{monitoring ? "Passive monitor active" : "Monitor paused"}</strong><small>{monitoring ? `Visible-tab refresh every ${MONITOR_INTERVAL_MS / 1_000}s` : "No background signing or execution"}</small></span></p>
              {activePolicy && ["armed", "warming"].includes(result?.state ?? "armed")
                ? <button type="button" onClick={() => void evaluatePolicy(activePolicy, memory, true)} disabled={busy}>Evaluate now</button>
                : null}
            </div>
          )}

          {result?.proof ? (
            <section className={styles.proofPanel} aria-labelledby="bell-proof-title">
              <div>
                <span>BELL RECEIPT / {result.proof.verification === "signed-session" ? "SIGNED SESSION" : "SOURCE-OBSERVED V0"}</span>
                <h3 id="bell-proof-title">{result.proof.kind === "RefusalProof" ? "Refusal receipt" : "Guarded handoff receipt"}</h3>
                <p>{result.proof.verification === "signed-session"
                  ? "The API marked this receipt as backed by a verified signed-session observation. The wallet still makes the final decision."
                  : "This JSON records source observations and the policy decision kept on this device. It is not an onchain or signed Data Streams attestation."}</p>
              </div>
              <dl>
                <div><dt>Proof hash</dt><dd>{result.proof.proofHash ? shortId(result.proof.proofHash) : "Not supplied"}</dd></div>
                <div><dt>Signed session proof</dt><dd>{result.proof.verification === "signed-session" ? "API verified" : "Unavailable"}</dd></div>
                <div><dt>Issued</dt><dd>{formatTimestamp(result.proof.issuedAt ?? result.evaluatedAt)}</dd></div>
                <div><dt>Expires</dt><dd>{formatTimestamp(result.proof.expiresAt ?? result.windowExpiresAt)}</dd></div>
              </dl>
              <div className={styles.proofActions}>
                <button type="button" onClick={() => void copyProof()}>Copy JSON</button>
                <button type="button" onClick={downloadProof}>Download</button>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <section className={styles.savedSection} aria-labelledby="saved-bells-title">
        <div className={styles.savedHead}>
          <div><span>DEVICE MEMORY</span><h2 id="saved-bells-title">Saved bells.</h2></div>
          <p>Policies and up to two opening observations are stored locally. Wallet keys and approvals are never stored.</p>
        </div>
        {storedPolicies.length ? (
          <div className={styles.savedGrid}>
            {storedPolicies.map((item) => (
              <article key={item.policy.policyId}>
                <button className={styles.savedLoad} type="button" onClick={() => loadPolicy(item)} aria-label={`Load ${item.policy.asset} BellLock policy`}>
                  <span>{item.policy.asset}</span>
                  <strong>{item.policy.amountUsdg} USDG</strong>
                  <small>{STATE_COPY[item.lastState].label} / gap &lt;= {formatPercentBps(item.policy.maxGapBps)}</small>
                </button>
                <button className={styles.savedRemove} type="button" onClick={() => removePolicy(item.policy.policyId)} aria-label={`Delete ${item.policy.asset} BellLock policy`}>&times;</button>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.savedEmpty}><i aria-hidden="true" /><span>No passive policies stored on this device.</span></div>
        )}
      </section>

      <div className={styles.productTruth}>
        <span>NO APPROVAL</span><span>NO EXECUTABLE SIGNATURE</span><span>NO CUSTODY</span><span>FRESH QUOTE BEFORE SIGNING</span>
      </div>

      <div className={styles.srOnly} aria-live="polite">{notice}</div>
    </section>
  );
}
