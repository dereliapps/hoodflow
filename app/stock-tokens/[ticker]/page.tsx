import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ROBINHOOD_TOKENS } from "@/lib/hoodflow-mainnet";
import { getSeoAsset, seoAssets } from "@/lib/seo-assets";

export function generateStaticParams() {
  return seoAssets.map((asset) => ({ ticker: asset.ticker.toLowerCase() }));
}

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }): Promise<Metadata> {
  const { ticker } = await params;
  const asset = getSeoAsset(ticker);
  if (!asset) return {};
  const title = `${asset.name} ${asset.ticker} Stock Token on Robinhood Chain`;
  const description = `View the canonical ${asset.ticker} Stock Token, execution status and protected USDG trading route on HoodFlow for Robinhood Chain.`;
  return { title, description, alternates: { canonical: `/stock-tokens/${asset.ticker.toLowerCase()}` }, openGraph: { title, description } };
}

export default async function StockTokenPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const asset = getSeoAsset(ticker);
  if (!asset) notFound();
  const contract = ROBINHOOD_TOKENS[asset.ticker];
  const structured = {
    "@context": "https://schema.org",
    "@type": "FinancialProduct",
    name: `${asset.name} ${asset.ticker} Stock Token`,
    description: `Canonical ${asset.ticker} ${asset.type} market information on Robinhood Chain.`,
    url: `https://hoodflow.app/stock-tokens/${asset.ticker.toLowerCase()}`,
    provider: { "@type": "Organization", name: "HoodFlow", url: "https://hoodflow.app" },
  };
  return <main className="seo-shell">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structured) }} />
    <header className="seo-nav"><Link href="/" className="seo-logo">hoodflow<span>MAINNET BETA</span></Link><nav><Link href="/stock-tokens">All markets</Link><Link href="/docs">Docs</Link><Link href="/security">Security</Link><Link href={`/?asset=${asset.ticker}`} className="seo-cta">Open market</Link></nav></header>
    <section className="seo-token-hero">
      <div><Image src={`/logos/${asset.ticker}.png`} alt={`${asset.name} logo`} width={84} height={84} priority /><p>{asset.type.toUpperCase()} · ROBINHOOD CHAIN</p><h1>{asset.name}<br /><em>{asset.ticker}</em></h1></div>
      <aside><span>EXECUTION STATUS</span><strong className={asset.fullFill ? "ready" : "watch"}>{asset.fullFill ? "FULL-FILL READY" : "WATCH-ONLY"}</strong><p>{asset.fullFill ? "A complete-input fork swap passed. HoodFlow still requests a fresh route quote before every order." : "The market remains visible, but HoodFlow blocks trading until a route passes full-fill verification."}</p><Link href={`/?asset=${asset.ticker}`}>{asset.fullFill ? `Compare ${asset.ticker} routes →` : "View market details →"}</Link></aside>
    </section>
    <section className="seo-facts"><div><span>NETWORK</span><strong>Robinhood Chain / 4663</strong></div><div><span>SETTLEMENT</span><strong>USDG</strong></div><div><span>CUSTODY</span><strong>Self-custody</strong></div><div><span>CONTRACT</span><a href={`https://robinhoodchain.blockscout.com/address/${contract}`} target="_blank" rel="noreferrer">{contract.slice(0, 8)}…{contract.slice(-6)} ↗</a></div></section>
    <section className="seo-content-grid"><article><span>01</span><h2>Fresh execution quote</h2><p>The oracle is an informational reference. HoodFlow asks reviewed Uniswap liquidity for an executable amount immediately before the wallet confirmation.</p></article><article><span>02</span><h2>Protected minimum output</h2><p>Your selected slippage becomes an onchain minimum. The transaction reverts instead of accepting less than the protected amount.</p></article><article><span>03</span><h2>Exact permission</h2><p>Permit2 authorizes only the selected token amount for a short window. Purchased tokens go directly to your wallet.</p></article></section>
    <section className="seo-risk"><strong>Important product risk</strong><p>Stock Tokens are not shares and may be restricted in your jurisdiction. They provide economic exposure without shareholder rights. Verify every amount and address in your wallet before signing.</p></section>
    <footer className="seo-footer"><Link href="/stock-tokens">← Explore all Stock Tokens</Link><Link href={`/?asset=${asset.ticker}`}>Open {asset.ticker} in HoodFlow →</Link></footer>
  </main>;
}
