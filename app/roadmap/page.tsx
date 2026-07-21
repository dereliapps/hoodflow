import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Mainnet Beta Roadmap",
  description: "See what HoodFlow has shipped, what remains in progress and the objective security gates required to leave Mainnet Beta.",
  alternates: { canonical: "/roadmap" },
};

const gates = [
  ["Live", "Direct execution", "Automatic V3/V4 quotes, minimum output and exact short-lived permissions for 14 currently reviewed routes."],
  ["Live", "Wallet onboarding", "Privy social login, embedded wallets, browser wallets and WalletConnect on Robinhood Chain."],
  ["Live", "Portfolio & transparency", "Onchain balances, honest local cost basis, fee disclosure, market hours and controller visibility."],
  ["In progress", "Independent audit", "Publish an independent smart-contract and interface assessment with a public remediation log."],
  ["In progress", "Multisig + timelock", "Move engine administration away from the current single owner wallet and verify the policy onchain."],
  ["In progress", "Production RPC redundancy", "Operate at least two authenticated production providers with measured failover and incident alerts."],
  ["In progress", "DCA operating history", "Complete monitored canary volume, keeper reliability targets and an incident-response drill."],
] as const;

export default function RoadmapPage() {
  return <main className="seo-shell roadmap-shell">
    <header className="seo-nav"><Link href="/" className="seo-logo">hoodflow<span>MAINNET BETA</span></Link><nav><Link href="/stock-tokens">Markets</Link><Link href="/learn">Learn</Link><Link href="/security">Security</Link><Link href="/?view=assets" className="seo-cta">Open app</Link></nav></header>
    <section className="roadmap-hero"><div><p>PUBLIC DELIVERY PLAN</p><h1>Beta ends at a gate,<br /><em>not a marketing date.</em></h1></div><p>HoodFlow will remove the Mainnet Beta label only after every security and operations gate below is complete and publicly verifiable.</p></section>
    <section className="roadmap-progress"><div><strong>3 / 7</strong><span>EXIT GATES COMPLETE</span></div><p><i style={{ width: `${3 / 7 * 100}%` }} /></p><span>No promised date · status changes require evidence</span></section>
    <section className="roadmap-list">{gates.map(([status, title, copy], index) => <article className={status === "Live" ? "complete" : "pending"} key={title}><span>0{index + 1}</span><div><b>{status}</b><h2>{title}</h2><p>{copy}</p></div></article>)}</section>
    <section className="roadmap-principle"><p>THE RULE</p><h2>No audit badge before an audit.<br />No multisig claim before the owner changes.<br />No “ready” status without a live route.</h2><Link href="/security">Review current security state →</Link></section>
    <footer className="seo-footer"><span>Last reviewed · July 2026</span><a href="https://x.com/hoodfloow" target="_blank" rel="noreferrer">Follow roadmap updates on 𝕏 →</a></footer>
  </main>;
}
