import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { absoluteUrl, breadcrumbJsonLd, jsonLdString, ORGANIZATION_ID, pageSocialMetadata } from "@/lib/seo";
import { seoAssets } from "@/lib/seo-assets";

export const metadata: Metadata = {
  title: "Robinhood Chain Stock Tokens & Tokenized ETFs",
  description: "Explore 25 canonical Stock Tokens and tokenized ETFs on Robinhood Chain. HoodFlow enables trading only when a reviewed V3 or V4 route passes full-fill verification.",
  alternates: { canonical: "/stock-tokens" },
  ...pageSocialMetadata({
    path: "/stock-tokens",
    title: "Robinhood Chain Stock Tokens & Tokenized ETFs",
    description: "Explore 25 canonical Stock Tokens and tokenized ETFs on Robinhood Chain. HoodFlow enables trading only when a reviewed V3 or V4 route passes full-fill verification.",
  }),
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "CollectionPage",
      "@id": absoluteUrl("/stock-tokens#page"),
      url: absoluteUrl("/stock-tokens"),
      name: "Robinhood Chain Stock Tokens & Tokenized ETFs",
      description: "Directory of canonical Stock Tokens and tokenized ETFs on Robinhood Chain, with execution status for each market.",
      inLanguage: "en",
      publisher: { "@id": ORGANIZATION_ID },
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: seoAssets.length,
        itemListElement: seoAssets.map((asset, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: absoluteUrl(`/stock-tokens/${asset.ticker.toLowerCase()}`),
          name: `${asset.name} (${asset.ticker}) ${asset.type}`,
        })),
      },
    },
    breadcrumbJsonLd([{ name: "HoodFlow", path: "/" }, { name: "Stock Tokens", path: "/stock-tokens" }]),
  ],
};

export default function StockTokensPage() {
  const executionReadyCount = seoAssets.filter((asset) => asset.fullFill).length;
  const watchOnlyCount = seoAssets.length - executionReadyCount;
  return <main className="seo-shell">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(structuredData) }} />
    <header className="seo-nav"><Link href="/" className="seo-logo">hoodflow<span>MAINNET BETA</span></Link><nav><Link href="/docs">Docs</Link><Link href="/how-it-works">How it works</Link><Link href="/security">Security</Link><Link href="/?view=assets" className="seo-cta">Open app</Link></nav></header>
    <section className="seo-hero"><p>ROBINHOOD CHAIN MARKET DIRECTORY</p><h1>Stock Tokens,<br /><em>mapped for execution.</em></h1><div><p>Explore every canonical Stock Token and tokenized ETF currently indexed by HoodFlow. A trade button appears only after a reviewed Uniswap route passes a complete-input fork test.</p><span>{seoAssets.length} indexed · {executionReadyCount} execution-enabled · {watchOnlyCount} watch-only</span></div></section>
    <section className="seo-directory">
      {seoAssets.map((asset, index) => <Link key={asset.ticker} href={`/stock-tokens/${asset.ticker.toLowerCase()}`} className="seo-asset-row">
        <span>{String(index + 1).padStart(2, "0")}</span><Image src={`/logos/${asset.ticker}.png`} alt="" width={40} height={40} /><div><strong>{asset.ticker}</strong><small>{asset.name}</small></div><p>{asset.type}</p><b className={asset.fullFill ? "ready" : "watch"}>{asset.fullFill ? "FULL-FILL READY" : "WATCH-ONLY"}</b><i>View market →</i>
      </Link>)}
    </section>
    <section className="seo-risk"><strong>Stock Tokens are not shares.</strong><p>They may be restricted in your jurisdiction and do not provide shareholder rights. Oracle prices are references; every execution receives a fresh DEX quote before wallet confirmation.</p></section>
    <footer className="seo-footer"><Link href="/">Trade with HoodFlow →</Link></footer>
  </main>;
}
