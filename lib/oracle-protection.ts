export const MAX_ORACLE_DEVIATION_BPS = 500;

export class OracleDeviationError extends Error {}

export type OracleDeviationInput = {
  side: "buy" | "sell";
  inputAmount: string;
  outputAmount: string;
  oraclePrice: number;
  maxDeviationBps?: number;
};

export function calculateOracleDeviation(input: OracleDeviationInput) {
  const inputAmount = Number(input.inputAmount);
  const outputAmount = Number(input.outputAmount);
  if (!Number.isFinite(inputAmount) || inputAmount <= 0 || !Number.isFinite(outputAmount) || outputAmount <= 0 || !Number.isFinite(input.oraclePrice) || input.oraclePrice <= 0) {
    throw new OracleDeviationError("The quote could not be compared with its oracle reference.");
  }
  const impliedDexPrice = input.side === "buy" ? inputAmount / outputAmount : outputAmount / inputAmount;
  const deviationBps = Math.round(Math.abs(impliedDexPrice - input.oraclePrice) / input.oraclePrice * 10_000);
  const maxDeviationBps = input.maxDeviationBps ?? MAX_ORACLE_DEVIATION_BPS;
  if (!Number.isFinite(impliedDexPrice) || deviationBps > maxDeviationBps) {
    throw new OracleDeviationError("The DEX quote moved too far from the live oracle reference.");
  }
  return { impliedDexPrice, deviationBps, maxDeviationBps };
}
