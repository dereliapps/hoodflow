import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { seoAssets } from "@/lib/seo-assets";

export const metadata: Metadata = {
  title: "Robinhood Chain Stock Tokens & Tokenized ETFs",
  description: "Explore 25 canonical Stock Tokens and tokenized ETFs on Robinhood Chain. HoodFlow enables trading only when a reviewed V3 or V4 route passes full-fill verification.",
  alternates: { canonical: "/stock-tokens" },
};

export default function StockTokensPage() {
  return <main className="seo-shell">
    <header className="seo-nav"><Link href="/" className="seo-logo">hoodflow<span>MAINNET BETA</span></Link><nav><Link href="/docs">Docs</Link><Link href="/how-it-works">How it works</Link><Link href="/security">Security</Link><Link href="/?view=assets" className="seo-cta">Open app</Link></nav></header>
    <section className="seo-hero"><p>ROBINHOOD CHAIN MARKET DIRECTORY</p><h1>Stock Tokens,<br /><em>mapped for execution.</em></h1><div><p>Explore every canonical Stock Token and tokenized ETF currently indexed by HoodFlow. A trade button appears only after a reviewed Uniswap route passes a complete-input fork test.</p><span>25 indexed · 15 execution-enabled · 10 watch-only</span></div></section>
    <section className="seo-directory">
      {seoAssets.map((asset, index) => <Link key={asset.ticker} href={`/stock-tokens/${asset.ticker.toLowerCase()}`} className="seo-asset-row">
        <span>{String(index + 1).padStart(2, "0")}</span><Image src={`/logos/${asset.ticker}.png`} alt="" width={40} height={40} /><div><strong>{asset.ticker}</strong><small>{asset.name}</small></div><p>{asset.type}</p><b className={asset.fullFill ? "ready" : "watch"}>{asset.fullFill ? "FULL-FILL READY" : "WATCH-ONLY"}</b><i>View market →</i>
      </Link>)}
    </section>
    <section className="seo-risk"><strong>Stock Tokens are not shares.</strong><p>They may be restricted in your jurisdiction and do not provide shareholder rights. Oracle prices are references; every execution receives a fresh DEX quote before wallet confirmation.</p></section>
    <footer className="seo-footer"><span>Independent interface built on Robinhood Chain. Not affiliated with Robinhood Markets, Inc.</span><Link href="/">Trade with HoodFlow →</Link></footer>
  </main>;
}
