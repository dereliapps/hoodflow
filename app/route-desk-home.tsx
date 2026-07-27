"use client";

import { useMemo, useState } from "react";
import MarketStatus from "./market-status";

export type RouteDeskMarket = {
  ticker: string;
  name: string;
  price: string;
  age: string;
  protocol: "V3" | "V4";
  live: boolean;
};

type RouteDeskHomeProps = {
  markets: RouteDeskMarket[];
  routeCount: number;
  indexedCount: number;
  networkBlock: string;
  priceStatus: string;
  connected: boolean;
  walletAddress: string;
  walletUsdgBalance: string;
  walletEthBalance: string;
  onOpenMarkets: () => void;
  onOpenAsset: (ticker: string) => void;
  onQuote: (ticker: string) => void;
  onWallet: () => void;
};

function MarketMark({ ticker }: { ticker: string }) {
  return <span className="desk-market-mark">
    {/* Dynamic registry paths are served directly; the Vinext image shim does not proxy them. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`/logos/${ticker}.png`} alt="" width={40} height={40} decoding="async" />
  </span>;
}

export default function RouteDeskHome({
  markets,
  routeCount,
  indexedCount,
  networkBlock,
  priceStatus,
  connected,
  walletAddress,
  walletUsdgBalance,
  walletEthBalance,
  onOpenMarkets,
  onOpenAsset,
  onQuote,
  onWallet,
}: RouteDeskHomeProps) {
  const [selectedTicker, setSelectedTicker] = useState(markets[0]?.ticker ?? "AAPL");
  const selected = useMemo(
    () => markets.find((market) => market.ticker === selectedTicker) ?? markets[0],
    [markets, selectedTicker],
  );

  return <section className="page overview-page route-home">
    <header className="desk-intro">
      <div className="desk-intro-copy">
        <div className="desk-kicker"><span><i /> Robinhood Chain</span><b>Mainnet</b></div>
        <h1>Stock Tokens, routed before you sign.</h1>
        <p>Compare the onchain reference, executable pool route and protected minimum in one focused workspace. Your wallet keeps final control.</p>
        <div className="desk-intro-actions">
          <button type="button" className="hf-primary" onClick={onOpenMarkets}>Explore markets <span>&rarr;</span></button>
          <button type="button" className="desk-text-action" onClick={onWallet}>{connected ? "View connected wallet" : "Connect wallet"}</button>
        </div>
      </div>
      <aside className="desk-status-panel" aria-label="HoodFlow network status">
        <div><span>Execution routes</span><strong>{routeCount}</strong><small>reviewed and enabled</small></div>
        <div><span>Price verification</span><strong>{priceStatus}</strong><small>automatic onchain checks</small></div>
        <div><span>Current block</span><strong>#{networkBlock}</strong><small>Robinhood Chain</small></div>
      </aside>
    </header>

    <MarketStatus />

    <section className="route-board" aria-label="Live Stock Token routes">
      <header className="route-board-head">
        <div><span>Live route desk</span><h2>Choose a market</h2></div>
        <p>Oracle values are references. Every order receives a fresh DEX quote for the exact amount entered.</p>
      </header>
      <div className="route-board-grid">
        <div className="route-market-list" aria-label="Execution-enabled markets">
          {markets.map((market) => <button
            type="button"
            aria-pressed={selected?.ticker === market.ticker}
            className={`route-market-row ${selected?.ticker === market.ticker ? "selected" : ""}`}
            key={market.ticker}
            onClick={() => setSelectedTicker(market.ticker)}
            onDoubleClick={() => onOpenAsset(market.ticker)}
          >
            <span className="route-market-identity"><MarketMark ticker={market.ticker} /><span><strong>{market.ticker}</strong><small>{market.name}</small></span></span>
            <span className="route-market-venue"><strong>Uniswap {market.protocol}</strong><small>USDG route</small></span>
            <span className="route-market-price"><strong>{market.price}</strong><small className={market.live ? "live" : ""}><i /> {market.age}</small></span>
            <span className="route-market-open" aria-hidden="true">&rarr;</span>
          </button>)}
        </div>

        {selected && <aside className="route-inspector">
          <div className="route-inspector-head">
            <span className="route-market-identity"><MarketMark ticker={selected.ticker} /><span><small>Selected market</small><strong>{selected.name}</strong></span></span>
            <b className={selected.live ? "live" : "checking"}><i /> {selected.live ? "Live" : "Checking"}</b>
          </div>
          <div className="route-inspector-price"><span>{selected.ticker} token reference</span><strong>{selected.price}</strong><small>{selected.age}</small></div>
          <div className="route-path" aria-label={`USDG to ${selected.ticker} execution route`}>
            <div className="route-node"><span>Pay</span><strong>USDG</strong></div>
            <i className="route-line"><b /></i>
            <div className="route-node router"><span>Route</span><strong>{selected.protocol}</strong></div>
            <i className="route-line"><b /></i>
            <div className="route-node"><span>Receive</span><strong>{selected.ticker}</strong></div>
          </div>
          <div className="route-inspector-facts">
            <div><span>Permission</span><strong>Exact amount</strong></div>
            <div><span>Expiry</span><strong>10 minutes</strong></div>
            <div><span>Settlement</span><strong>Your wallet</strong></div>
            <div><span>HoodFlow fee</span><strong>0.00%</strong></div>
          </div>
          <div className="route-inspector-actions">
            <button type="button" onClick={() => onQuote(selected.ticker)}>Prepare quote</button>
            <button type="button" onClick={() => onOpenAsset(selected.ticker)}>Market details</button>
          </div>
          <p>No transaction is submitted from this screen. The final route, minimum received and gas estimate appear before wallet confirmation.</p>
        </aside>}
      </div>
    </section>

    <section className="desk-metrics" aria-label="HoodFlow coverage">
      <div><strong>{indexedCount}</strong><span>Canonical Stock Tokens indexed</span></div>
      <div><strong>{routeCount}</strong><span>Execution-enabled USDG routes</span></div>
      <div><strong>V3 + V4</strong><span>Reviewed liquidity paths</span></div>
      <div><strong>10 min</strong><span>Maximum permit window</span></div>
    </section>

    <section className="desk-lower">
      <article className="desk-wallet">
        <header><span><i /> {connected ? "Connected wallet" : "Execution wallet"}</span><b>Self-custody</b></header>
        <div>
          <strong>{connected ? `${walletUsdgBalance} USDG` : "Connect to see balances"}</strong>
          <p>{connected ? `${walletEthBalance} ETH available for gas` : "HoodFlow never receives your seed phrase or takes custody of purchased tokens."}</p>
        </div>
        <footer><span>{connected ? walletAddress : "Robinhood Chain / 4663"}</span><button type="button" onClick={onWallet}>{connected ? "Wallet options" : "Connect wallet"}</button></footer>
      </article>
      <article className="desk-guide">
        <header><span>One order, four checks</span><a href="/how-it-works">How it works &rarr;</a></header>
        <ol>
          <li><b>01</b><span><strong>Pick the market</strong><small>Only reviewed routes can open an order.</small></span></li>
          <li><b>02</b><span><strong>Enter the amount</strong><small>The quote is calculated for the complete input.</small></span></li>
          <li><b>03</b><span><strong>Review the floor</strong><small>Fees, slippage and minimum received stay visible.</small></span></li>
          <li><b>04</b><span><strong>Confirm in wallet</strong><small>The token settles directly to your address.</small></span></li>
        </ol>
      </article>
    </section>

    <section className="desk-principles">
      <header><span>Why HoodFlow</span><h2>Execution details should be visible, not decorative.</h2></header>
      <div>
        <article><b>Route</b><h3>Full-input liquidity checks</h3><p>A market stays watch-only until the configured route can fill the complete tested input.</p></article>
        <article><b>Protection</b><h3>A minimum that lives onchain</h3><p>Your slippage setting becomes an output floor. Less than that amount means the trade reverts.</p></article>
        <article><b>Ownership</b><h3>Direct wallet settlement</h3><p>Permit2 authorizes the selected amount for a short window. HoodFlow does not become custodian.</p></article>
      </div>
    </section>

    <section className="desk-faq">
      <header><span>Before you trade</span><h2>Clear answers, before a wallet prompt.</h2></header>
      <div>
        <details><summary>Are Stock Tokens shares?</summary><p>No. They provide economic exposure without shareholder rights and may be restricted in your jurisdiction.</p></details>
        <details><summary>Does HoodFlow hold my assets?</summary><p>No. Your wallet signs the router transaction and received tokens remain at your address.</p></details>
        <details><summary>Why are some markets watch-only?</summary><p>HoodFlow blocks an order until a reviewed route passes its complete-input execution checks.</p></details>
        <details><summary>Has HoodFlow been independently audited?</summary><p>Not yet. Contract source, deployed addresses, automated checks and current limitations remain public on the Security page.</p></details>
      </div>
    </section>

    <p className="desk-risk-note">Stock Tokens are not shares and may be restricted in your jurisdiction. Review eligibility and product risks before transacting.</p>
  </section>;
}
