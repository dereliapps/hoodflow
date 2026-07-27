"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { formatTokenAmount } from "@/lib/format-display-number";

import type {
  AgentBasketFailurePolicy,
  BasketHandoffLeg as PreparedBasketHandoffLeg,
  BasketPreparedPlan as PreparedBasketPlan,
  BasketProgress as PreparedBasketProgress,
} from "@/lib/hoodflow-basket";
import { isV3RoutedAsset, ROBINHOOD_MAINNET } from "@/lib/hoodflow-mainnet";
import { seoAssets } from "@/lib/seo-assets";

type Props = {
  onOpenMarket: (ticker: string, intent?: { side: "buy" | "sell"; amount: string; slippageBps: number }) => void;
  basketPlan: BasketPreparedPlan | null;
  basketExecution: BasketExecutionProgress | null;
  onBasketPrepared: (plan: BasketPreparedPlan) => void;
  onOpenBasketLeg: (leg: BasketHandoffLeg) => void;
  onClearBasket: () => void;
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

export type BasketFailurePolicy = AgentBasketFailurePolicy;
export type BasketHandoffLeg = PreparedBasketHandoffLeg;
export type BasketPlanProgress = PreparedBasketProgress;
export type BasketPreparedPlan = PreparedBasketPlan;

export type BasketExecutionProgress = {
  basketId: string;
  legs: Array<{
    index: number;
    status: "ready" | "submitted" | "confirmed" | "skipped";
    txHash?: string;
  }>;
};

type BasketDraftLeg = {
  id: string;
  asset: string;
  weightBps: number;
};

type ConnectorKind = "mcp" | "openapi" | "catalog";

const FALLBACK_MARKETS: Market[] = seoAssets.filter((asset) => asset.fullFill).map((asset) => ({
  ticker: asset.ticker,
  name: asset.name,
  type: asset.type === "Tokenized ETF" ? "ETF Token" : "Stock Token",
  route: isV3RoutedAsset(asset.ticker) ? "Uniswap V3" : "Uniswap V4",
}));

const priceFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const CONNECTOR_ENDPOINTS: Record<ConnectorKind, string> = {
  mcp: "https://hoodflow.app/api/mcp",
  openapi: "https://hoodflow.app/openapi.json",
  catalog: "https://hoodflow.app/.well-known/api-catalog",
};
const INITIAL_BASKET_LEGS: BasketDraftLeg[] = [
  { id: "basket-aapl", asset: "AAPL", weightBps: 2_500 },
  { id: "basket-nvda", asset: "NVDA", weightBps: 2_500 },
  { id: "basket-coin", asset: "COIN", weightBps: 2_500 },
  { id: "basket-pltr", asset: "PLTR", weightBps: 2_500 },
];

function compactAmount(value: string) {
  return formatTokenAmount(value);
}

export default function AgentsWorkspace({
  onOpenMarket,
  basketPlan,
  basketExecution,
  onBasketPrepared,
  onOpenBasketLeg,
  onClearBasket,
}: Props) {
  const [markets, setMarkets] = useState(FALLBACK_MARKETS);
  const [prices, setPrices] = useState<PricePayload["prices"]>({});
  const [asset, setAsset] = useState("AAPL");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("25");
  const [slippageBps, setSlippageBps] = useState(50);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [referenceState, setReferenceState] = useState<"loading" | "live" | "degraded" | "error">("loading");
  const [connectorStatus, setConnectorStatus] = useState<{ kind: ConnectorKind; state: "copied" | "error" } | null>(null);
  const [basketBudget, setBasketBudget] = useState(() => basketPlan?.budget.requestedAmount ?? "100");
  const [basketSlippageBps, setBasketSlippageBps] = useState(() => basketPlan?.protection.slippageBps ?? 50);
  const [basketFailurePolicy, setBasketFailurePolicy] = useState<BasketFailurePolicy>(() => basketPlan?.protection.failurePolicy ?? "all-or-nothing");
  const [basketLegs, setBasketLegs] = useState<BasketDraftLeg[]>(() => basketPlan
    ? [...basketPlan.legs, ...basketPlan.rejectedLegs]
      .sort((left, right) => left.index - right.index)
      .map((leg) => ({ id: `${basketPlan.basketId}-${leg.index}`, asset: leg.asset, weightBps: leg.weightBps }))
    : INITIAL_BASKET_LEGS);
  const [basketBusy, setBasketBusy] = useState(false);
  const [basketError, setBasketError] = useState("");

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
  const basketExpirySeconds = basketPlan
    ? Math.max(0, Math.ceil((new Date(basketPlan.protection.dataExpiresAt).getTime() - clock) / 1_000))
    : 0;
  const basketExpired = Boolean(basketPlan && basketExpirySeconds === 0);
  const basketWeightTotal = basketLegs.reduce((total, leg) => total + leg.weightBps, 0);
  const basketHasDuplicates = new Set(basketLegs.map((leg) => leg.asset)).size !== basketLegs.length;
  const activeBasketExecution = basketPlan && basketExecution?.basketId === basketPlan.basketId
    ? basketExecution
    : null;
  const confirmedBasketLegs = activeBasketExecution?.legs.filter((leg) => leg.status === "confirmed").length ?? 0;
  const basketHasSubmittedLeg = activeBasketExecution?.legs.some((leg) => leg.status === "submitted") ?? false;
  const nextBasketLeg = basketHasSubmittedLeg
    ? null
    : basketPlan?.legs.find((leg) => {
      const progress = activeBasketExecution?.legs.find((item) => item.index === leg.index);
      return !progress || progress.status === "ready";
    }) ?? null;
  useEffect(() => {
    if (!basketPlan || confirmedBasketLegs === 0 || !nextBasketLeg) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`basket-leg-${nextBasketLeg.index}-handoff`)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [basketPlan, confirmedBasketLegs, nextBasketLeg]);
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

  async function copyConnector(kind: ConnectorKind) {
    try {
      await navigator.clipboard.writeText(CONNECTOR_ENDPOINTS[kind]);
      setConnectorStatus({ kind, state: "copied" });
    } catch {
      setConnectorStatus({ kind, state: "error" });
    }
  }

  function invalidateBasketPlan() {
    if (basketPlan || basketExecution) onClearBasket();
    setBasketError("");
  }

  function updateBasketLeg(id: string, patch: Partial<Pick<BasketDraftLeg, "asset" | "weightBps">>) {
    invalidateBasketPlan();
    setBasketLegs((current) => current.map((leg) => leg.id === id ? { ...leg, ...patch } : leg));
  }

  function equalizeBasket() {
    invalidateBasketPlan();
    setBasketLegs((current) => {
      const base = Math.floor(10_000 / current.length);
      const remainder = 10_000 - base * current.length;
      return current.map((leg, index) => ({ ...leg, weightBps: base + (index < remainder ? 1 : 0) }));
    });
  }

  function addBasketLeg() {
    if (basketLegs.length >= 6) return;
    const selected = new Set(basketLegs.map((leg) => leg.asset));
    const nextAsset = markets.find((market) => !selected.has(market.ticker))?.ticker;
    if (!nextAsset) return;
    invalidateBasketPlan();
    setBasketLegs((current) => {
      const next = [...current, { id: `basket-${Date.now()}`, asset: nextAsset, weightBps: 0 }];
      const base = Math.floor(10_000 / next.length);
      const remainder = 10_000 - base * next.length;
      return next.map((leg, index) => ({ ...leg, weightBps: base + (index < remainder ? 1 : 0) }));
    });
  }

  function removeBasketLeg(id: string) {
    if (basketLegs.length <= 2) return;
    invalidateBasketPlan();
    setBasketLegs((current) => {
      const next = current.filter((leg) => leg.id !== id);
      const base = Math.floor(10_000 / next.length);
      const remainder = 10_000 - base * next.length;
      return next.map((leg, index) => ({ ...leg, weightBps: base + (index < remainder ? 1 : 0) }));
    });
  }

  async function prepareBasket(event: FormEvent) {
    event.preventDefault();
    setBasketError("");
    if (basketWeightTotal !== 10_000) {
      setBasketError("Allocations must total exactly 100.00%.");
      return;
    }
    if (basketHasDuplicates) {
      setBasketError("Each basket market must be unique.");
      return;
    }
    setBasketBusy(true);
    try {
      const response = await fetch("/api/agents/basket", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          budgetUsdG: basketBudget,
          legs: basketLegs.map(({ asset: ticker, weightBps }) => ({ asset: ticker, weightBps })),
          slippageBps: basketSlippageBps,
          failurePolicy: basketFailurePolicy,
        }),
      });
      const payload = await response.json() as BasketPreparedPlan & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The basket could not be prepared.");
      setClock(Date.now());
      onBasketPrepared(payload);
    } catch (error) {
      onClearBasket();
      setBasketError(error instanceof Error ? error.message : "The basket could not be prepared.");
    } finally {
      setBasketBusy(false);
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

  function scrollToBasket() {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("agent-basket")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  }

  return (
    <section className="page inner-page agents-page">
      <div className="agents-disclosure"><span>Stock Tokens are not shares and may be restricted in your jurisdiction. Review eligibility and product risks before transacting.</span></div>
      <header className="agents-hero">
        <div className="agents-hero-copy">
          <div className="agents-status-line"><span><i /> PUBLIC AGENT API LIVE</span><b>Virtuals ACP resource not yet published</b></div>
          <p className="eyebrow">HOODFLOW FOR AGENTS</p>
          <h1>Let an agent find the route.<br /><em>You keep the signature.</em></h1>
          <p>Give an AI agent a structured market registry and a bounded preflight action. HoodFlow checks reviewed Robinhood Chain liquidity, rejects unsafe oracle deviation, then carries the exact intent into a fresh wallet-confirmed order.</p>
          <div className="agents-hero-actions"><a href="/docs#agents">View API guide <span>→</span></a><button onClick={scrollToPreflight}>Single preflight <span>↓</span></button><button onClick={scrollToBasket}>Build a basket <span>↓</span></button></div>
        </div>
        <aside className="agents-signal-card">
          <span>AVAILABLE NOW</span>
          <div><b>01</b><p><strong>Read markets</strong><small>{markets.length} currently exposed USDG routes</small></p><em>GET</em></div>
          <div><b>02</b><p><strong>Prepare quote</strong><small>Exact amount + output floor</small></p><em>POST</em></div>
          <div><b>03</b><p><strong>Build basket</strong><small>2–6 weighted, route-checked legs</small></p><em>PLAN</em></div>
          <div><b>04</b><p><strong>Carry intent</strong><small>Every leg waits for its user</small></p><em>USER</em></div>
          <footer><i /><span>No custody. No background signing.</span></footer>
        </aside>
      </header>

      <div className="agents-principle-rail">
        <article><span>OBSERVE</span><strong>Live registry</strong><small>Agent reads only route-reviewed markets.</small></article>
        <article><span>REASON</span><strong>Bounded inputs</strong><small>Asset, side, amount and 1–500 bps slippage.</small></article>
        <article><span>PREPARE</span><strong>Indicative preflight</strong><small>DEX output must remain within the oracle deviation boundary.</small></article>
        <article><span>CONFIRM</span><strong>Fresh wallet quote</strong><small>HoodFlow requotes before the user signs the transaction.</small></article>
      </div>

      <section className="agents-connector" aria-labelledby="agent-connector-title">
        <div className="agents-connector-copy">
          <p className="eyebrow">ONE-COPY AGENT CONNECTOR</p>
          <h2 id="agent-connector-title">Plug in the tools.<br /><em>Keep signing human.</em></h2>
          <p>Point any compatible agent at HoodFlow&apos;s public tool surface. It can read reviewed markets and prepare bounded preflights, but it cannot hold funds, build an executable order or submit a transaction.</p>
          <div className="agents-connector-safety"><i /><span>No custody, signing, calldata or transaction submission.</span></div>
        </div>
        <div className="agents-connector-cards">
          <article>
            <header><span>MCP</span><b><i /> LIVE</b></header>
            <strong>Read + preflight tools</strong>
            <p>Expose <code>list_markets</code>, <code>prepare_quote</code> and <code>prepare_basket</code> through one remote endpoint.</p>
            <code className="agents-connector-url">{CONNECTOR_ENDPOINTS.mcp}</code>
            <button type="button" onClick={() => void copyConnector("mcp")}>{connectorStatus?.kind === "mcp" && connectorStatus.state === "copied" ? "Copied MCP URL ✓" : "Copy MCP URL"} <span>→</span></button>
          </article>
          <article>
            <header><span>OPENAPI</span><b>PUBLIC SCHEMA</b></header>
            <strong>Bring your own agent</strong>
            <p>Import the machine-readable schema into an OpenAPI-compatible agent or inspect every bounded input first.</p>
            <code className="agents-connector-url">{CONNECTOR_ENDPOINTS.openapi}</code>
            <div className="agents-connector-actions"><button type="button" onClick={() => void copyConnector("openapi")}>{connectorStatus?.kind === "openapi" && connectorStatus.state === "copied" ? "Copied schema URL ✓" : "Copy schema URL"}</button><a href="/openapi.json">Open JSON ↗</a></div>
          </article>
          <footer><span>DISCOVERY</span><code>{CONNECTOR_ENDPOINTS.catalog}</code><button type="button" onClick={() => void copyConnector("catalog")}>{connectorStatus?.kind === "catalog" && connectorStatus.state === "copied" ? "Copied ✓" : "Copy catalog"}</button></footer>
        </div>
        <p className="agents-copy-status" role="status" aria-live="polite">{connectorStatus?.state === "error" ? "Clipboard access was blocked. Select and copy the endpoint shown above." : connectorStatus?.state === "copied" ? "Connector address copied to your clipboard." : ""}</p>
      </section>

      <section className="agents-console" id="agent-preflight">
        <div className="agents-console-intro">
          <p className="eyebrow">LIVE EXECUTION PREFLIGHT</p>
          <h2>Ask HoodFlow<br />for a real route.</h2>
          <p>This calls the same reviewed Robinhood Chain quoters used by the product. If no executable pool answers, the request fails closed.</p>
          <div className="agents-selected-market">
            {/* Dynamic registry logos bypass the Vinext image optimizer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/logos/${asset}.png`} alt="" width={50} height={50} />
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

          {quote ? <div className={`agents-quote-result ${quoteExpired ? "expired" : ""}`} role="status" aria-live="polite">
            <header><span>{quoteExpired ? "PREFLIGHT EXPIRED" : "INDICATIVE PREFLIGHT READY"}</span><b>{quoteExpired ? "REFRESH REQUIRED" : `${quoteSeconds}s`}</b></header>
            <div><span>Exact input</span><strong>{compactAmount(quote.pay.amount)} {quote.pay.ticker}</strong></div>
            <div><span>Estimated receive</span><strong>{compactAmount(quote.receive.estimatedAmount)} {quote.receive.ticker}</strong></div>
            <div><span>Indicative output floor</span><strong>{compactAmount(quote.receive.indicativeMinimumAmount)} {quote.receive.ticker}</strong></div>
            <div><span>Reviewed route</span><strong>{quote.route.protocol} · {(quote.route.feeBps / 100).toFixed(2)}%</strong></div>
            <footer><span><i /> NOT EXECUTION-BOUND · REQUOTE REQUIRED</span><button type="button" disabled={quoteExpired} onClick={() => onOpenMarket(asset, { side: quote.side, amount: quote.pay.amount, slippageBps: quote.protection.slippageBps })}>Prefill fresh wallet quote <b>→</b></button></footer>
          </div> : <div className="agents-empty-quote" role="status" aria-live="polite"><div className="agents-pulse" /><strong>{quoteBusy ? "Checking reviewed liquidity…" : "No quote prepared yet"}</strong><span>{quoteBusy ? "The API is comparing the configured V3/V4 route." : "Choose the agent's instruction, then run a bounded preflight."}</span></div>}

          {quoteError && <div className="agents-quote-error" role="alert"><strong>Request stopped safely.</strong><span>{quoteError} No transaction or wallet permission was created.</span></div>}
          <button className="agents-submit" type="submit" disabled={quoteBusy || !amount}>{quoteBusy ? "Verifying route + oracle…" : quoteExpired ? "Refresh safety preflight" : "Run safety preflight"}<span>→</span></button>
        </form>
      </section>

      <section className="agents-basket" id="agent-basket" aria-labelledby="agent-basket-title">
        <header className="agents-basket-heading">
          <div><p className="eyebrow">DETERMINISTIC BASKET AGENT</p><h2 id="agent-basket-title">Split one budget.<br /><em>Sign every leg.</em></h2></div>
          <p>Build a weighted USDG basket across two to six route-reviewed markets. HoodFlow checks every leg without an AI model, then hands each exact allocation to a fresh wallet quote one at a time.</p>
        </header>

        <div className="agents-basket-shell">
          <form className="agents-basket-builder" onSubmit={prepareBasket} aria-busy={basketBusy}>
            <div className="agents-form-head"><span>PREPARE_WEIGHTED_BASKET</span><b><i /> NO MODEL API</b></div>
            <div className="agents-basket-fields">
              <label className="agents-field"><span>TOTAL BUDGET</span><div><input type="number" min="0.000001" max="100000" step="0.000001" value={basketBudget} onChange={(event) => { invalidateBasketPlan(); setBasketBudget(event.target.value); }} required /><b>USDG</b></div></label>
              <label className="agents-field"><span>MAX SLIPPAGE / LEG</span><select value={basketSlippageBps} onChange={(event) => { invalidateBasketPlan(); setBasketSlippageBps(Number(event.target.value)); }}><option value={25}>0.25%</option><option value={50}>0.50%</option><option value={100}>1.00%</option><option value={200}>2.00%</option></select></label>
            </div>

            <fieldset className="agents-basket-policy">
              <legend>IF A LEG FAILS PREFLIGHT</legend>
              <label className={basketFailurePolicy === "all-or-nothing" ? "selected" : ""}><input type="radio" name="basket-policy" value="all-or-nothing" checked={basketFailurePolicy === "all-or-nothing"} onChange={() => { invalidateBasketPlan(); setBasketFailurePolicy("all-or-nothing"); }} /><span><strong>Stop the basket</strong><small>No plan unless every selected route passes.</small></span></label>
              <label className={basketFailurePolicy === "omit-unsafe" ? "selected" : ""}><input type="radio" name="basket-policy" value="omit-unsafe" checked={basketFailurePolicy === "omit-unsafe"} onChange={() => { invalidateBasketPlan(); setBasketFailurePolicy("omit-unsafe"); }} /><span><strong>Omit unsafe legs</strong><small>Leave their USDG unallocated. Never redistribute silently.</small></span></label>
            </fieldset>

            <div className="agents-basket-allocation-head"><span>MARKET ALLOCATION</span><button type="button" onClick={equalizeBasket}>Equal split</button></div>
            <div className="agents-basket-legs">
              {basketLegs.map((leg, index) => {
                const selectedElsewhere = new Set(basketLegs.filter((item) => item.id !== leg.id).map((item) => item.asset));
                return <div className="agents-basket-draft-leg" key={leg.id}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <label><span className="agents-visually-hidden">Market {index + 1}</span><select aria-label={`Basket market ${index + 1}`} value={leg.asset} onChange={(event) => updateBasketLeg(leg.id, { asset: event.target.value })}>{markets.map((market) => <option key={market.ticker} value={market.ticker} disabled={selectedElsewhere.has(market.ticker)}>{market.ticker} · {market.name}</option>)}</select></label>
                  <label className="agents-weight-input"><span className="agents-visually-hidden">Allocation percentage for {leg.asset}</span><input aria-label={`${leg.asset} allocation percentage`} type="number" min="0.01" max="100" step="0.01" value={leg.weightBps / 100} onChange={(event) => updateBasketLeg(leg.id, { weightBps: Math.round(Number(event.target.value) * 100) })} /><b>%</b></label>
                  <button type="button" aria-label={`Remove ${leg.asset} from basket`} onClick={() => removeBasketLeg(leg.id)} disabled={basketLegs.length <= 2}>×</button>
                </div>;
              })}
            </div>
            <div className="agents-basket-allocation-foot">
              <button type="button" onClick={addBasketLeg} disabled={basketLegs.length >= 6}>+ Add market <span>{basketLegs.length}/6</span></button>
              <strong className={basketWeightTotal === 10_000 && !basketHasDuplicates ? "valid" : "invalid"}>{(basketWeightTotal / 100).toFixed(2)}% allocated</strong>
            </div>
            <p className="agents-basket-rule">Weights must total exactly 100.00%. USDG rounding stays deterministic and any remainder is assigned explicitly by the planner.</p>
            {basketError && <div className="agents-quote-error" role="alert"><strong>Basket stopped safely.</strong><span>{basketError} No transaction or wallet permission was created.</span></div>}
            <button className="agents-submit" type="submit" disabled={basketBusy || !basketBudget || basketWeightTotal !== 10_000 || basketHasDuplicates}>{basketBusy ? "Checking every route…" : basketPlan ? "Refresh basket preflight" : "Prepare basket plan"}<span>→</span></button>
          </form>

          <aside className={`agents-basket-plan ${basketPlan ? "prepared" : ""}`} aria-busy={basketBusy}>
            {!basketPlan && <div className="agents-basket-empty"><div className="agents-basket-orbit"><i /><i /><i /></div><span>SEQUENTIAL WALLET HANDOFF</span><strong role="status">{basketBusy ? "Checking every selected route…" : "Your basket plan appears here."}</strong><p>Nothing is bundled, signed or submitted in the background. Each prepared leg opens a fresh HoodFlow quote and waits for you.</p></div>}
            {basketPlan && <>
              <header><div><span role="status">{basketPlan.status === "partial-indicative-preflight" ? "PARTIAL PLAN READY" : "BASKET PLAN READY"}</span><strong>{basketPlan.basketId}</strong></div><b className={basketExpired ? "expired" : ""}>{basketExpired ? "PREVIEW EXPIRED · FRESH QUOTES REQUIRED" : `${basketExpirySeconds}s PREVIEW`}</b></header>
              <div className="agents-basket-summary">
                <p><span>Requested</span><strong>{compactAmount(basketPlan.budget.requestedAmount)} USDG</strong></p>
                <p><span>Planned</span><strong>{compactAmount(basketPlan.budget.plannedAmount)} USDG</strong></p>
                <p><span>Unallocated</span><strong className={Number(basketPlan.budget.unallocatedAmount) > 0 ? "warning" : ""}>{compactAmount(basketPlan.budget.unallocatedAmount)} USDG</strong></p>
                <p><span>Wallet steps</span><strong>{confirmedBasketLegs}/{basketPlan.legs.length} confirmed</strong></p>
              </div>
              <div className="agents-basket-progress" role="progressbar" aria-label="Confirmed basket legs" aria-valuemin={0} aria-valuemax={basketPlan.legs.length} aria-valuenow={confirmedBasketLegs}><i style={{ width: `${basketPlan.legs.length ? confirmedBasketLegs / basketPlan.legs.length * 100 : 0}%` }} /></div>
              {basketPlan.legs.length > 0 && confirmedBasketLegs === basketPlan.legs.length && <div className="agents-basket-complete" role="status"><i />All prepared legs are confirmed. Each receipt remains independently verifiable.</div>}
              <ol className="agents-basket-plan-legs">
                {basketPlan.legs.map((leg) => {
                  const execution = activeBasketExecution?.legs.find((item) => item.index === leg.index);
                  const status = execution?.status ?? "ready";
                  const isNext = nextBasketLeg?.index === leg.index;
                  return <li key={`${basketPlan.basketId}-${leg.index}`} className={`${status} ${isNext ? "next" : ""}`} aria-current={isNext ? "step" : undefined}>
                    <span className="agents-basket-step">{status === "confirmed" ? "✓" : status === "submitted" ? "…" : String(leg.index + 1).padStart(2, "0")}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/logos/${leg.asset}.png`} alt="" width={38} height={38} />
                    <div><strong>{leg.asset} <small>{(leg.weightBps / 100).toFixed(2)}%</small></strong><span>{compactAmount(leg.allocation.amount)} USDG → ≈ {compactAmount(leg.quote.receive.estimatedAmount)} {leg.quote.receive.ticker}</span><em>{leg.quote.route.protocol} · {(leg.quote.route.feeBps / 100).toFixed(2)}% pool fee</em></div>
                    {status === "confirmed"
                      ? execution?.txHash ? <a href={`${ROBINHOOD_MAINNET.blockExplorerUrls[0]}/tx/${execution.txHash}`} target="_blank" rel="noreferrer">Receipt ↗</a> : <b>Confirmed</b>
                      : status === "submitted"
                        ? execution?.txHash ? <a href={`${ROBINHOOD_MAINNET.blockExplorerUrls[0]}/tx/${execution.txHash}`} target="_blank" rel="noreferrer">Submitted ↗</a> : <b>Submitted</b>
                        : status === "skipped"
                          ? <b>Skipped</b>
                          : <button id={`basket-leg-${leg.index}-handoff`} type="button" disabled={!isNext} onClick={() => onOpenBasketLeg(leg)}>{isNext ? "Fresh quote + review" : "Previous leg first"}</button>}
                  </li>;
                })}
              </ol>
              {basketPlan.rejectedLegs.length > 0 && <div className="agents-basket-rejected"><strong>{basketPlan.rejectedLegs.length} leg{basketPlan.rejectedLegs.length === 1 ? "" : "s"} omitted</strong>{basketPlan.rejectedLegs.map((leg) => <span key={`${leg.index}-${leg.asset}`}>{leg.asset} · {compactAmount(leg.allocation.amount)} USDG remains unallocated</span>)}</div>}
              <footer><span><i /> {basketPlan.execution.atomic ? "ATOMIC" : "NOT ATOMIC"} · {basketPlan.execution.minimumTradeConfirmations} MINIMUM TRADE CONFIRMATIONS</span><p>Every leg requotes. Token approval and Permit2 signing can add wallet prompts; a later failure never reverses an earlier transaction.</p></footer>
            </>}
          </aside>
        </div>
      </section>

      <section className="agents-integration">
        <div><p className="eyebrow">THE PROVIDER SURFACE</p><h2>Useful to an agent.<br /><em>Understandable to a person.</em></h2></div>
        <div className="agents-endpoints">
          <article><span>RESOURCE · GET</span><strong>/api/agents/markets</strong><p>Execution-ready tickers, token addresses, settlement asset and route policy.</p><a href="/api/agents/markets">Inspect JSON →</a></article>
          <article><span>PREFLIGHT · POST</span><strong>/api/agents/quote</strong><p>Exact-input route check with an indicative floor, oracle deviation guard and 75-second data expiry.</p><button onClick={scrollToPreflight}>Try it above ↑</button></article>
          <article><span>EXECUTION · HANDOFF</span><strong>HoodFlow market</strong><p>Side, amount and slippage are prefilled. HoodFlow requotes before the user confirms the router order.</p><button onClick={() => onOpenMarket(asset)}>Open {asset} →</button></article>
        </div>
      </section>

      <div className="agents-trust-note"><strong>What is not being claimed</strong><p>HoodFlow is not yet listed as a live Virtuals ACP provider. The public resource and quote-preflight surface are ready; registry onboarding, commercial terms and any future scoped agent signer remain separate release gates.</p></div>
    </section>
  );
}
