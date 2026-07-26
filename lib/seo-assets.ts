import { isRoutedAsset } from "@/lib/hoodflow-mainnet";

export type SeoAsset = {
  ticker: string;
  name: string;
  type: "Stock Token" | "Tokenized ETF";
  fullFill: boolean;
};

const indexedAssets = [
  { ticker: "AAPL", name: "Apple", type: "Stock Token" },
  { ticker: "AMD", name: "AMD", type: "Stock Token" },
  { ticker: "AMZN", name: "Amazon", type: "Stock Token" },
  { ticker: "BABA", name: "Alibaba", type: "Stock Token" },
  { ticker: "BE", name: "Bloom Energy", type: "Stock Token" },
  { ticker: "COIN", name: "Coinbase", type: "Stock Token" },
  { ticker: "CRCL", name: "Circle", type: "Stock Token" },
  { ticker: "CRWV", name: "CoreWeave", type: "Stock Token" },
  { ticker: "GOOGL", name: "Alphabet", type: "Stock Token" },
  { ticker: "INTC", name: "Intel", type: "Stock Token" },
  { ticker: "META", name: "Meta", type: "Stock Token" },
  { ticker: "MSFT", name: "Microsoft", type: "Stock Token" },
  { ticker: "MU", name: "Micron", type: "Stock Token" },
  { ticker: "NVDA", name: "NVIDIA", type: "Stock Token" },
  { ticker: "ORCL", name: "Oracle", type: "Stock Token" },
  { ticker: "PLTR", name: "Palantir", type: "Stock Token" },
  { ticker: "SNDK", name: "Sandisk", type: "Stock Token" },
  { ticker: "SPCX", name: "SpaceX", type: "Stock Token" },
  { ticker: "TSLA", name: "Tesla", type: "Stock Token" },
  { ticker: "USAR", name: "USA Rare Earth", type: "Stock Token" },
  { ticker: "QQQ", name: "Invesco QQQ", type: "Tokenized ETF" },
  { ticker: "SGOV", name: "iShares 0-3 Month Treasury", type: "Tokenized ETF" },
  { ticker: "SLV", name: "iShares Silver Trust", type: "Tokenized ETF" },
  { ticker: "SPY", name: "SPDR S&P 500", type: "Tokenized ETF" },
  { ticker: "CUSO", name: "United States Oil Fund", type: "Tokenized ETF" },
] as const;

export const seoAssets: SeoAsset[] = indexedAssets.map((asset) => ({
  ...asset,
  fullFill: isRoutedAsset(asset.ticker),
}));

export function getSeoAsset(ticker: string) {
  return seoAssets.find((asset) => asset.ticker.toLowerCase() === ticker.toLowerCase());
}
