export type ScanWindow = {
  strategyIds: bigint[];
  startStrategyId: bigint | null;
  endStrategyId: bigint | null;
  nextStrategyId: bigint;
};

export function buildScanWindow(
  strategyCount: bigint,
  maxStrategies: number,
  requestedStart: bigint,
): ScanWindow {
  if (strategyCount <= 0n) {
    return {
      strategyIds: [],
      startStrategyId: null,
      endStrategyId: null,
      nextStrategyId: 1n,
    };
  }
  if (!Number.isSafeInteger(maxStrategies) || maxStrategies <= 0) {
    throw new Error("maxStrategies must be a positive safe integer");
  }

  const normalizedStart = normalizeStrategyId(requestedStart, strategyCount);
  const windowSize = Number(
    strategyCount < BigInt(maxStrategies) ? strategyCount : BigInt(maxStrategies),
  );
  const strategyIds = Array.from({ length: windowSize }, (_, index) =>
    normalizeStrategyId(normalizedStart + BigInt(index), strategyCount));

  return {
    strategyIds,
    startStrategyId: strategyIds[0] ?? null,
    endStrategyId: strategyIds.at(-1) ?? null,
    nextStrategyId: normalizeStrategyId(normalizedStart + BigInt(windowSize), strategyCount),
  };
}

export type ReadinessInput = {
  started: boolean;
  stopping: boolean;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  maxSuccessAgeMs: number;
  failureThreshold: number;
  nowMs?: number;
};

export type ReadinessState = {
  ready: boolean;
  reason:
    | "ready"
    | "not_started"
    | "stopping"
    | "no_successful_scan"
    | "successful_scan_stale"
    | "failure_threshold_exceeded";
  successAgeMs: number | null;
  successFresh: boolean;
  failuresWithinBudget: boolean;
};

export function evaluateReadiness(input: ReadinessInput): ReadinessState {
  const nowMs = input.nowMs ?? Date.now();
  const successTimestamp = input.lastSuccessAt === null
    ? Number.NaN
    : Date.parse(input.lastSuccessAt);
  const successAgeMs = Number.isFinite(successTimestamp)
    ? Math.max(0, nowMs - successTimestamp)
    : null;
  const successFresh = successAgeMs !== null && successAgeMs <= input.maxSuccessAgeMs;
  const failuresWithinBudget = input.consecutiveFailures < input.failureThreshold;

  let reason: ReadinessState["reason"] = "ready";
  if (input.stopping) reason = "stopping";
  else if (!input.started) reason = "not_started";
  else if (successAgeMs === null) reason = "no_successful_scan";
  else if (!failuresWithinBudget) reason = "failure_threshold_exceeded";
  else if (!successFresh) reason = "successful_scan_stale";

  return {
    ready: reason === "ready",
    reason,
    successAgeMs,
    successFresh,
    failuresWithinBudget,
  };
}

function normalizeStrategyId(strategyId: bigint, strategyCount: bigint) {
  const zeroBased = ((strategyId - 1n) % strategyCount + strategyCount) % strategyCount;
  return zeroBased + 1n;
}
