"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Image from "next/image";

import RagretReceipt from "./ragret-receipt";

type Props = {
  onOpenMarket: (ticker: string, intent?: { side: "buy" | "sell"; amount: string; slippageBps: number }) => void;
  onOpenCommunityMarket: (address: string) => void;
};

type Market = {
  ticker: string;
  name: string;
  type: "Stock Token" | "ETF Token";
  route: "Uniswap V3" | "Uniswap V4";
};

type Quote = {
  quoteId: string;
  status: "indicative-preflight";
  asset: string;
  side: "buy" | "sell";
  pay: { ticker: string; amount: string };
  receive: { ticker: string; estimatedAmount: string; indicativeMinimumAmount: string };
  route: { protocol: string; feeBps: number; gasEstimate: string | null };
  protection: { slippageBps: number; dataExpiresAt: string; executionBinding: "none-requote-required" };
  requiresUserSignature: true;
  quotedAt: string;
};

type PricePayload = {
  prices?: Record<string, { price: number | null; status: string; updatedAt: number | null }>;
};

const FALLBACK_MARKETS: Market[] = [
  ["AAPL", "Apple", "Stock Token", "Uniswap V4"],
  ["AMD", "AMD", "Stock Token", "Uniswap V4"],
  ["AMZN", "Amazon", "Stock Token", "Uniswap V4"],
  ["GOOGL", "Alphabet", "Stock Token", "Uniswap V4"],
  ["INTC", "Intel", "Stock Token", "Uniswap V4"],
  ["META", "Meta", "Stock Token", "Uniswap V4"],
  ["MU", "Micron", "Stock Token", "Uniswap V4"],
  ["NVDA", "NVIDIA", "Stock Token", "Uniswap V4"],
  ["SNDK", "Sandisk", "Stock Token", "Uniswap V4"],
  ["SPCX", "SpaceX", "Stock Token", "Uniswap V4"],
  ["TSLA", "Tesla", "Stock Token", "Uniswap V4"],
  ["QQQ", "Invesco QQQ", "ETF Token", "Uniswap V4"],
  ["SLV", "iShares Silver Trust", "ETF Token", "Uniswap V3"],
  ["SPY", "SPDR S&P 500", "ETF Token", "Uniswap V4"],
].map(([ticker, name, type, route]) => ({ ticker, name, type, route })) as Market[];

const priceFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function compactAmount(value: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return number.toLocaleString("en-US", { maximumFractionDigits: number >= 1 ? 6 : 10 });
}

export default function AgentsWorkspace({ onOpenMarket, onOpenCommunityMarket }: Props) {
  const [markets, setMarkets] = useState(FALLBACK_MARKETS);
  const [prices, setPrices] = useState<PricePayload["prices"]>({});
  const [asset, setAsset] = useState("AAPL");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("25");
  const [slippageBps, setSlippageBps] = useState(50);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [clock, setClock] = useState(0);
  const [referenceState, setReferenceState] = useState<"loading" | "live" | "degraded" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/agents/markets", { headers: { accept: "application/json" }, signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ markets?: Market[] }> : null)
      .then((payload) => {
        if (payload?.markets?.length) setMarkets(payload.markets);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activeController: AbortController | null = null;
    const initialDeadline = setTimeout(() => {
      if (active) setReferenceState((current) => current === "loading" ? "error" : current);
    }, 8_000);
    const refresh = async () => {
      const controller = new AbortController();
      activeController = controller;
      const requestTimeout = setTimeout(() => controller.abort(), 6_500);
      try {
        const response = await fetch("/api/prices", { headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal });
        const payload = response.ok ? await response.json() as PricePayload : null;
        if (!payload?.prices) throw new Error("Reference feed unavailable");
        if (active) {
          setPrices(payload.prices);
          setReferenceState(Object.values(payload.prices).some((point) => point.status === "live" && point.price) ? "live" : "error");
          clearTimeout(initialDeadline);
        }
      } catch {
        if (active) setReferenceState((current) => current === "live" ? "degraded" : "error");
      } finally {
        clearTimeout(requestTimeout);
        if (activeController === controller) activeController = null;
        if (active) timer = setTimeout(refresh, 10_000);
      }
    };
    void refresh();
    return () => {
      active = false;
      activeController?.abort();
      clearTimeout(initialDeadline);
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const selectedMarket = useMemo(() => markets.find((market) => market.ticker === asset) ?? markets[0], [asset, markets]);
  const pricePoint = prices?.[asset];
  const quoteSeconds = quote ? Math.max(0, Math.ceil((new Date(quote.protection.dataExpiresAt).getTime() - clock) / 1_000)) : 0;
  const quoteExpired = Boolean(quote && quoteSeconds === 0);
  const referenceReady = referenceState === "live" && pricePoint?.status === "live" && Boolean(pricePoint.price);
  const referenceLabel = referenceState === "error"
    ? "Feed unavailable · quotes blocked"
    : referenceState === "degraded"
      ? "Reconnecting · quotes blocked"
      : referenceReady
        ? priceFormatter.format(pricePoint.price!)
        : pricePoint?.status && pricePoint.status !== "live"
          ? `${pricePoint.status} reference · blocked`
          : "Checking live reference";

  async function prepareQuote(event: FormEvent) {
    event.preventDefault();
    setQuoteBusy(true);
    setQuoteError("");
    try {
      const response = await fetch("/api/agents/quote", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ asset, side, amount, slippageBps }),
      });
      const payload = await response.json() as Quote & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The route could not be verified.");
      setQuote(payload);
      setClock(Date.now());
    } catch (error) {
      setQuote(null);
      setQuoteError(error instanceof Error ? error.message : "The route could not be verified.");
    } finally {
      setQuoteBusy(false);
    }
  }

  function changeSide(nextSide: "buy" | "sell") {
    setSide(nextSide);
    setAmount(nextSide === "buy" ? "25" : "0.1");
    setQuote(null);
    setQuoteError("");
  }

  function scrollToPreflight() {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("agent-preflight")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  }

  function scrollToRagret() {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("agent-ragret")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  }

  return (
    <section className="page inner-page agents-page">
      <div className="agents-disclosure"><span>Stock Tokens are not shares and may be restricted in your jurisdiction. Review eligibility and product risks before transacting.</span></div>
      <header className="agents-hero">
        <div className="agents-hero-copy">
          <div className="agents-status-line"><span><i /> RAGRET AGENT LIVE</span><b>Deterministic engine · no LLM bill</b></div>
          <p className="eyebrow">HOODFLOW FOR AGENTS</p>
          <h1>Print the road<br /><em>you didn&apos;t take.</em></h1>
          <p>RAGRET puts the same hypothetical USDG down a Stock Token path and one exact community-token path, then prints an up-to-24-hour gap as a shareable receipt. No wallet scan, no transaction claim, no paid LLM call.</p>
          <div className="agents-hero-actions"><button className="ragret-hero-trigger" onClick={scrollToRagret}>Print a RAGRET receipt <span>↓</span></button><button onClick={scrollToPreflight}>Run a preflight <span>↓</span></button><a href="/docs#agents">API guide <span>→</span></a></div>
        </div>
        <aside className="agents-signal-card">
          <span>AVAILABLE NOW</span>
          <div><b>01</b><p><strong>Read markets</strong><small>{markets.length} currently exposed USDG routes</small></p><em>GET</em></div>
          <div><b>02</b><p><strong>Print RAGRET</strong><small>Same notional, two source windows</small></p><em>POST</em></div>
          <div><b>03</b><p><strong>Prepare quote</strong><small>Exact amount + output floor</small></p><em>POST</em></div>
          <div><b>04</b><p><strong>Open the market</strong><small>Review either route from the receipt</small></p><em>USER</em></div>
          <footer><i /><span>No custody. No background signing.</span></footer>
        </aside>
      </header>

      <div className="agents-principle-rail">
        <article><span>OBSERVE</span><strong>Live registry</strong><small>Agent reads only route-reviewed markets.</small></article>
        <article><span>REASON</span><strong>Bounded inputs</strong><small>Asset, side, amount and 1–500 bps slippage.</small></article>
        <article><span>PREPARE</span><strong>Indicative preflight</strong><small>DEX output must remain within the oracle deviation boundary.</small></article>
        <article><span>CONFIRM</span><strong>Fresh wallet quote</strong><small>HoodFlow requotes before the user signs the transaction.</small></article>
      </div>

      <RagretReceipt
        stockMarkets={markets}
        onOpenStockMarket={onOpenMarket}
        onOpenCommunityMarket={onOpenCommunityMarket}
      />

      <section className="agents-console" id="agent-preflight">
        <div className="agents-console-intro">
          <p className="eyebrow">LIVE EXECUTION PREFLIGHT</p>
          <h2>Ask HoodFlow<br />for a real route.</h2>
          <p>This calls the same reviewed Robinhood Chain quoters used by the product. If no executable pool answers, the request fails closed.</p>
          <div className="agents-selected-market">
            <Image src={`/logos/${asset}.png`} alt="" width={50} height={50} />
            <p><strong>{selectedMarket?.name}</strong><span>{asset} · {selectedMarket?.type}</span></p>
            <b className={referenceReady ? "live" : referenceState === "error" || referenceState === "degraded" ? "unavailable" : "checking"}>{referenceLabel}</b>
          </div>
          <small className="agents-oracle-note" aria-live="polite">Oracle reference is a safety signal, not the guaranteed swap price. If verification is unavailable or the DEX price deviates too far, the API returns no preflight.</small>
        </div>

        <form className="agents-quote-form" onSubmit={prepareQuote}>
          <div className="agents-form-head"><span>PREPARE_STOCK_TOKEN_QUOTE</span><b><i /> CHAIN 4663</b></div>
          <div className="agents-side-tabs"><button type="button" aria-pressed={side === "buy"} className={side === "buy" ? "active" : ""} onClick={() => changeSide("buy")}>Buy with USDG</button><button type="button" aria-pressed={side === "sell"} className={side === "sell" ? "active" : ""} onClick={() => changeSide("sell")}>Sell to USDG</button></div>
          <label className="agents-field"><span>MARKET</span><select value={asset} onChange={(event) => { setAsset(event.target.value); setQuote(null); setQuoteError(""); }}>{markets.map((market) => <option key={market.ticker} value={market.ticker}>{market.ticker} · {market.name} · {market.route}</option>)}</select></label>
          <div className="agents-form-pair">
            <label className="agents-field"><span>EXACT INPUT</span><div><input type="number" min="0.000001" max={side === "buy" ? "100000" : "1000000"} step="0.000001" value={amount} onChange={(event) => { setAmount(event.target.value); setQuote(null); setQuoteError(""); }} required /><b>{side === "buy" ? "USDG" : asset}</b></div></label>
            <label className="agents-field"><span>MAX SLIPPAGE</span><select value={slippageBps} onChange={(event) => { setSlippageBps(Number(event.target.value)); setQuote(null); setQuoteError(""); }}><option value={25}>0.25%</option><option value={50}>0.50%</option><option value={100}>1.00%</option><option value={200}>2.00%</option></select></label>
          </div>

          {quote ? <div className={`agents-quote-result ${quoteExpired ? "expired" : ""}`}>
            <header><span>{quoteExpired ? "PREFLIGHT EXPIRED" : "INDICATIVE PREFLIGHT READY"}</span><b>{quoteExpired ? "REFRESH REQUIRED" : `${quoteSeconds}s`}</b></header>
            <div><span>Exact input</span><strong>{compactAmount(quote.pay.amount)} {quote.pay.ticker}</strong></div>
            <div><span>Estimated receive</span><strong>{compactAmount(quote.receive.estimatedAmount)} {quote.receive.ticker}</strong></div>
            <div><span>Indicative output floor</span><strong>{compactAmount(quote.receive.indicativeMinimumAmount)} {quote.receive.ticker}</strong></div>
            <div><span>Reviewed route</span><strong>{quote.route.protocol} · {(quote.route.feeBps / 100).toFixed(2)}%</strong></div>
            <footer><span><i /> NOT EXECUTION-BOUND · REQUOTE REQUIRED</span><button type="button" disabled={quoteExpired} onClick={() => onOpenMarket(asset, { side: quote.side, amount: quote.pay.amount, slippageBps: quote.protection.slippageBps })}>Prefill fresh wallet quote <b>→</b></button></footer>
          </div> : <div className="agents-empty-quote"><div className="agents-pulse" /><strong>{quoteBusy ? "Checking reviewed liquidity…" : "No quote prepared yet"}</strong><span>{quoteBusy ? "The API is comparing the configured V3/V4 route." : "Choose the agent's instruction, then run a bounded preflight."}</span></div>}

          {quoteError && <div className="agents-quote-error"><strong>Request stopped safely.</strong><span>{quoteError} No transaction or wallet permission was created.</span></div>}
          <button className="agents-submit" type="submit" disabled={quoteBusy || !amount}>{quoteBusy ? "Verifying route + oracle…" : quoteExpired ? "Refresh safety preflight" : "Run safety preflight"}<span>→</span></button>
        </form>
      </section>

      <section className="agents-integration">
        <div><p className="eyebrow">THE PROVIDER SURFACE</p><h2>Useful to an agent.<br /><em>Understandable to a person.</em></h2></div>
        <div className="agents-endpoints">
          <article><span>RESOURCE · GET</span><strong>/api/agents/markets</strong><p>Execution-ready tickers, token addresses, settlement asset and route policy.</p><a href="/api/agents/markets">Inspect JSON →</a></article>
          <article><span>SCENARIO · POST</span><strong>/api/agents/ragret</strong><p>Deterministic 24-hour counterfactual receipt. No wallet read, transaction, signature or LLM call.</p><button onClick={scrollToRagret}>Print one above ↑</button></article>
          <article><span>PREFLIGHT · POST</span><strong>/api/agents/quote</strong><p>Exact-input route check with an indicative floor, oracle deviation guard and 75-second data expiry.</p><button onClick={scrollToPreflight}>Try it above ↑</button></article>
          <article><span>EXECUTION · HANDOFF</span><strong>HoodFlow market</strong><p>Side, amount and slippage are prefilled. HoodFlow requotes before the user confirms the router order.</p><button onClick={() => onOpenMarket(asset)}>Open {asset} →</button></article>
        </div>
      </section>

      <div className="agents-trust-note"><strong>What is not being claimed</strong><p>The RAGRET Virtuals profile and token are live, but this HoodFlow scenario action is not yet a published Virtuals ACP service. A RAGRET receipt is a source-backed counterfactual, not proof of a wallet transaction or financial advice.</p></div>
    </section>
  );
}
