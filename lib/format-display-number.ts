export type DisplayNumber = string | number | null | undefined;

const DASH = "—";

function finiteNumber(value: DisplayNumber): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Object.is(numeric, -0) ? 0 : numeric;
}

function smallDecimal(value: number, maximumSignificantDigits = 8) {
  return new Intl.NumberFormat("en-US", {
    notation: "standard",
    maximumSignificantDigits,
    useGrouping: false,
  }).format(value);
}

export function formatTokenAmount(value: DisplayNumber) {
  const numeric = finiteNumber(value);
  if (numeric === null) return DASH;
  if (numeric === 0) return "0";
  if (Math.abs(numeric) < 1) return smallDecimal(numeric, 8);
  return new Intl.NumberFormat("en-US", {
    notation: "standard",
    maximumFractionDigits: 6,
  }).format(numeric);
}

export function formatUsd(
  value: DisplayNumber,
  options: { compact?: boolean; price?: boolean } = {},
) {
  const numeric = finiteNumber(value);
  if (numeric === null) return DASH;
  if (numeric === 0) return "$0.00";

  if (options.price && Math.abs(numeric) < 1) {
    return `$${smallDecimal(numeric, 8)}`;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: options.compact && Math.abs(numeric) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: options.compact && Math.abs(numeric) >= 10_000 ? 1 : 2,
  }).format(numeric);
}

export function formatPercentage(value: DisplayNumber) {
  const numeric = finiteNumber(value);
  if (numeric === null) return DASH;
  const bounded = Math.max(-99.99, Math.min(999_999, numeric));
  const absolute = Math.abs(bounded);
  const formatted = absolute >= 10_000
    ? new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(absolute)
    : new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 2,
      }).format(absolute);
  return `${bounded >= 0 ? "+" : "-"}${formatted}%`;
}
