import type { Metadata } from "next";
import Link from "next/link";
import { absoluteUrl, breadcrumbJsonLd, jsonLdString, ORGANIZATION_ID, PAGE_LAST_MODIFIED, pageSocialMetadata, WEBSITE_ID } from "@/lib/seo";
import {
  HOODFLOW_DCA_ADDRESS,
  PERMIT2_ADDRESS,
  ROBINHOOD_MAINNET,
  UNIVERSAL_ROUTER_ADDRESS,
  USDG_ADDRESS,
} from "@/lib/hoodflow-mainnet";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Learn how Payday compares a cash-dividend Process Date with concurrent multiplier evidence, BellLock watches a market reopening, and HoodFlow keeps wallet execution user-controlled.",
  alternates: { canonical: "/docs" },
  ...pageSocialMetadata({ path: "/docs", title: "Documentation", description: "Learn how Payday compares a cash-dividend Process Date with concurrent multiplier evidence, BellLock watches a market reopening, and HoodFlow keeps wallet execution user-controlled." }),
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": absoluteUrl("/docs#page"),
      url: absoluteUrl("/docs"),
      name: "Documentation",
      description: "Learn how Payday compares a cash-dividend Process Date with concurrent multiplier evidence, BellLock watches a market reopening, and HoodFlow keeps wallet execution user-controlled.",
      inLanguage: "en",
      dateModified: PAGE_LAST_MODIFIED.docs,
      isPartOf: { "@id": WEBSITE_ID },
      publisher: { "@id": ORGANIZATION_ID },
    },
    breadcrumbJsonLd([{ name: "HoodFlow", path: "/" }, { name: "Documentation", path: "/docs" }]),
  ],
};

const explorer = "https://robinhoodchain.blockscout.com/address/";

const sections = [
  ["start", "Start here"],
  ["buy", "Buy Stock Tokens"],
  ["sell", "Sell to USDG"],
  ["quotes", "Prices and quotes"],
  ["permissions", "Wallet permissions"],
  ["routes", "Route states"],
  ["depthmap", "DepthMap"],
  ["depth-memory", "Depth Memory"],
  ["action-lock", "ActionLock"],
  ["payday", "Payday Radar"],
  ["bell-lock", "BellLock"],
  ["fillproof", "FillProof"],
  ["agents", "Agent API"],
  ["community", "Crypto"],
  ["rewards", "Referral rewards"],
  ["dca", "DCA engine"],
  ["troubleshooting", "Troubleshooting"],
] as const;

function Step({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <article className="docs-step"><span>{number}</span><div><h3>{title}</h3><p>{children}</p></div></article>;
}

export default function DocsPage() {
  return <main className="seo-shell docs-shell">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(structuredData) }} />
    <header className="seo-nav">
      <Link href="/" className="seo-logo">hoodflow<span>MAINNET BETA</span></Link>
      <nav><Link href="/stock-tokens">Markets</Link><Link href="/learn">Learn</Link><Link href="/roadmap">Roadmap</Link><Link href="/security">Security</Link><Link href="/?view=assets" className="seo-cta">Open app</Link></nav>
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

        <section id="depthmap" className="docs-section">
          <p className="docs-kicker">07 / DEPTHMAP</p><h2>Stress-test the route before opening an order</h2>
          <p><strong>DepthMap</strong> requests five separate, wallet-free Buy preflights for the selected reviewed market: 10, 25, 100, 250 and 1,000 USDG. Each sample uses the same 0.50% slippage setting, current oracle corridor and live DEX route checks as HoodFlow&apos;s agent preflight.</p>
          <div className="docs-status-grid">
            <article><b className="ready">SAMPLED PASS</b><p>The exact input returned a locally verified, unexpired indicative preflight. It is a point-in-time signal, not a guaranteed fill.</p></article>
            <article><b className="unavailable">NO SAFE PREFLIGHT</b><p>No guarded result was promoted for that input. HoodFlow does not interpolate between missing points or guess the cause.</p></article>
            <article><b className="watch">75-SECOND EXPIRY</b><p>Every DepthMap result expires quickly. An expired point loses its pass state and cannot open a prepared order.</p></article>
            <article><b className="paused">NOT A MAXIMUM</b><p>The highest sampled pass is not a maximum trade size, liquidity promise or recommendation. Larger untested values remain unknown.</p></article>
          </div>
          <div className="docs-split"><article><span>BOUNDED WORKLOAD</span><h3>Five fixed points, two at a time</h3><p>The scanner runs only after a user click, checks at most two samples concurrently and applies a cooldown between scans. It never fans out across every market in the background.</p></article><article className="accent"><span>FRESH HANDOFF</span><h3>Carry the amount, then verify again</h3><p>Opening an order carries only the selected asset and amount. The trade screen requests a new executable quote and runs ActionLock before any wallet signature.</p></article></div>
          <div className="docs-note"><span>READ IT CORRECTLY</span><p>Route-reviewed means HoodFlow has a configured, tested route. It does not mean every amount is executable at every moment. DepthMap keeps unavailable samples visible instead of turning old or partial data into a green signal.</p></div>
        </section>

        <section id="depth-memory" className="docs-section">
          <p className="docs-kicker">07B / DEPTH MEMORY</p><h2>Compare only what HoodFlow actually observed</h2>
          <p>After a complete DepthMap scan, HoodFlow saves a sanitized historical observation in this browser. Repeating the same fixed ladder later unlocks an exact-input comparison: which sampled passes appeared or were not reobserved, how the observed DEX-to-oracle distance changed and whether the reviewed venue changed.</p>
          <div className="docs-status-grid">
            <article><b className="ready">DEVICE-LOCAL</b><p>Up to five observations per market and twenty total are kept in browser storage. Wallet addresses, transaction hashes, calldata, approvals and signatures are never included.</p></article>
            <article><b className="watch">PASSED THEN</b><p>A historical pass describes an expired point-in-time observation. It is never restored into the live scanner and can never enable an order.</p></article>
            <article><b className="unavailable">NO SIGNAL</b><p>A missing historical result stays unresolved. HoodFlow does not relabel it as failed liquidity or infer a cause that the response did not prove.</p></article>
            <article><b className="paused">NO POLLING</b><p>Opening Depth Memory makes no network request. Only an explicit fresh scan calls the same bounded five-point preflight flow.</p></article>
          </div>
          <div className="docs-split"><article><span>EXACT COMPARISON</span><h3>Same market, same input</h3><p>Output and oracle-distance changes are calculated only when both selected observations passed at the identical USDG sample. Values between ladder points are never interpolated.</p></article><article className="accent"><span>FRESHNESS BOUNDARY</span><h3>History cannot become authority</h3><p>The “Run fresh comparison” action always creates five new preflights under the existing two-worker limit and cooldown. Opening an order still requires an unexpired current point, a fresh execution quote and ActionLock.</p></article></div>
          <div className="docs-note"><span>PRIVACY + CONTROL</span><p>Depth Memory works without a wallet and can be exported or cleared per market. If local storage is blocked, live DepthMap remains available and no historical notebook is created.</p></div>
        </section>

        <section id="action-lock" className="docs-section">
          <p className="docs-kicker">08 / ACTIONLOCK</p><h2>Inspect event risk before you trust a route</h2>
          <p><strong>ActionLock</strong> is a read-only preflight for route-reviewed Stock Tokens. Send the same asset, side, amount and slippage fields accepted by <code>POST /api/agents/quote</code> to <code>POST /api/action-lock</code>. It does not connect to a wallet, request approval, sign a message or submit a transaction.</p>
          <div className="docs-status-grid">
            <article><b className="ready">CANONICAL ADDRESS</b><p>Confirms that the requested ticker resolves to HoodFlow&apos;s reviewed token address instead of trusting a symbol or display name alone.</p></article>
            <article><b className="watch">CORPORATE ACTION</b><p>Surfaces known split, merger, conversion or distribution risk. Missing official event data stays explicit rather than being treated as a clean result.</p></article>
            <article><b className="watch">TOKEN MULTIPLIER</b><p>Checks the configured economic multiplier and flags a mismatch that could make the displayed unit value misleading after an event.</p></article>
            <article><b className="paused">HALT + PAUSE</b><p>Combines available market-halt context with onchain token and oracle pause signals. Unknown or stale state is never silently presented as open.</p></article>
          </div>
          <div className="docs-split"><article><span>DOWNLOADABLE PASSPORT</span><h3>Keep the inspection record</h3><p>The response can be downloaded as an ActionLock passport containing the request, observed checks, timestamps and a SHA-256 content checksum. The checksum supports byte-for-byte comparison; it is not a HoodFlow signature or proof of authenticity.</p></article><article className="accent"><span>IMPORTANT LIMITATION</span><h3>Inspection is not execution</h3><p>A passport is not proof that a swap executed, settled or remained safe after it was generated. HoodFlow must still request a fresh quote and the user must confirm every wallet action.</p></article></div>
          <div className="docs-note"><span>OFFICIAL-DATA LIMIT</span><p>Corporate-action and exchange-halt information can be incomplete, delayed or unavailable from public sources. ActionLock reports those gaps as unknown; it does not certify issuer disclosures or replace official exchange and issuer notices.</p></div>
        </section>

        <section id="payday" className="docs-section">
          <p className="docs-kicker">08B / FLOWRIGHTS</p><h2>Classify the event before previewing the increment</h2>
          <p><strong>Payday Radar</strong> is a public, read-only corporate-action inspector for HoodFlow-indexed Stock Tokens. Call <code>GET /api/payday?asset=AAPL</code> with exactly one ticker. A successful HTTP response wraps the result as <code>{`{ ok: true, data }`}</code>; eligibility still depends on every evidence gate below.</p>
          <div className="docs-status-grid">
            <article><b className="ready">EXACT EVENT CLASS</b><p>Only <code>CORPORATE_ACTION_TYPE_CASH_DIVIDEND</code> can qualify. Splits, conversions, name changes, unknown types and ambiguous active events are never relabeled as yield.</p></article>
            <article><b className="ready">UID + CHAIN 4663</b><p>The official asset, corporate action and HoodFlow registry must bind the same stable UID and the exact canonical Robinhood Chain deployment address.</p></article>
            <article><b className="watch">PROCESS DATE + MULTIPLIER</b><p>The official <code>processDate</code> is date-only scheduling evidence. Separately, the canonical token&apos;s <code>uid()</code>, <code>uiMultiplier()</code>, <code>newUIMultiplier()</code> and <code>effectiveAt()</code> must match official state before any arithmetic preview appears.</p></article>
            <article><b className="paused">FAIL CLOSED</b><p>Missing sources, a completed event without a trustworthy pre-event baseline, mismatched state or an incomplete transition returns pending, blocked or unavailable—not an inferred amount.</p></article>
          </div>
          <div className="docs-split"><article><span>PRINCIPAL-PRESERVING MATH</span><h3>One-token illustration, not a balance</h3><p>When every gate passes with code <code>CONCURRENT_MULTIPLIER_TRANSITION_READY</code>, Payday shows the raw amount that preserves the pre-event economic exposure after a positive multiplier change. The cash-dividend record and transition are concurrent evidence only. The endpoint reads no wallet balance and provides no USDG execution quote.</p></article><article className="accent"><span>RELEASE BOUNDARY</span><h3>No permission and no entitlement</h3><p>The endpoint cannot connect a wallet, request an approval, sign, submit, create a claim token, control funds, create an entitlement or return an execution handoff. Compound, Cash to USDG and Redirect remain instructions for a future audited release.</p></article></div>
          <div className="docs-note"><span>STOCK TOKENS ARE NOT SHARES</span><p>The preview describes token arithmetic and source evidence only. It is not a shareholder right, dividend claim, investment recommendation, transaction instruction or execution promise.</p></div>
          <Link className="docs-address" href="/?view=payday">Open Payday Radar →</Link>
        </section>

        <section id="bell-lock" className="docs-section">
          <p className="docs-kicker">08C / BELLLOCK</p><h2>Watch the opening bell without giving an agent your wallet</h2>
          <p><strong>BellLock</strong> is a user-armed reopening policy for Stock Tokens. It records the exact USDG intent and hard limits for opening gap, spread, oracle-to-DEX deviation and stress-size route drift. The watcher can inspect evidence; it cannot approve a token, sign a message or submit a transaction.</p>
          <div className="docs-status-grid">
            <article><b className="watch">ARMED</b><p>The policy is saved in this browser and waits for its target regular session. Keeping the page open is required in the current preview; there is no hidden background trader.</p></article>
            <article><b className="watch">WARMING</b><p>A reopening needs two fresh, distinct and sufficiently spaced observations. One print is never promoted into a signature window.</p></article>
            <article><b className="paused">REFUSED</b><p>Unknown session evidence, a halt, corporate-action conflict, stale report or breached limit fails closed. BellLock records the reason and exposes no execution handoff.</p></article>
            <article><b className="ready">READY — VERIFIED TIER ONLY</b><p>A future production handoff requires verifier-bound session reports, previous-close evidence and fresh exact plus stress quotes. The wallet still makes the final decision.</p></article>
          </div>
          <div className="docs-split"><article><span>PROOF-OF-OPEN POLICY</span><h3>Closed to open, then converge</h3><p>The strict evaluator binds a closed-to-regular-session transition, two unique report digests, compatible feed units, a verified previous close and every evidence expiry into one short signature window.</p></article><article className="accent"><span>PREVIEW SAFETY BOUNDARY</span><h3>No signed stream, no green light</h3><p>The current public preview can show official unsigned Robinhood observations and onchain reads, but it cannot call them a cryptographic session proof. Until verified Data Streams collection is configured, it returns an armed, warming, refused or unavailable receipt and never enables a trade.</p></article></div>
          <div className="docs-note"><span>CHECKSUM ≠ SIGNATURE</span><p>A BellLock receipt includes a deterministic SHA-256 integrity digest so the JSON can be compared byte for byte. That digest does not authenticate HoodFlow or the upstream publisher. Only a verifier receipt bound to the raw report can satisfy the strict proof tier.</p></div>
          <Link className="docs-address" href="/?view=bell-lock">Open BellLock →</Link>
        </section>

        <section id="fillproof" className="docs-section">
          <p className="docs-kicker">09 / FILLPROOF</p><h2>Reconstruct what actually settled</h2>
          <p>Every new reviewed Stock Token Buy or Sell can open a <strong>FillProof</strong>. HoodFlow reads the confirmed transaction, decodes the supported Universal Router command, verifies the sender and canonical token addresses, totals matching settlement transfers, and compares the actual raw output with the protected minimum encoded in calldata.</p>
          <div className="docs-split"><article><span>ONCHAIN RECONSTRUCTION</span><h3>Public facts, checked together</h3><p>The transaction hash, block, sender, router, route, raw input, minimum output, actual token transfer and native gas cost come from Robinhood Chain. A public receipt link works without connecting a wallet.</p></article><article className="accent"><span>LOCAL PRETRADE SNAPSHOT</span><h3>Expected versus actual</h3><p>New trades also keep the quoted output and ActionLock reference in wallet-scoped browser storage. Those local fields enable an expected-versus-actual comparison, but they are not presented as onchain facts or a HoodFlow signature.</p></article></div>
          <div className="docs-callout"><strong>Public verification endpoint</strong><p><code>GET /api/fill-proof?txHash=0x...</code> returns the wallet-free onchain reconstruction used by the receipt view. It accepts only confirmed, reviewed HoodFlow router settlements on chain 4663.</p></div>
          <div className="docs-note"><span>CHECKSUM LIMIT</span><p>The downloaded JSON includes a SHA-256 checksum over the reconstructed onchain fields. It detects document changes; it is not an audit, a platform signature or proof that HoodFlow originated the transaction.</p></div>
        </section>

        <section id="agents" className="docs-section">
          <p className="docs-kicker">10 / AGENT API</p><h2>Connect once, keep execution human-controlled</h2>
          <p>HoodFlow exposes the same bounded capabilities through REST, OpenAPI 3.1.2 and a stateless Streamable HTTP MCP endpoint. A successful preflight verifies the configured DEX route, current Chainlink reference, oracle-pause state and maximum DEX-to-oracle deviation. It remains indicative: HoodFlow requotes before every wallet signature.</p>
          <div className="docs-split"><article><span>MCP + OPENAPI</span><h3>Drop HoodFlow into an agent</h3><p><code>POST /api/mcp</code> exposes market discovery, quote preflight and basket planning as tools. <code>GET /openapi.json</code> publishes the equivalent REST contract. Neither connector receives a signer, private key or transaction permission.</p></article><article className="accent"><span>BASKET PREFLIGHT</span><h3>One budget, explicit legs</h3><p><code>POST /api/agents/basket</code> allocates one USDG budget across two to six unique markets and checks every leg. A basket is non-atomic: each accepted leg gets a fresh quote and a separate trade confirmation; token approval and Permit2 signing can add wallet prompts.</p></article></div>
          <div className="docs-split"><article><span>MARKET RESOURCE</span><h3>Discover reviewed routes</h3><p><code>GET /api/agents/markets</code> returns the currently exposed route-reviewed Stock Token markets, addresses, settlement asset and execution policy.</p></article><article className="accent"><span>SINGLE PREFLIGHT</span><h3>Carry intent, then requote</h3><p><code>POST /api/agents/quote</code> accepts the asset, side, exact amount and slippage. The handoff preserves those inputs, then requests a fresh execution-bound quote for final wallet confirmation.</p></article></div>
          <div className="docs-note"><span>BASKET FAILURE POLICY</span><p><code>all-or-nothing</code> returns no plan if any leg cannot pass. Explicit <code>omit-unsafe</code> can keep the safe legs without redistributing rejected budget; the user must acknowledge the partial plan before opening an order.</p></div>
          <div className="docs-callout"><strong>EconomyOS resource status</strong><p>HoodFlow is registered on EconomyOS with two public, read-only ACP resources: the Agent Manifest and Reviewed Markets. Quote, ActionLock and basket preflights remain direct HoodFlow API actions; no EconomyOS signer or transaction permission is configured.</p></div>
          <a className="docs-address" href="/api/agents/hoodflow">Open the live JSON manifest →</a>
        </section>

        <section id="community" className="docs-section">
          <p className="docs-kicker">11 / MEME + CRYPTO</p><h2>Discover tokens by contract address</h2>
          <p>The Token Terminal combines Virtuals&apos; official Robinhood Chain launch feed, top-volume, trending and newest DEX pools, and HoodFlow&apos;s canonical RWA registry. Rank the indexed markets by volume, 24-hour change, liquidity or age. Provider-derived categories remain discovery metadata; interactive category filters are not live yet.</p>
          <p>Paste any standard ERC-20 contract address on Robinhood Chain. HoodFlow reads bytecode and metadata, detects the token&apos;s lifecycle and quote asset, then probes Uniswap V2, V3 and hookless V4 liquidity only when a DEX route should exist. You can pay or receive USDG, VIRTUAL or WETH; when a direct pair is unavailable, an eligible V2 order can route through the market&apos;s native quote token in the same transaction.</p>
          <div className="docs-split"><article><span>VIRTUALS BONDING</span><h3>Trade at the source</h3><p>The token has not graduated. HoodFlow shows official Virtuals metadata and links to its source market instead of treating an empty pre-created DEX pair as executable.</p></article><article className="accent"><span>GRADUATED / DEX</span><h3>Verify live liquidity</h3><p>HoodFlow probes the active token and quote asset onchain. Embedded execution appears only after a fresh route returns non-zero output.</p></article></div>
          <div className="docs-note"><span>UNREVIEWED MODE</span><p>Contract discovery is not an endorsement or safety review. Trading is enabled only when a fresh executable route exists, but route availability does not rule out malicious transfer logic, issuer risk or liquidity withdrawal.</p></div>
        </section>

        <section id="rewards" className="docs-section">
          <p className="docs-kicker">12 / REWARDS</p><h2>How HF Points qualify</h2>
          <p>A wallet creates a shareable referral link with one message signature. The invited wallet receives 100 HF Points and its referrer receives 500 only after the invited wallet&apos;s first eligible Universal Router trade is confirmed on Robinhood Chain. Clicks, repeat trades and raw volume earn no points. Verified points are recorded now; the public Season 0 leaderboard remains Coming Soon until rankings open.</p>
          <div className="docs-callout"><strong>No guaranteed token allocation.</strong><p>HF Points are planned to inform future $HFLOW eligibility, but have no present monetary value. Conversion rate, launch, eligibility, jurisdiction and anti-sybil terms remain subject to a future announcement.</p></div>
        </section>

        <section id="dca" className="docs-section">
          <p className="docs-kicker">13 / AUTOMATION BETA</p><h2>DCA is separate from Direct Buy</h2>
          <p>The recurring engine is an advanced beta feature. Only prepare a schedule when the application reports that the deployed engine and keeper are live. A DCA defines its asset, amount, cadence, total budget, expiry and slippage boundary; keepers cannot execute outside those limits.</p>
          <a className="docs-address" href={`${explorer}${HOODFLOW_DCA_ADDRESS}`} target="_blank" rel="noreferrer">View recurring engine contract →</a>
        </section>

        <section id="troubleshooting" className="docs-section">
          <p className="docs-kicker">14 / TROUBLESHOOTING</p><h2>Common messages</h2>
          <details><summary>Wallet is on the wrong network</summary><p>Approve the network switch to Robinhood Chain. If your wallet does not add it automatically, use chain ID {ROBINHOOD_MAINNET.chainIdNumber} and the official network configuration.</p></details>
          <details><summary>Waiting for oracle</summary><p>The reference feed is unavailable, stale or still being verified. Trading stays disabled rather than using an unverified value.</p></details>
          <details><summary>No live full-fill route</summary><p>Liquidity for the selected asset or amount cannot pass the current route policy. Reduce the amount or try again later; never bypass the warning with a blind transaction.</p></details>
          <details><summary>Why does a Virtuals token open an external market?</summary><p>The token is still on the Virtuals bonding curve. The official public SDK does not currently publish Robinhood Chain write constants, so HoodFlow fails closed instead of asking your wallet to trust an inferred upgradeable router.</p></details>
          <details><summary>Transaction reverted</summary><p>The executable output may have moved below your protected minimum, the permission may have expired or the wallet balance may be insufficient. Request a new quote before retrying.</p></details>
          <details><summary>Chart history is unavailable</summary><p>The historical oracle endpoint may not have enough valid rounds. This does not create an execution price; a fresh DEX quote is still required.</p></details>
        </section>

        <section className="docs-final">
          <div><p>READY TO START?</p><h2>Begin with a quote.<br />Signing comes later.</h2></div>
          <Link href="/?view=assets">Open the market directory →</Link>
        </section>
      </div>
    </div>

    <section className="seo-risk"><strong>Stock Tokens are not shares.</strong><p>They may be restricted in your jurisdiction and do not provide shareholder rights.</p></section>
    <footer className="seo-footer"><span>Documentation · Release 0.17.0</span><Link href="/learn">Read plain-language guides</Link><Link href="/security">Review security & known limitations →</Link><a href="https://x.com/hoodfloow" target="_blank" rel="noreferrer">𝕏 @hoodfloow</a></footer>
  </main>;
}
