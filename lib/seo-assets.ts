export type SeoAsset = {
  ticker: string;
  name: string;
  type: "Stock Token" | "Tokenized ETF";
  fullFill: boolean;
};

export const seoAssets: SeoAsset[] = [
  { ticker: "AAPL", name: "Apple", type: "Stock Token", fullFill: true },
  { ticker: "AMD", name: "AMD", type: "Stock Token", fullFill: true },
  { ticker: "AMZN", name: "Amazon", type: "Stock Token", fullFill: true },
  { ticker: "BABA", name: "Alibaba", type: "Stock Token", fullFill: false },
  { ticker: "BE", name: "Bloom Energy", type: "Stock Token", fullFill: false },
  { ticker: "COIN", name: "Coinbase", type: "Stock Token", fullFill: false },
  { ticker: "CRCL", name: "Circle", type: "Stock Token", fullFill: false },
  { ticker: "CRWV", name: "CoreWeave", type: "Stock Token", fullFill: false },
  { ticker: "GOOGL", name: "Alphabet", type: "Stock Token", fullFill: true },
  { ticker: "INTC", name: "Intel", type: "Stock Token", fullFill: true },
  { ticker: "META", name: "Meta", type: "Stock Token", fullFill: true },
  { ticker: "MSFT", name: "Microsoft", type: "Stock Token", fullFill: false },
  { ticker: "MU", name: "Micron", type: "Stock Token", fullFill: true },
  { ticker: "NVDA", name: "NVIDIA", type: "Stock Token", fullFill: true },
  { ticker: "ORCL", name: "Oracle", type: "Stock Token", fullFill: false },
  { ticker: "PLTR", name: "Palantir", type: "Stock Token", fullFill: false },
  { ticker: "SNDK", name: "Sandisk", type: "Stock Token", fullFill: true },
  { ticker: "SPCX", name: "SpaceX", type: "Stock Token", fullFill: true },
  { ticker: "TSLA", name: "Tesla", type: "Stock Token", fullFill: true },
  { ticker: "USAR", name: "USA Rare Earth", type: "Stock Token", fullFill: false },
  { ticker: "QQQ", name: "Invesco QQQ", type: "Tokenized ETF", fullFill: true },
  { ticker: "SGOV", name: "iShares 0-3 Month Treasury", type: "Tokenized ETF", fullFill: false },
  { ticker: "SLV", name: "iShares Silver Trust", type: "Tokenized ETF", fullFill: true },
  { ticker: "SPY", name: "SPDR S&P 500", type: "Tokenized ETF", fullFill: true },
  { ticker: "CUSO", name: "United States Oil Fund", type: "Tokenized ETF", fullFill: false },
];

export function getSeoAsset(ticker: string) {
  return seoAssets.find((asset) => asset.ticker.toLowerCase() === ticker.toLowerCase());
}
