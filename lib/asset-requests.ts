export const ASSET_REQUEST_CANDIDATES = [
  { ticker: "MSFT", name: "Microsoft", type: "Stock", stage: "Route review" },
  { ticker: "COIN", name: "Coinbase", type: "Stock", stage: "Liquidity watch" },
  { ticker: "PLTR", name: "Palantir", type: "Stock", stage: "Route review" },
  { ticker: "ORCL", name: "Oracle", type: "Stock", stage: "Liquidity watch" },
  { ticker: "BABA", name: "Alibaba", type: "Stock", stage: "Route review" },
  { ticker: "CRCL", name: "Circle", type: "Stock", stage: "Liquidity watch" },
] as const;

export const ASSET_REQUEST_LIMIT = 3;

export function buildAssetVoteMessage(wallet: string, ticker: string, timestamp: number) {
  return [
    "HoodFlow market request",
    `Wallet: ${wallet}`,
    `Asset: ${ticker}`,
    "Chain: 4663",
    `Timestamp: ${timestamp}`,
    "This signature does not send a transaction or grant token permission.",
  ].join("\n");
}
