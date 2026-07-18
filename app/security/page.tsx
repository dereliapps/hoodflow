import type { Metadata } from "next";
import Link from "next/link";
import { PERMIT2_ADDRESS, UNIVERSAL_ROUTER_ADDRESS, USDG_ADDRESS } from "@/lib/hoodflow-mainnet";

export const metadata: Metadata = {
  title: "Security, Contracts & Trading Protections",
  description: "Review HoodFlow's Robinhood Chain contracts, router addresses, slippage protection, permission model, audit status and known limitations.",
  alternates: { canonical: "/security" },
};

const explorer = "https://robinhoodchain.blockscout.com/address/";

export default function SecurityPage() {
  return <main className="seo-shell">
    <header className="seo-nav"><Link href="/" className="seo-logo">hoodflow<span>MAINNET BETA</span></Link><nav><Link href="/stock-tokens">Markets</Link><Link href="/docs">Docs</Link><Link href="/how-it-works">How it works</Link><Link href="/?view=assets" className="seo-cta">Open app</Link></nav></header>
    <section className="seo-hero security-hero"><p>SECURITY & TRANSPARENCY</p><h1>Verify the system.<br /><em>Then verify the order.</em></h1><div><p>HoodFlow exposes the contracts, route rules and limitations that matter before a wallet signature. Mainnet Beta means the interface is live while independent audit work remains pending.</p><span>Independent audit status: pending</span></div></section>
    <section className="security-status"><div><span>INTERFACE</span><strong>MAINNET BETA</strong><p>Direct Buy and Sell are enabled only for reviewed full-fill routes.</p></div><div><span>INDEPENDENT AUDIT</span><strong className="pending">PENDING</strong><p>Tests and fork simulations are not a replacement for an independent audit.</p></div><div><span>CUSTODY</span><strong>SELF-CUSTODY</strong><p>HoodFlow does not hold wallet keys or purchased tokens.</p></div></section>
    <section className="security-addresses"><h2>Addresses used by the interface</h2><div><span>USDG</span><a href={`${explorer}${USDG_ADDRESS}`} target="_blank" rel="noreferrer">{USDG_ADDRESS} ↗</a></div><div><span>Permit2</span><a href={`${explorer}${PERMIT2_ADDRESS}`} target="_blank" rel="noreferrer">{PERMIT2_ADDRESS} ↗</a></div><div><span>Universal Router</span><a href={`${explorer}${UNIVERSAL_ROUTER_ADDRESS}`} target="_blank" rel="noreferrer">{UNIVERSAL_ROUTER_ADDRESS} ↗</a></div></section>
    <section className="seo-content-grid"><article><span>01</span><h2>Minimum output</h2><p>Minimum received equals the executable quote multiplied by one minus your selected slippage. The router call fails if the protected amount cannot be delivered.</p></article><article><span>02</span><h2>Short-lived permission</h2><p>Permit2 signs the selected amount with a ten-minute expiration. Review the token, spender, amount and deadline in your wallet.</p></article><article><span>03</span><h2>Route gating</h2><p>Watch-only assets remain visible but cannot be traded until a complete-input fork execution passes and a fresh quote is available.</p></article></section>
    <section className="known-risks"><h2>Known limitations</h2><ul><li>Smart contracts and interfaces can contain undiscovered vulnerabilities.</li><li>Oracle reference prices can be delayed when underlying markets are closed.</li><li>DEX liquidity can move between the quote and wallet confirmation.</li><li>Stock Tokens are not shares and may be restricted by jurisdiction.</li><li>Robinhood Chain, RPC providers, routers and wallets are third-party systems.</li></ul></section>
    <section className="seo-risk"><strong>Independent product</strong><p>HoodFlow is built on Robinhood Chain but is not affiliated with or endorsed by Robinhood Markets, Inc.</p></section>
    <footer className="seo-footer"><Link href="/docs">Read the documentation</Link><Link href="/stock-tokens">Explore verified markets →</Link></footer>
  </main>;
}
