import { isRoutedAsset, ROBINHOOD_TOKENS } from "@/lib/hoodflow-mainnet";

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

export type AssetFaq = { question: string; answer: string };

/**
 * Asset-specific, answer-first copy. It renders visibly on each market page and is reused
 * verbatim for FAQPage structured data and llms-full.txt, so the three can never drift apart.
 */
export function getAssetFaq(asset: SeoAsset): AssetFaq[] {
  const contract = ROBINHOOD_TOKENS[asset.ticker];
  const isEtf = asset.type === "Tokenized ETF";
  const unit = isEtf ? "fund share" : "share";
  return [
    {
      question: `What is the ${asset.name} (${asset.ticker}) ${asset.type} on Robinhood Chain?`,
      answer: isEtf
        ? `It is the canonical ${asset.ticker} token that HoodFlow maps from the Robinhood Chain token registry, an onchain instrument that references the ${asset.name} fund. It is not a fund share, and issuer terms and jurisdiction rules apply.`
        : `It is the canonical ${asset.ticker} token that HoodFlow maps from the Robinhood Chain token registry, an onchain instrument that references ${asset.name}. Robinhood describes its Stock Tokens as derivative contracts that track an underlying security without granting shareholder rights.`,
    },
    {
      question: `Is ${asset.ticker} the same as owning ${asset.name} ${isEtf ? "fund shares" : "stock"}?`,
      answer: `No. A ${asset.type} is not a ${unit} and provides no ${isEtf ? "fund-holder" : "shareholder"} rights. It gives economic exposure only, may be restricted in your jurisdiction, and can trade at a different price from the underlying market, especially outside the US core session.`,
    },
    {
      question: `Can I trade ${asset.ticker} with HoodFlow?`,
      answer: asset.fullFill
        ? `Yes, when a fresh route is available. HoodFlow enables ${asset.ticker} because a reviewed Uniswap route passed a complete-input fork test. Every order still receives a fresh quote, a protected minimum output and an exact, short-lived Permit2 permission, and you sign in your own wallet.`
        : `Not yet. ${asset.ticker} is watch-only in HoodFlow: the market is visible, but trading stays blocked until a reviewed Uniswap route passes full-fill verification.`,
    },
    {
      question: `What is the ${asset.ticker} contract address on Robinhood Chain?`,
      answer: `HoodFlow lists ${contract} as the canonical ${asset.ticker} token contract on Robinhood Chain (chain ID 4663). Verify it on the Robinhood Chain Blockscout explorer before interacting.`,
    },
  ];
}
