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
  walletUsdgBalance: string;
  walletEthBalance: string;
  onOpenMarkets: () => void;
  onOpenAsset: (ticker: string) => void;
  onQuote: (ticker: string) => void;
  onWallet: () => void;
};

function MarketMark({ ticker }: { ticker: string }) {
  return (
    <span className="desk-market-mark">
      {/* Dynamic registry paths are served directly; the Vinext image shim does not proxy them. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/logos/${ticker}.png`} alt="" width={40} height={40} decoding="async" />
    </span>
  );
}

export default function RouteDeskHome({
  markets,
  routeCount,
  indexedCount,
  networkBlock,
  priceStatus,
  connected,
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

  return (
    <section className="page overview-page route-home">
      <header className="terminal-hero">
        <div className="terminal-hero-copy">
          <p className="terminal-eyebrow"><i /> Robinhood Chain execution terminal</p>
          <h1>Markets in focus.<br /><span>Routes in full view.</span></h1>
          <p className="terminal-deck">
            Discover Stock Token markets, inspect live liquidity and review a protected USDG quote
            before your self-custody wallet signs.
          </p>
          <div className="terminal-hero-actions">
            <button type="button" className="hf-primary" onClick={onOpenMarkets}>Explore markets</button>
            <button type="button" className="hf-secondary" onClick={onWallet}>{connected ? "Wallet options" : "Connect wallet"}</button>
          </div>
        </div>
        <div className="terminal-hero-readout" aria-label="Live HoodFlow status">
          <div><span>Execution routes</span><strong>{routeCount}</strong><small>reviewed markets</small></div>
          <div><span>Price verification</span><strong>{priceStatus}</strong><small>automatic checks</small></div>
          <div><span>Current block</span><strong>#{networkBlock}</strong><small>mainnet / 4663</small></div>
        </div>
      </header>

      <section className="market-terminal" aria-label="Live route desk">
        <header className="market-terminal-bar">
          <div>
            <span className="terminal-live"><i /> Live route desk</span>
            <b>{routeCount} executable / {indexedCount} indexed</b>
          </div>
          <MarketStatus compact />
        </header>

        <div className="market-terminal-grid">
          <aside className="terminal-watchlist">
            <header><span>Watchlist</span><button type="button" onClick={onOpenMarkets}>All markets</button></header>
            <div className="terminal-watchlist-columns"><span>Market</span><span>Reference</span></div>
            <div className="terminal-watchlist-list">
              {markets.map((market) => (
                <button
                  type="button"
                  aria-pressed={selected?.ticker === market.ticker}
                  className={`terminal-watchlist-row ${selected?.ticker === market.ticker ? "selected" : ""}`}
                  key={market.ticker}
                  onClick={() => setSelectedTicker(market.ticker)}
                  onDoubleClick={() => onOpenAsset(market.ticker)}
                >
                  <span className="terminal-market-id">
                    <MarketMark ticker={market.ticker} />
                    <span><strong>{market.ticker}</strong><small>{market.name}</small></span>
                  </span>
                  <span className="terminal-market-quote">
                    <strong>{market.price}</strong>
                    <small className={market.live ? "live" : "checking"}>{market.live ? market.age : "Checking"}</small>
                  </span>
                </button>
              ))}
            </div>
            <footer><span>Route coverage</span><strong>{routeCount} live</strong></footer>
          </aside>

          {selected && (
            <article className="terminal-instrument">
              <header className="terminal-instrument-head">
                <div className="terminal-market-id">
                  <MarketMark ticker={selected.ticker} />
                  <span><small>Selected market</small><strong>{selected.name} <em>{selected.ticker}</em></strong></span>
                </div>
                <span className={`terminal-state ${selected.live ? "live" : "checking"}`}><i /> {selected.live ? "Route ready" : "Verifying"}</span>
              </header>

              <div className="terminal-price">
                <p><span>Onchain reference</span><strong>{selected.price}</strong></p>
                <div><span>Oracle age</span><b>{selected.age}</b></div>
                <div><span>Venue</span><b>Uniswap {selected.protocol}</b></div>
              </div>

              <div className="terminal-route-map" aria-label={`USDG to ${selected.ticker} execution route`}>
                <div className="route-map-grid" aria-hidden="true" />
                <div className="route-map-label"><span>Protected route</span><b>Exact input / short-lived permission</b></div>
                <div className="route-map-flow">
                  <div className="route-map-node start"><small>01 / PAY</small><strong>USDG</strong><span>Your wallet</span></div>
                  <div className="route-map-line"><i /></div>
                  <div className="route-map-node center"><small>02 / ROUTE</small><strong>{selected.protocol}</strong><span>Best reviewed pool</span></div>
                  <div className="route-map-line"><i /></div>
                  <div className="route-map-node end"><small>03 / RECEIVE</small><strong>{selected.ticker}</strong><span>Direct settlement</span></div>
                </div>
                <div className="route-map-proof">
                  <span><i /> Oracle checked</span>
                  <span><i /> Minimum enforced</span>
                  <span><i /> User signature</span>
                </div>
              </div>

              <div className="terminal-instrument-foot">
                <p>The reference explains the market. Your fresh DEX quote determines execution.</p>
                <button type="button" onClick={() => onOpenAsset(selected.ticker)}>Open market details</button>
              </div>
            </article>
          )}

          {selected && (
            <aside className="terminal-ticket">
              <header><div><span>Order ticket</span><strong>Buy {selected.ticker}</strong></div><b>Protected</b></header>
              <div className="ticket-side"><button type="button" className="active">Buy</button><button type="button" onClick={() => onOpenAsset(selected.ticker)}>Sell</button></div>
              <div className="ticket-field">
                <span>You pay</span>
                <div><strong>{connected ? walletUsdgBalance : "0.00"}</strong><b>USDG</b></div>
                <small>{connected ? "Available balance" : "Connect to read balance"}</small>
              </div>
              <div className="ticket-flow" aria-hidden="true"><i /></div>
              <div className="ticket-field receive">
                <span>You receive</span>
                <div><strong>Fresh quote</strong><b>{selected.ticker}</b></div>
                <small>Calculated from the complete input</small>
              </div>
              <dl className="ticket-details">
                <div><dt>Route</dt><dd>Uniswap {selected.protocol}</dd></div>
                <div><dt>Permission</dt><dd>Exact amount</dd></div>
                <div><dt>HoodFlow fee</dt><dd>0.00%</dd></div>
                <div><dt>Gas balance</dt><dd>{connected ? `${walletEthBalance} ETH` : "Shown after connect"}</dd></div>
              </dl>
              <button type="button" className="ticket-submit" onClick={() => onQuote(selected.ticker)}>
                {connected ? "Review live quote" : "Connect & review quote"}
              </button>
              <p>No order is submitted until you approve the final route in your wallet.</p>
            </aside>
          )}
        </div>

        <footer className="market-terminal-foot">
          <div><span>01</span><p><strong>Fresh quote</strong><small>Executable output, not a display estimate.</small></p></div>
          <div><span>02</span><p><strong>Protected minimum</strong><small>The trade reverts below your floor.</small></p></div>
          <div><span>03</span><p><strong>Direct settlement</strong><small>Purchased tokens stay in your wallet.</small></p></div>
        </footer>
      </section>

      <p className="terminal-risk-note">
        Stock Tokens are not shares and may be restricted in your jurisdiction. Review eligibility and product risks before transacting.
      </p>
    </section>
  );
}
