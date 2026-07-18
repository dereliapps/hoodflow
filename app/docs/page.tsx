import type { Metadata } from "next";
import Link from "next/link";
import {
  HOODFLOW_DCA_ADDRESS,
  PERMIT2_ADDRESS,
  ROBINHOOD_MAINNET,
  UNIVERSAL_ROUTER_ADDRESS,
  USDG_ADDRESS,
} from "@/lib/hoodflow-mainnet";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Learn how to connect a wallet, buy and sell Stock Tokens, understand HoodFlow quotes, permissions, route states and common transaction errors.",
  alternates: { canonical: "/docs" },
};

const explorer = "https://robinhoodchain.blockscout.com/address/";

const sections = [
  ["start", "Start here"],
  ["buy", "Buy Stock Tokens"],
  ["sell", "Sell to USDG"],
  ["quotes", "Prices and quotes"],
  ["permissions", "Wallet permissions"],
  ["routes", "Route states"],
  ["community", "Meme + Crypto"],
  ["rewards", "Referral rewards"],
  ["dca", "DCA engine"],
  ["troubleshooting", "Troubleshooting"],
] as const;

function Step({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <article className="docs-step"><span>{number}</span><div><h3>{title}</h3><p>{children}</p></div></article>;
}

export default function DocsPage() {
  return <main className="seo-shell docs-shell">
    <header className="seo-nav">
      <Link href="/" className="seo-logo">hoodflow<span>MAINNET BETA</span></Link>
      <nav><Link href="/stock-tokens">Markets</Link><Link href="/how-it-works">How it works</Link><Link href="/security">Security</Link><Link href="/?view=assets" className="seo-cta">Open app</Link></nav>
    </header>

    <section className="docs-hero">
      <div><p>HOODFLOW DOCUMENTATION</p><h1>Understand every step<br /><em>before you sign.</em></h1></div>
      <p>Connect a self-custody wallet, inspect a protected quote and trade execution-enabled Stock Tokens on Robinhood Chain. Start with Direct Buy or Sell; automation remains a separate beta feature.</p>
    </section>

    <div className="docs-layout">
      <aside className="docs-index" aria-label="Documentation sections">
        <strong>ON THIS PAGE</strong>
        {sections.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        <Link href="/security">Contracts & security →</Link>
      </aside>

      <div className="docs-content">
        <section id="start" className="docs-section">
          <p className="docs-kicker">01 / START HERE</p><h2>What you need</h2>
          <p>HoodFlow is a wallet-first interface. There is no HoodFlow account and HoodFlow never asks for a seed phrase or private key.</p>
          <div className="docs-requirements">
            <div><span>NETWORK</span><strong>{ROBINHOOD_MAINNET.chainName}</strong><small>Chain ID {ROBINHOOD_MAINNET.chainIdNumber}</small></div>
            <div><span>PAY WITH</span><strong>USDG</strong><small>Used for supported buy routes</small></div>
            <div><span>NETWORK GAS</span><strong>ETH</strong><small>Keep a small balance for fees</small></div>
          </div>
          <div className="docs-callout"><strong>Never share recovery words.</strong><p>Wallet connection only exposes your public address. Every permission and transaction must still be confirmed inside your wallet.</p></div>
        </section>

        <section id="buy" className="docs-section">
          <p className="docs-kicker">02 / DIRECT BUY</p><h2>Buy a Stock Token with USDG</h2>
          <Step number="01" title="Connect your wallet">Use WalletConnect or an injected browser wallet, then switch to Robinhood Chain.</Step>
          <Step number="02" title="Choose an execution-enabled market">A green full-fill status means HoodFlow has a reviewed route for the complete input amount. Watch-only assets cannot be submitted.</Step>
          <Step number="03" title="Enter the USDG amount">HoodFlow checks your balance and requests a fresh route quote for that exact input.</Step>
          <Step number="04" title="Review the protection">Confirm the route, estimated output, minimum received, slippage setting and quote age before signing.</Step>
          <Step number="05" title="Approve and execute">The wallet signs a short-lived Permit2 permission, then the router transaction. The received token settles directly to your wallet.</Step>
        </section>

        <section id="sell" className="docs-section">
          <p className="docs-kicker">03 / SELL</p><h2>Sell a Stock Token back to USDG</h2>
          <p>Open an execution-enabled market, choose <strong>Sell to USDG</strong>, enter the token amount and request a fresh quote. The same output floor and expiry rules apply. Selling is unavailable when the route, oracle or token state fails a safety check.</p>
          <div className="docs-note"><span>IMPORTANT</span><p>The displayed oracle value is not a guaranteed exit price. The wallet confirmation uses the executable DEX quote and its protected minimum.</p></div>
        </section>

        <section id="quotes" className="docs-section">
          <p className="docs-kicker">04 / PRICING</p><h2>Reference price versus execution quote</h2>
          <div className="docs-split"><article><span>ORACLE REFERENCE</span><h3>Market context</h3><p>Chainlink rounds provide the onchain reference shown on market pages. References may remain unchanged while the underlying market is closed.</p></article><article className="accent"><span>DEX EXECUTION QUOTE</span><h3>What the router can fill</h3><p>HoodFlow requests a fresh Uniswap V3 or V4 quote for your exact amount. This quote, not the chart price, determines estimated and minimum output.</p></article></div>
        </section>

        <section id="permissions" className="docs-section">
          <p className="docs-kicker">05 / PERMISSIONS</p><h2>What your wallet signs</h2>
          <p>HoodFlow uses Permit2 for an exact token amount with a short expiry. Always verify the token, spender, amount and deadline in the wallet. The interface does not need custody of your assets or access to your recovery phrase.</p>
          <div className="docs-contracts">
            <a href={`${explorer}${USDG_ADDRESS}`} target="_blank" rel="noreferrer"><span>USDG</span><code>{USDG_ADDRESS}</code></a>
            <a href={`${explorer}${PERMIT2_ADDRESS}`} target="_blank" rel="noreferrer"><span>Permit2</span><code>{PERMIT2_ADDRESS}</code></a>
            <a href={`${explorer}${UNIVERSAL_ROUTER_ADDRESS}`} target="_blank" rel="noreferrer"><span>Universal Router</span><code>{UNIVERSAL_ROUTER_ADDRESS}</code></a>
          </div>
        </section>

        <section id="routes" className="docs-section">
          <p className="docs-kicker">06 / STATUS GLOSSARY</p><h2>Why a trade may be disabled</h2>
          <div className="docs-status-grid">
            <article><b className="ready">FULL-FILL READY</b><p>A reviewed route is configured and a fresh executable quote can be requested.</p></article>
            <article><b className="watch">WATCH-ONLY</b><p>The canonical token is indexed, but no route has passed HoodFlow&apos;s complete-input checks.</p></article>
            <article><b className="paused">ORACLE PAUSED</b><p>The reference feed is paused, stale or invalid. Trading remains blocked until verification recovers.</p></article>
            <article><b className="unavailable">NO LIVE ROUTE</b><p>The requested amount cannot currently receive a valid complete fill within the configured route policy.</p></article>
          </div>
        </section>

        <section id="community" className="docs-section">
          <p className="docs-kicker">07 / MEME + CRYPTO</p><h2>Discover tokens by contract address</h2>
          <p>The Token Terminal combines Robinhood Chain&apos;s top-volume, trending and newest onchain pools with HoodFlow&apos;s canonical RWA registry. Filter by Memes, RWA, DeFi, AI &amp; Agents, Infrastructure, Stablecoins or Community; rank markets by volume, 24-hour change, liquidity or pool age. Selecting a market sends its contract to the inspector.</p>
          <p>Paste any standard ERC-20 contract address on Robinhood Chain. HoodFlow reads bytecode and metadata, detects the listed pool&apos;s quote asset, then probes Uniswap V2, V3 and hookless V4 liquidity. USDG and WETH markets can execute inside HoodFlow when an onchain quote succeeds; unsupported third-party pools remain available through their live market link.</p>
          <div className="docs-note"><span>UNREVIEWED MODE</span><p>Contract discovery is not an endorsement or safety review. Trading is enabled only when a fresh direct route quote exists, but route availability does not rule out malicious transfer logic, issuer risk or liquidity withdrawal.</p></div>
        </section>

        <section id="rewards" className="docs-section">
          <p className="docs-kicker">08 / REWARDS</p><h2>How HF Points qualify</h2>
          <p>A wallet activates one referral relationship with a message signature. The invited wallet receives 100 HF Points and its referrer receives 500 only after the invited wallet&apos;s first eligible Universal Router trade is confirmed on Robinhood Chain. Clicks, repeat trades and raw volume earn no points.</p>
          <div className="docs-callout"><strong>No guaranteed token allocation.</strong><p>HF Points are planned to inform future $HFLOW eligibility, but have no present monetary value. Conversion rate, launch, eligibility, jurisdiction and anti-sybil terms remain subject to a future announcement.</p></div>
        </section>

        <section id="dca" className="docs-section">
          <p className="docs-kicker">09 / AUTOMATION BETA</p><h2>DCA is separate from Direct Buy</h2>
          <p>The recurring engine is an advanced beta feature. Only prepare a schedule when the application reports that the deployed engine and keeper are live. A DCA defines its asset, amount, cadence, total budget, expiry and slippage boundary; keepers cannot execute outside those limits.</p>
          <a className="docs-address" href={`${explorer}${HOODFLOW_DCA_ADDRESS}`} target="_blank" rel="noreferrer">View recurring engine contract →</a>
        </section>

        <section id="troubleshooting" className="docs-section">
          <p className="docs-kicker">10 / TROUBLESHOOTING</p><h2>Common messages</h2>
          <details><summary>Wallet is on the wrong network</summary><p>Approve the network switch to Robinhood Chain. If your wallet does not add it automatically, use chain ID {ROBINHOOD_MAINNET.chainIdNumber} and the official network configuration.</p></details>
          <details><summary>Waiting for oracle</summary><p>The reference feed is unavailable, stale or still being verified. Trading stays disabled rather than using an unverified value.</p></details>
          <details><summary>No live full-fill route</summary><p>Liquidity for the selected asset or amount cannot pass the current route policy. Reduce the amount or try again later; never bypass the warning with a blind transaction.</p></details>
          <details><summary>Transaction reverted</summary><p>The executable output may have moved below your protected minimum, the permission may have expired or the wallet balance may be insufficient. Request a new quote before retrying.</p></details>
          <details><summary>Chart history is unavailable</summary><p>The historical oracle endpoint may not have enough valid rounds. This does not create an execution price; a fresh DEX quote is still required.</p></details>
        </section>

        <section className="docs-final">
          <div><p>READY TO START?</p><h2>Begin with a quote.<br />Signing comes later.</h2></div>
          <Link href="/?view=assets">Open the market directory →</Link>
        </section>
      </div>
    </div>

    <section className="seo-risk"><strong>Stock Tokens are not shares.</strong><p>They may be restricted in your jurisdiction and do not provide shareholder rights. HoodFlow is an independent interface built on Robinhood Chain and is not affiliated with Robinhood Markets, Inc.</p></section>
    <footer className="seo-footer"><span>Documentation · Release 0.5.2</span><Link href="/security">Review security & known limitations →</Link></footer>
  </main>;
}
