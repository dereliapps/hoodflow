import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How HoodFlow Finds Stock Token Routes",
  description: "See how HoodFlow checks Robinhood Chain liquidity, protects minimum output with slippage limits and uses short-lived Permit2 permissions.",
  alternates: { canonical: "/how-it-works" },
};

const steps = [
  ["01", "Choose a canonical market", "HoodFlow maps the official Robinhood Chain token registry and keeps markets without a verified full-fill route in watch-only mode."],
  ["02", "Compare reviewed liquidity", "For execution-enabled assets, HoodFlow requests a fresh quote from the configured Uniswap V3 or V4 routes for the exact amount you entered."],
  ["03", "Set your protection", "The quote is reduced by your selected slippage tolerance to produce an onchain minimum received amount."],
  ["04", "Approve the exact order", "Permit2 grants a short-lived permission for the selected amount. It is not an unlimited strategy allowance."],
  ["05", "Receive in your wallet", "The Universal Router executes the order and sends the purchased Stock Token directly to your connected wallet."],
];

export default function HowItWorksPage() {
  return <main className="seo-shell">
    <header className="seo-nav"><Link href="/" className="seo-logo">hoodflow<span>MAINNET BETA</span></Link><nav><Link href="/stock-tokens">Markets</Link><Link href="/security">Security</Link><Link href="/?view=assets" className="seo-cta">Open app</Link></nav></header>
    <section className="seo-hero"><p>EXECUTION, EXPLAINED</p><h1>Every trade<br /><em>earns its route.</em></h1><div><p>HoodFlow is a self-custody execution interface for Stock Tokens on Robinhood Chain. It does not custody funds, invent prices or force orders through thin liquidity.</p><span>Fresh quote · protected minimum · direct settlement</span></div></section>
    <section className="seo-steps">{steps.map(([number, title, copy]) => <article key={number}><span>{number}</span><h2>{title}</h2><p>{copy}</p></article>)}</section>
    <section className="seo-comparison"><div><p>STANDARD SWAP VIEW</p><h2>A quote without context.</h2><ul><li>One visible route</li><li>Little explanation of route readiness</li><li>Oracle and execution price can be confused</li></ul></div><div className="accent"><p>HOODFLOW WORKSPACE</p><h2>An executable route with boundaries.</h2><ul><li>Reviewed V3/V4 route selection</li><li>Full-input verification status</li><li>Fresh DEX quote separated from oracle reference</li><li>Exact amount and expiry before signing</li></ul></div></section>
    <section className="seo-risk"><strong>No hidden custody layer</strong><p>HoodFlow is an interface. Your wallet signs the order, the router executes it and the received token remains in your wallet.</p></section>
    <footer className="seo-footer"><span>Understand the route before signing it.</span><Link href="/stock-tokens">Explore Stock Tokens →</Link></footer>
  </main>;
}
