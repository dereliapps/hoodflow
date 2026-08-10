import {
  formatEther,
  formatUnits,
  getAddress,
  keccak256,
  sha256,
  toUtf8Bytes,
} from "ethers";

import {
  ROBINHOOD_MAINNET,
  STOCK_TOKEN_DECIMALS,
  UNIVERSAL_ROUTER_ADDRESS,
  USDG_ADDRESS,
  USDG_DECIMALS,
  toUiAmount,
} from "@/lib/hoodflow-mainnet";
import {
  verifyHoodFlowRouterSettlement,
  type ReceiptLog,
} from "@/lib/referral-qualification";

export const FILL_PROOF_SCHEMA = "hoodflow.fillproof.v1" as const;
export const FILL_PROOF_SNAPSHOT_SCHEMA = "hoodflow.pretrade-snapshot.v1" as const;

export type FillProofLocalSnapshot = {
  schema: typeof FILL_PROOF_SNAPSHOT_SCHEMA;
  capturedAt: string;
  asset: string;
  side: "buy" | "sell";
  expectedRawOutput: string;
  expectedDisplayOutput: string;
  minimumRawOutput: string;
  minimumDisplayOutput: string;
  quoteExpiresAt: string;
  protocol: "V3" | "V4";
  feeTier: number;
  uiMultiplierRaw: string;
  actionLockDigest: string;
};

export type FillProofCheck = {
  code: "confirmed" | "sender" | "router" | "route" | "settlement" | "minimum";
  status: "pass";
  label: string;
  detail: string;
};

export type FillProof = {
  schema: typeof FILL_PROOF_SCHEMA;
  generatedAt: string;
  chainId: number;
  asset: string;
  side: "buy" | "sell";
  transaction: {
    hash: string;
    blockNumber: number;
    blockHash: string;
    blockTimestamp: number;
    from: string;
    to: string;
    calldataHash: string;
    deadline: string;
  };
  route: {
    protocol: "V3" | "V4";
    feeTier: number;
    tickSpacing: number | null;
    tokenIn: string;
    tokenOut: string;
  };
  amounts: {
    input: {
      ticker: string;
      raw: string;
      display: string | null;
      decimals: number;
    };
    output: {
      ticker: string;
      rawMinimum: string;
      rawActual: string;
      displayMinimum: string | null;
      displayActual: string | null;
      decimals: number;
      transferCount: number;
      minimumSatisfied: true;
      minimumSurplusBps: number;
    };
    uiMultiplier: {
      raw: string;
      blockPinned: true;
    } | null;
  };
  gas: {
    used: string;
    priceWei: string;
    paidWei: string;
    paidEth: string;
  };
  checks: FillProofCheck[];
  integrity: {
    algorithm: "SHA-256";
    digest: string;
    scope: "onchain-reconstruction";
  };
  notice: string;
};

export type FillProofSource = {
  chainId: number;
  transaction: {
    hash: string;
    from: string;
    to: string | null;
    data: string;
  };
  receipt: {
    status: number | null;
    hash: string;
    from: string;
    to: string | null;
    blockHash: string;
    blockNumber: number;
    gasUsed: bigint;
    gasPrice: bigint;
    logs: readonly ReceiptLog[];
  };
  blockTimestamp: number;
  uiMultiplierRaw?: bigint | null;
  generatedAt?: string;
};

function sortForCanonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForCanonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortForCanonicalJson(child)]),
  );
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(sortForCanonicalJson(value));
}

export function fillProofChecksum(value: unknown) {
  return sha256(toUtf8Bytes(canonicalJson(value)));
}

function isHash(value: unknown) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function isActionLockDigest(value: unknown) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function isUnsignedInteger(value: unknown, positive = false) {
  return typeof value === "string"
    && (positive ? /^[1-9][0-9]*$/.test(value) : /^(?:0|[1-9][0-9]*)$/.test(value));
}

function isUnsignedDecimal(value: unknown) {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value);
}

function isIsoDate(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function displayAmount(raw: bigint, ticker: string, multiplier: bigint | null) {
  if (ticker === "USDG") return formatUnits(raw, USDG_DECIMALS);
  if (!multiplier || multiplier <= 0n) return null;
  return formatUnits(toUiAmount(raw, multiplier), STOCK_TOKEN_DECIMALS);
}

export function rawDeltaBps(actualRaw: string, referenceRaw: string) {
  const actual = BigInt(actualRaw);
  const reference = BigInt(referenceRaw);
  if (reference <= 0n) return null;
  return Number((actual - reference) * 10_000n / reference);
}

export function createFillProof(source: FillProofSource): FillProof {
  if (source.chainId !== ROBINHOOD_MAINNET.chainIdNumber) {
    throw new Error("FillProof only supports Robinhood Chain mainnet.");
  }
  if (source.receipt.status !== 1) throw new Error("The transaction is not confirmed successfully.");
  if (!isHash(source.transaction.hash) || source.transaction.hash.toLowerCase() !== source.receipt.hash.toLowerCase()) {
    throw new Error("The transaction and receipt hashes do not match.");
  }
  if (!isHash(source.receipt.blockHash) || !Number.isInteger(source.receipt.blockNumber) || source.receipt.blockNumber <= 0) {
    throw new Error("The receipt block reference is invalid.");
  }
  if (!Number.isInteger(source.blockTimestamp) || source.blockTimestamp <= 0) {
    throw new Error("The receipt block timestamp is invalid.");
  }

  const sender = getAddress(source.transaction.from);
  const receiptSender = getAddress(source.receipt.from);
  const transactionTarget = source.transaction.to ? getAddress(source.transaction.to) : null;
  const receiptTarget = source.receipt.to ? getAddress(source.receipt.to) : null;
  if (sender !== receiptSender) throw new Error("The transaction sender does not match the receipt.");
  if (transactionTarget !== UNIVERSAL_ROUTER_ADDRESS || receiptTarget !== UNIVERSAL_ROUTER_ADDRESS) {
    throw new Error("The transaction was not settled through the reviewed Universal Router.");
  }

  const settlement = verifyHoodFlowRouterSettlement({
    transactionData: source.transaction.data,
    wallet: sender,
    logs: source.receipt.logs,
    requireExactPermitAmount: true,
  });
  const inputTicker = settlement.side === "buy" ? "USDG" : settlement.ticker;
  const outputTicker = settlement.side === "buy" ? settlement.ticker : "USDG";
  const multiplier = source.uiMultiplierRaw && source.uiMultiplierRaw > 0n ? source.uiMultiplierRaw : null;
  const inputDecimals = inputTicker === "USDG" ? USDG_DECIMALS : STOCK_TOKEN_DECIMALS;
  const outputDecimals = outputTicker === "USDG" ? USDG_DECIMALS : STOCK_TOKEN_DECIMALS;
  const gasPaid = source.receipt.gasUsed * source.receipt.gasPrice;
  const minimumSurplusBps = settlement.minimumOut > 0n
    ? Number((settlement.received - settlement.minimumOut) * 10_000n / settlement.minimumOut)
    : 0;

  const immutable = {
    schema: FILL_PROOF_SCHEMA,
    chainId: source.chainId,
    asset: settlement.ticker,
    side: settlement.side,
    transaction: {
      hash: source.transaction.hash.toLowerCase(),
      blockNumber: source.receipt.blockNumber,
      blockHash: source.receipt.blockHash.toLowerCase(),
      blockTimestamp: source.blockTimestamp,
      from: sender,
      to: UNIVERSAL_ROUTER_ADDRESS,
      calldataHash: keccak256(source.transaction.data),
      deadline: settlement.deadline.toString(),
    },
    route: {
      protocol: settlement.protocol,
      feeTier: settlement.fee,
      tickSpacing: settlement.tickSpacing,
      tokenIn: settlement.tokenIn,
      tokenOut: settlement.tokenOut,
    },
    amounts: {
      input: {
        ticker: inputTicker,
        raw: settlement.amountIn.toString(),
        display: displayAmount(settlement.amountIn, inputTicker, multiplier),
        decimals: inputDecimals,
      },
      output: {
        ticker: outputTicker,
        rawMinimum: settlement.minimumOut.toString(),
        rawActual: settlement.received.toString(),
        displayMinimum: displayAmount(settlement.minimumOut, outputTicker, multiplier),
        displayActual: displayAmount(settlement.received, outputTicker, multiplier),
        decimals: outputDecimals,
        transferCount: settlement.transferCount,
        minimumSatisfied: true as const,
        minimumSurplusBps,
      },
      uiMultiplier: multiplier ? { raw: multiplier.toString(), blockPinned: true as const } : null,
    },
    gas: {
      used: source.receipt.gasUsed.toString(),
      priceWei: source.receipt.gasPrice.toString(),
      paidWei: gasPaid.toString(),
      paidEth: formatEther(gasPaid),
    },
    checks: [
      { code: "confirmed", status: "pass", label: "Mainnet receipt", detail: `Confirmed in block ${source.receipt.blockNumber}.` },
      { code: "sender", status: "pass", label: "Wallet match", detail: "Transaction sender and receipt sender match." },
      { code: "router", status: "pass", label: "Router match", detail: "Execution used the reviewed Universal Router." },
      { code: "route", status: "pass", label: "Reviewed route", detail: `${settlement.protocol} fee tier ${settlement.fee} matches HoodFlow's reviewed registry.` },
      { code: "settlement", status: "pass", label: "Canonical settlement", detail: `${settlement.transferCount} canonical ${outputTicker} transfer${settlement.transferCount === 1 ? "" : "s"} settled to the sender wallet.` },
      { code: "minimum", status: "pass", label: "Protected minimum", detail: "Actual raw output met or exceeded the calldata minimum." },
    ] satisfies FillProofCheck[],
  };

  return {
    ...immutable,
    generatedAt: source.generatedAt ?? new Date().toISOString(),
    integrity: {
      algorithm: "SHA-256",
      digest: fillProofChecksum(immutable),
      scope: "onchain-reconstruction",
    },
    notice: "FillProof reconstructs public onchain data. Its checksum detects changes to this document; it is not a HoodFlow signature, audit, or proof that the HoodFlow interface originated the transaction.",
  };
}

export function isFillProofLocalSnapshot(value: unknown): value is FillProofLocalSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<FillProofLocalSnapshot>;
  return snapshot.schema === FILL_PROOF_SNAPSHOT_SCHEMA
    && isIsoDate(snapshot.capturedAt)
    && typeof snapshot.asset === "string"
    && (snapshot.side === "buy" || snapshot.side === "sell")
    && isUnsignedInteger(snapshot.expectedRawOutput, true)
    && isUnsignedDecimal(snapshot.expectedDisplayOutput)
    && isUnsignedInteger(snapshot.minimumRawOutput, true)
    && isUnsignedDecimal(snapshot.minimumDisplayOutput)
    && isIsoDate(snapshot.quoteExpiresAt)
    && (snapshot.protocol === "V3" || snapshot.protocol === "V4")
    && Number.isInteger(snapshot.feeTier)
    && Number(snapshot.feeTier) > 0
    && isUnsignedInteger(snapshot.uiMultiplierRaw, true)
    && isActionLockDigest(snapshot.actionLockDigest);
}

export function isFillProof(value: unknown): value is FillProof {
  if (!value || typeof value !== "object") return false;
  const proof = value as Partial<FillProof>;
  return proof.schema === FILL_PROOF_SCHEMA
    && proof.chainId === ROBINHOOD_MAINNET.chainIdNumber
    && typeof proof.asset === "string"
    && (proof.side === "buy" || proof.side === "sell")
    && isHash(proof.transaction?.hash)
    && isHash(proof.transaction?.blockHash)
    && typeof proof.amounts?.output?.rawActual === "string"
    && typeof proof.amounts?.output?.rawMinimum === "string"
    && proof.amounts.output.minimumSatisfied === true
    && isHash(proof.integrity?.digest);
}

export function isCanonicalSettlementPair(tokenIn: string, tokenOut: string) {
  const input = getAddress(tokenIn);
  const output = getAddress(tokenOut);
  return input === USDG_ADDRESS || output === USDG_ADDRESS;
}
