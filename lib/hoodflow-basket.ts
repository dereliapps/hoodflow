import { formatUnits, parseUnits } from "ethers";

import {
  AgentQuoteUnavailableError,
  AgentQuoteValidationError,
  parseAgentQuoteRequest,
  prepareAgentQuote,
  type AgentQuote,
  type AgentQuoteRequest,
} from "@/lib/hoodflow-agent";
import { USDG_DECIMALS } from "@/lib/hoodflow-mainnet";

export const MIN_BASKET_LEGS = 2;
export const MAX_BASKET_LEGS = 6;
export const MAX_BASKET_BUDGET_USDG = "100000";
export const DEFAULT_BASKET_SLIPPAGE_BPS = 50;
export const MIN_BASKET_SLIPPAGE_BPS = 1;
export const MAX_BASKET_SLIPPAGE_BPS = 500;

const BPS_DENOMINATOR = 10_000n;
const DECIMAL_INPUT = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const MAX_BASKET_BUDGET_RAW = parseUnits(MAX_BASKET_BUDGET_USDG, USDG_DECIMALS);

export type AgentBasketFailurePolicy = "all-or-nothing" | "omit-unsafe";

export type AgentBasketLegRequest = {
  asset: string;
  weightBps: number;
};

export type AgentBasketRequest = {
  budgetUsdG: string;
  legs: AgentBasketLegRequest[];
  slippageBps: number;
  failurePolicy: AgentBasketFailurePolicy;
};

export type BasketAllocation = {
  amount: string;
  rawAmount: string;
};

export type BasketHandoffLeg = {
  index: number;
  asset: string;
  weightBps: number;
  allocation: BasketAllocation;
  quote: AgentQuote;
};

export type BasketRejectedLeg = {
  index: number;
  asset: string;
  weightBps: number;
  allocation: BasketAllocation;
  code: "preflight_unavailable";
  retryable: true;
};

export type BasketProgress = {
  requestedLegs: number;
  preparedLegs: number;
  rejectedLegs: number;
  completeness: "full" | "partial";
};

export type BasketPreparedPlan = {
  basketId: string;
  status: "indicative-preflight" | "partial-indicative-preflight";
  progress: BasketProgress;
  budget: {
    ticker: "USDG";
    decimals: 6;
    requestedAmount: string;
    rawRequestedAmount: string;
    plannedAmount: string;
    rawPlannedAmount: string;
    unallocatedAmount: string;
    rawUnallocatedAmount: string;
  };
  legs: BasketHandoffLeg[];
  rejectedLegs: BasketRejectedLeg[];
  protection: {
    slippageBps: number;
    failurePolicy: AgentBasketFailurePolicy;
    dataExpiresAt: string;
    executionBinding: "none-requote-required";
  };
  custody: "self-custody";
  requiresUserSignature: true;
  execution: {
    atomic: false;
    submission: "none";
    minimumTradeConfirmations: number;
    instruction: string;
  };
  preparedAt: string;
};

type RawBasketAllocation = AgentBasketLegRequest & {
  index: number;
  amountRaw: bigint;
};

type AgentBasketDependencies = {
  prepareQuote?: (request: AgentQuoteRequest) => Promise<AgentQuote>;
  now?: () => number;
  createId?: () => string;
};

export class AgentBasketValidationError extends AgentQuoteValidationError {}
export class AgentBasketUnavailableError extends AgentQuoteUnavailableError {}

function readRequiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AgentBasketValidationError(`${field} is required.`);
  }
  return value.trim();
}

function parseBudget(value: unknown) {
  const budget = readRequiredString(value, "budgetUsdG");
  if (!DECIMAL_INPUT.test(budget)) {
    throw new AgentBasketValidationError("budgetUsdG must be a positive decimal string.");
  }
  const decimals = budget.split(".")[1]?.length ?? 0;
  if (decimals > USDG_DECIMALS) {
    throw new AgentBasketValidationError(`budgetUsdG supports at most ${USDG_DECIMALS} decimal places.`);
  }

  let rawBudget: bigint;
  try {
    rawBudget = parseUnits(budget, USDG_DECIMALS);
  } catch {
    throw new AgentBasketValidationError("budgetUsdG must be a positive decimal string.");
  }
  if (rawBudget <= 0n) {
    throw new AgentBasketValidationError("budgetUsdG must be greater than zero.");
  }
  if (rawBudget > MAX_BASKET_BUDGET_RAW) {
    throw new AgentBasketValidationError(`budgetUsdG exceeds the public basket limit of ${MAX_BASKET_BUDGET_USDG} USDG.`);
  }
  return { budgetUsdG: formatUnits(rawBudget, USDG_DECIMALS), rawBudget };
}

function parseSlippage(value: unknown) {
  const slippageBps = value ?? DEFAULT_BASKET_SLIPPAGE_BPS;
  if (
    typeof slippageBps !== "number"
    || !Number.isInteger(slippageBps)
    || slippageBps < MIN_BASKET_SLIPPAGE_BPS
    || slippageBps > MAX_BASKET_SLIPPAGE_BPS
  ) {
    throw new AgentBasketValidationError(
      `slippageBps must be an integer from ${MIN_BASKET_SLIPPAGE_BPS} to ${MAX_BASKET_SLIPPAGE_BPS}.`,
    );
  }
  return slippageBps;
}

function parseFailurePolicy(value: unknown): AgentBasketFailurePolicy {
  if (value === undefined) return "all-or-nothing";
  if (value !== "all-or-nothing" && value !== "omit-unsafe") {
    throw new AgentBasketValidationError("failurePolicy must be all-or-nothing or omit-unsafe.");
  }
  return value;
}

export function allocateUsdGBudget(
  rawBudget: bigint,
  legs: readonly AgentBasketLegRequest[],
): RawBasketAllocation[] {
  if (rawBudget <= 0n) throw new AgentBasketValidationError("Basket budget must be greater than zero.");
  if (legs.length < MIN_BASKET_LEGS || legs.length > MAX_BASKET_LEGS) {
    throw new AgentBasketValidationError(`legs must contain between ${MIN_BASKET_LEGS} and ${MAX_BASKET_LEGS} assets.`);
  }
  if (legs.some((leg) => !Number.isInteger(leg.weightBps) || leg.weightBps <= 0)) {
    throw new AgentBasketValidationError("Every weightBps must be a positive integer.");
  }
  const totalWeight = legs.reduce((sum, leg) => sum + leg.weightBps, 0);
  if (totalWeight !== Number(BPS_DENOMINATOR)) {
    throw new AgentBasketValidationError("Basket weightBps must total exactly 10000.");
  }

  const allocations = legs.map((leg, index) => {
    const numerator = rawBudget * BigInt(leg.weightBps);
    return {
      ...leg,
      index,
      amountRaw: numerator / BPS_DENOMINATOR,
      remainder: numerator % BPS_DENOMINATOR,
    };
  });
  let undistributed = rawBudget - allocations.reduce((sum, leg) => sum + leg.amountRaw, 0n);
  const remainderOrder = [...allocations].sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index;
    return left.remainder > right.remainder ? -1 : 1;
  });
  for (let index = 0; undistributed > 0n; index += 1) {
    remainderOrder[index].amountRaw += 1n;
    undistributed -= 1n;
  }

  if (allocations.some((leg) => leg.amountRaw <= 0n)) {
    throw new AgentBasketValidationError("budgetUsdG is too small to allocate a positive USDG amount to every leg.");
  }
  return allocations.map((allocation) => ({
    asset: allocation.asset,
    weightBps: allocation.weightBps,
    index: allocation.index,
    amountRaw: allocation.amountRaw,
  }));
}

export function parseAgentBasketRequest(value: unknown): AgentBasketRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentBasketValidationError("A JSON basket request is required.");
  }
  const input = value as Record<string, unknown>;
  const { budgetUsdG, rawBudget } = parseBudget(input.budgetUsdG);
  const slippageBps = parseSlippage(input.slippageBps);
  const failurePolicy = parseFailurePolicy(input.failurePolicy);
  if (!Array.isArray(input.legs) || input.legs.length < MIN_BASKET_LEGS || input.legs.length > MAX_BASKET_LEGS) {
    throw new AgentBasketValidationError(`legs must contain between ${MIN_BASKET_LEGS} and ${MAX_BASKET_LEGS} assets.`);
  }

  const seen = new Set<string>();
  const legs = input.legs.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new AgentBasketValidationError(`legs[${index}] must be an asset and weightBps object.`);
    }
    const leg = value as Record<string, unknown>;
    const asset = readRequiredString(leg.asset, `legs[${index}].asset`).toUpperCase();
    const weightBps = leg.weightBps;
    if (typeof weightBps !== "number" || !Number.isInteger(weightBps) || weightBps <= 0) {
      throw new AgentBasketValidationError(`legs[${index}].weightBps must be a positive integer.`);
    }
    try {
      parseAgentQuoteRequest({ asset, side: "buy", amount: "1", slippageBps });
    } catch (error) {
      if (error instanceof AgentQuoteValidationError) {
        throw new AgentBasketValidationError(`legs[${index}].asset must be an execution-ready HoodFlow market.`);
      }
      throw error;
    }
    if (seen.has(asset)) {
      throw new AgentBasketValidationError(`Duplicate basket asset: ${asset}.`);
    }
    seen.add(asset);
    return { asset, weightBps };
  });

  allocateUsdGBudget(rawBudget, legs);
  return { budgetUsdG, legs, slippageBps, failurePolicy };
}

function publicAllocation(amountRaw: bigint): BasketAllocation {
  return {
    amount: formatUnits(amountRaw, USDG_DECIMALS),
    rawAmount: amountRaw.toString(),
  };
}

function quoteMatchesRequest(quote: AgentQuote, request: AgentQuoteRequest, now: number) {
  const expiry = Date.parse(quote.protection.dataExpiresAt);
  return quote.status === "indicative-preflight"
    && quote.asset === request.asset
    && quote.side === "buy"
    && quote.pay.ticker === "USDG"
    && quote.pay.rawAmount === parseUnits(request.amount, USDG_DECIMALS).toString()
    && quote.protection.slippageBps === request.slippageBps
    && quote.protection.executionBinding === "none-requote-required"
    && quote.requiresUserSignature === true
    && Number.isFinite(expiry)
    && expiry > now;
}

export async function prepareAgentBasket(
  request: AgentBasketRequest,
  dependencies: AgentBasketDependencies = {},
): Promise<BasketPreparedPlan> {
  const prepareQuote = dependencies.prepareQuote ?? prepareAgentQuote;
  const now = dependencies.now ?? Date.now;
  const createId = dependencies.createId ?? (() => crypto.randomUUID());
  const rawBudget = parseUnits(request.budgetUsdG, USDG_DECIMALS);
  const allocations = allocateUsdGBudget(rawBudget, request.legs);
  const quoteRequests = allocations.map((leg) => parseAgentQuoteRequest({
    asset: leg.asset,
    side: "buy",
    amount: formatUnits(leg.amountRaw, USDG_DECIMALS),
    slippageBps: request.slippageBps,
  }));
  const results = await Promise.allSettled(
    quoteRequests.map((quoteRequest) => Promise.resolve().then(() => prepareQuote(quoteRequest))),
  );
  const preparedAtMs = now();
  const preparedLegs: BasketHandoffLeg[] = [];
  const rejectedLegs: BasketRejectedLeg[] = [];

  results.forEach((result, index) => {
    const allocation = allocations[index];
    const quoteRequest = quoteRequests[index];
    const publicAmount = publicAllocation(allocation.amountRaw);
    if (result.status === "fulfilled" && quoteMatchesRequest(result.value, quoteRequest, preparedAtMs)) {
      preparedLegs.push({
        index,
        asset: allocation.asset,
        weightBps: allocation.weightBps,
        allocation: publicAmount,
        quote: result.value,
      });
      return;
    }
    rejectedLegs.push({
      index,
      asset: allocation.asset,
      weightBps: allocation.weightBps,
      allocation: publicAmount,
      code: "preflight_unavailable",
      retryable: true,
    });
  });

  if (rejectedLegs.length > 0 && request.failurePolicy === "all-or-nothing") {
    throw new AgentBasketUnavailableError("One or more basket legs did not pass the fresh safety preflight.");
  }
  if (preparedLegs.length < MIN_BASKET_LEGS) {
    throw new AgentBasketUnavailableError("At least two basket legs must pass the fresh safety preflight.");
  }

  const plannedRaw = preparedLegs.reduce((sum, leg) => sum + BigInt(leg.allocation.rawAmount), 0n);
  const unallocatedRaw = rawBudget - plannedRaw;
  const earliestExpiry = preparedLegs.reduce(
    (earliest, leg) => Math.min(earliest, Date.parse(leg.quote.protection.dataExpiresAt)),
    Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(earliestExpiry) || earliestExpiry <= preparedAtMs) {
    throw new AgentBasketUnavailableError("The basket safety preflight expired before it could be prepared.");
  }
  const partial = rejectedLegs.length > 0;

  return {
    basketId: `hfb-${createId()}`,
    status: partial ? "partial-indicative-preflight" : "indicative-preflight",
    progress: {
      requestedLegs: allocations.length,
      preparedLegs: preparedLegs.length,
      rejectedLegs: rejectedLegs.length,
      completeness: partial ? "partial" : "full",
    },
    budget: {
      ticker: "USDG",
      decimals: USDG_DECIMALS,
      requestedAmount: formatUnits(rawBudget, USDG_DECIMALS),
      rawRequestedAmount: rawBudget.toString(),
      plannedAmount: formatUnits(plannedRaw, USDG_DECIMALS),
      rawPlannedAmount: plannedRaw.toString(),
      unallocatedAmount: formatUnits(unallocatedRaw, USDG_DECIMALS),
      rawUnallocatedAmount: unallocatedRaw.toString(),
    },
    legs: preparedLegs,
    rejectedLegs,
    protection: {
      slippageBps: request.slippageBps,
      failurePolicy: request.failurePolicy,
      dataExpiresAt: new Date(earliestExpiry).toISOString(),
      executionBinding: "none-requote-required",
    },
    custody: "self-custody",
    requiresUserSignature: true,
    execution: {
      atomic: false,
      submission: "none",
      minimumTradeConfirmations: preparedLegs.length,
      instruction: "Confirm each trade leg separately. A first-time or insufficient allowance can add an ERC-20 approval prompt; each leg also requires a Permit2 signature and a fresh swap confirmation.",
    },
    preparedAt: new Date(preparedAtMs).toISOString(),
  };
}
