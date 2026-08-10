export const DEPTH_MAP_SAMPLE_AMOUNTS = ["10", "25", "100", "250", "1000"] as const;

export const DEPTH_MAP_SCAN_COOLDOWN_MS = 30_000;

export type DepthMapPointStatus = "scanning" | "pass" | "unavailable" | "rate-limited";

export type DepthMapQuoteShape = {
  protection: { dataExpiresAt: string };
};

export type DepthMapPoint<TQuote extends DepthMapQuoteShape = DepthMapQuoteShape> = {
  amount: string;
  status: DepthMapPointStatus;
  quote?: TQuote;
  message?: string;
};

export function isFreshDepthMapQuote(
  quote: DepthMapQuoteShape | undefined,
  now = Date.now(),
) {
  if (!quote) return false;
  const expiresAt = Date.parse(quote.protection.dataExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function highestFreshDepthMapPass<TQuote extends DepthMapQuoteShape>(
  points: Array<DepthMapPoint<TQuote>>,
  now = Date.now(),
) {
  return points
    .filter((point) => point.status === "pass" && isFreshDepthMapQuote(point.quote, now))
    .sort((left, right) => Number(right.amount) - Number(left.amount))[0] ?? null;
}

export function depthMapCooldownRemaining(lastScanAt: number | null, now = Date.now()) {
  if (!lastScanAt) return 0;
  return Math.max(0, DEPTH_MAP_SCAN_COOLDOWN_MS - (now - lastScanAt));
}
