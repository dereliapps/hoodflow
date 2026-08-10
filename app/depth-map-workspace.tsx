"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  DEPTH_MAP_SAMPLE_AMOUNTS,
  depthMapCooldownRemaining,
  highestFreshDepthMapPass,
  isFreshDepthMapQuote,
  type DepthMapPoint,
} from "@/lib/depth-map";
import { formatTokenAmount } from "@/lib/format-display-number";
import { MAX_ORACLE_DEVIATION_BPS } from "@/lib/oracle-protection";
import { track } from "@/lib/analytics-client";

import styles from "./depth-map-workspace.module.css";

export type DepthMapMarket = {
  ticker: string;
  name: string;
  type: "Stock" | "ETF";
  route: "V3" | "V4";
  price: number | null;
  priceStatus: "live" | "stale" | "paused" | "unavailable";
  priceUpdatedAt: number | null;
};

type DepthQuote = {
  quoteId: string;
  status: "indicative-preflight";
  asset: string;
  side: "buy";
  pay: { ticker: "USDG"; amount: string };
  receive: {
    ticker: string;
    estimatedAmount: string;
    indicativeMinimumAmount: string;
  };
  route: {
    protocol: "Uniswap V3" | "Uniswap V4";
    feeBps: number;
    gasEstimate: string | null;
  };
  protection: {
    slippageBps: number;
    dataExpiresAt: string;
    executionBinding: "none-requote-required";
  };
  reference: {
    status: "live";
    price: number;
    impliedDexPrice: number;
    deviationBps: number;
    maxDeviationBps: number;
    updatedAt: number;
  };
  requiresUserSignature: true;
  quotedAt: string;
};

type Props = {
  markets: DepthMapMarket[];
  onOpenMarket: (ticker: string, intent: { side: "buy"; amount: string; slippageBps: number }) => void;
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

function ageLabel(updatedAt: number | null, now = Date.now()) {
  if (!updatedAt) return "No verified round";
  const seconds = Math.max(0, Math.floor(now / 1_000) - updatedAt);
  if (seconds < 60) return "Updated now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m old`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h old`;
  return `${Math.floor(seconds / 86_400)}d old`;
}

function secondsUntil(value: string, now: number) {
  const target = Date.parse(value);
  return Number.isFinite(target) ? Math.max(0, Math.ceil((target - now) / 1_000)) : 0;
}

function parseDepthQuote(value: unknown, asset: string, amount: string): DepthQuote | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const quote = value as Partial<DepthQuote>;
  const amountNumber = Number(quote.pay?.amount);
  const expectedAmount = Number(amount);
  const expiresAt = Date.parse(quote.protection?.dataExpiresAt ?? "");
  if (
    quote.status !== "indicative-preflight"
    || quote.asset !== asset
    || quote.side !== "buy"
    || quote.pay?.ticker !== "USDG"
    || !Number.isFinite(amountNumber)
    || Math.abs(amountNumber - expectedAmount) > 0.000001
    || quote.receive?.ticker !== asset
    || !(Number(quote.receive.estimatedAmount) > 0)
    || !(Number(quote.receive.indicativeMinimumAmount) > 0)
    || !["Uniswap V3", "Uniswap V4"].includes(quote.route?.protocol ?? "")
    || !(Number(quote.route?.feeBps) >= 0)
    || quote.protection?.executionBinding !== "none-requote-required"
    || quote.protection.slippageBps !== 50
    || !Number.isFinite(expiresAt)
    || expiresAt <= Date.now()
    || quote.reference?.status !== "live"
    || !(Number(quote.reference.price) > 0)
    || !(Number(quote.reference.impliedDexPrice) > 0)
    || !Number.isInteger(quote.reference.deviationBps)
    || quote.reference.deviationBps < 0
    || quote.reference.deviationBps > quote.reference.maxDeviationBps
    || quote.reference.maxDeviationBps !== MAX_ORACLE_DEVIATION_BPS
    || quote.requiresUserSignature !== true
  ) return null;
  return quote as DepthQuote;
}

async function requestDepthPoint(
  asset: string,
  amount: string,
  parentSignal: AbortSignal,
): Promise<DepthMapPoint<DepthQuote>> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal.addEventListener("abort", abort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("/api/agents/quote", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ asset, side: "buy", amount, slippageBps: 50 }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 429) {
      const retryAfter = Math.max(1, Number(response.headers.get("retry-after") ?? "60") || 60);
      return {
        amount,
        status: "rate-limited",
        message: `Scanner capacity reached. Retry in about ${retryAfter}s.`,
      };
    }
    if (!response.ok) {
      return {
        amount,
        status: "unavailable",
        message: "No guarded preflight returned for this sampled size.",
      };
    }
    const quote = parseDepthQuote(await response.json(), asset, amount);
    return quote
      ? { amount, status: "pass", quote }
      : { amount, status: "unavailable", message: "The preflight response failed local verification." };
  } catch (error) {
    if (parentSignal.aborted) throw error;
    return {
      amount,
      status: "unavailable",
      message: "The live route check timed out without producing a signal.",
    };
  } finally {
    window.clearTimeout(timeout);
    parentSignal.removeEventListener("abort", abort);
  }
}

export default function DepthMapWorkspace({ markets, onOpenMarket }: Props) {
  const [asset, setAsset] = useState(() => {
    const fallback = markets.find((market) => market.ticker === "AAPL")?.ticker ?? markets[0]?.ticker ?? "AAPL";
    if (typeof window === "undefined") return fallback;
    const requested = new URL(window.location.href).searchParams.get("depthAsset")?.toUpperCase();
    return requested && markets.some((market) => market.ticker === requested) ? requested : fallback;
  });
  const [points, setPoints] = useState<Array<DepthMapPoint<DepthQuote>>>([]);
  const [selectedAmount, setSelectedAmount] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState("");
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const scanRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const selectedMarket = markets.find((market) => market.ticker === asset) ?? markets[0];
  const highestPass = useMemo(() => highestFreshDepthMapPass(points, clock), [clock, points]);
  const selectedPoint = points.find((point) => point.amount === selectedAmount) ?? highestPass ?? points[0] ?? null;
  const selectedFresh = selectedPoint?.status === "pass" && isFreshDepthMapQuote(selectedPoint.quote, clock);
  const cooldownMs = depthMapCooldownRemaining(lastScanAt, clock);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    scanRef.current += 1;
    abortRef.current?.abort();
  }, []);

  function changeAsset(nextAsset: string) {
    if (!markets.some((market) => market.ticker === nextAsset)) return;
    scanRef.current += 1;
    abortRef.current?.abort();
    setAsset(nextAsset);
    setPoints([]);
    setSelectedAmount(null);
    setScanBusy(false);
    setScanError("");
    setCopyState("idle");
    const url = new URL(window.location.href);
    url.searchParams.set("view", "depth-map");
    url.searchParams.set("depthAsset", nextAsset);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  async function runDepthScan() {
    if (scanBusy || cooldownMs > 0 || !selectedMarket) return;
    const scanId = scanRef.current + 1;
    scanRef.current = scanId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = Date.now();
    const assetAtStart = selectedMarket.ticker;
    const working: Array<DepthMapPoint<DepthQuote>> = DEPTH_MAP_SAMPLE_AMOUNTS.map((amount) => ({
      amount,
      status: "scanning" as const,
    }));
    setPoints(working);
    setSelectedAmount(DEPTH_MAP_SAMPLE_AMOUNTS[0]);
    setScanError("");
    setCopyState("idle");
    setScanBusy(true);
    setLastScanAt(startedAt);
    track("depth_scan_started", { ticker: assetAtStart });

    let nextIndex = 0;
    const results = [...working];
    const worker = async () => {
      while (nextIndex < DEPTH_MAP_SAMPLE_AMOUNTS.length && !controller.signal.aborted) {
        const index = nextIndex;
        nextIndex += 1;
        const amount = DEPTH_MAP_SAMPLE_AMOUNTS[index];
        const point = await requestDepthPoint(assetAtStart, amount, controller.signal);
        if (controller.signal.aborted || scanRef.current !== scanId) return;
        results[index] = point;
        setPoints([...results]);
      }
    };

    try {
      await Promise.all([worker(), worker()]);
      if (controller.signal.aborted || scanRef.current !== scanId) return;
      const highest = highestFreshDepthMapPass(results, Date.now());
      if (highest) setSelectedAmount(highest.amount);
      const passCount = results.filter((point) => point.status === "pass").length;
      const limited = results.some((point) => point.status === "rate-limited");
      setScanError(passCount > 0
        ? ""
        : limited
          ? "The public scanner reached its request boundary. No result was promoted from partial data."
          : "No sampled size returned a current guarded preflight. Nothing is ready for handoff.");
      track("depth_scan_completed", { ticker: assetAtStart, passCount, sampledPoints: results.length });
    } catch {
      if (!controller.signal.aborted && scanRef.current === scanId) {
        setScanError("The scan stopped before every sample completed. No stale result was promoted.");
      }
    } finally {
      if (scanRef.current === scanId) setScanBusy(false);
    }
  }

  function openSelectedHandoff() {
    if (!selectedPoint || !selectedFresh || !selectedPoint.quote) return;
    track("depth_handoff_opened", { ticker: asset, amount: selectedPoint.amount });
    onOpenMarket(asset, { side: "buy", amount: selectedPoint.amount, slippageBps: 50 });
  }

  async function copySelectedSnapshot() {
    if (!selectedPoint?.quote || !selectedFresh) return;
    const quote = selectedPoint.quote;
    const url = new URL(window.location.href);
    url.searchParams.set("view", "depth-map");
    url.searchParams.set("depthAsset", asset);
    const summary = [
      `HoodFlow DepthMap / ${asset}`,
      `${selectedPoint.amount} USDG sample passed a wallet-free preflight.`,
      `${quote.route.protocol} · ${quote.reference.deviationBps} bps from oracle · ${formatTokenAmount(quote.receive.indicativeMinimumAmount)} ${asset} protected preview floor.`,
      "PREFLIGHT — NOT A FILL. HoodFlow requotes before wallet confirmation.",
      url.href,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(summary);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  const quote = selectedPoint?.quote;
  const quoteSeconds = quote ? secondsUntil(quote.protection.dataExpiresAt, clock) : 0;
  const deviationPosition = quote
    ? Math.min(100, quote.reference.deviationBps / quote.reference.maxDeviationBps * 100)
    : 0;

  return <section className={`page inner-page ${styles.workspace}`}>
    <header className={styles.hero}>
      <div className={styles.heroCopy}>
        <p><i /> DEPTHMAP / LIVE LIQUIDITY STRESS TEST</p>
        <h1>Don&apos;t trust one quote.<br /><span>Stress the route.</span></h1>
        <div className={styles.heroDeck}>HoodFlow probes the same reviewed market at five fixed USDG sizes and shows where a guarded preflight stops answering. No wallet, approval or transaction is created.</div>
      </div>
      <div className={styles.heroStats}>
        <div><span>SAMPLE LADDER</span><strong>5</strong><small>10 → 1,000 USDG</small></div>
        <div><span>ORACLE CORRIDOR</span><strong>{MAX_ORACLE_DEVIATION_BPS}</strong><small>maximum basis points</small></div>
        <div><span>HIGHEST SAMPLED PASS</span><strong>{highestPass ? `${Number(highestPass.amount).toLocaleString("en-US")}` : "—"}</strong><small>{highestPass ? "USDG · not a maximum" : "run a live scan"}</small></div>
      </div>
    </header>

    <section className={styles.shell} aria-label="DepthMap route scanner">
      <aside className={styles.marketRail}>
        <header><span>REVIEWED MARKETS</span><b>{markets.length}</b></header>
        <div className={styles.marketList}>
          {markets.map((market) => <button
            type="button"
            aria-pressed={market.ticker === asset}
            className={market.ticker === asset ? styles.marketSelected : ""}
            key={market.ticker}
            onClick={() => changeAsset(market.ticker)}
          >
            {/* Registry logos are served directly from public assets. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/logos/${market.ticker}.png`} alt="" width={34} height={34} />
            <span><strong>{market.ticker}</strong><small>{market.name}</small></span>
            <em className={styles[market.priceStatus]}>{market.priceStatus === "live" ? "ORACLE LIVE" : market.priceStatus.toUpperCase()}</em>
          </button>)}
        </div>
        <footer><i /> Route-reviewed does not mean a quote is live.</footer>
      </aside>

      <div className={styles.board}>
        <header className={styles.boardHead}>
          <div>
            <span>SELECTED MARKET</span>
            <strong>{selectedMarket?.name} <em>{asset}</em></strong>
            <small>{selectedMarket?.type} Token · reviewed Uniswap {selectedMarket?.route}</small>
          </div>
          <div className={styles.reference}>
            <span>ONCHAIN REFERENCE</span>
            <strong>{selectedMarket?.price ? money.format(selectedMarket.price) : "Unavailable"}</strong>
            <small>{ageLabel(selectedMarket?.priceUpdatedAt ?? null, clock)}</small>
          </div>
          <button type="button" onClick={() => void runDepthScan()} disabled={scanBusy || cooldownMs > 0 || selectedMarket?.priceStatus !== "live"}>
            {scanBusy
              ? `Scanning ${points.filter((point) => point.status !== "scanning").length}/5…`
              : selectedMarket?.priceStatus !== "live"
                ? "Oracle check required"
                : cooldownMs > 0
                  ? `Fresh scan in ${Math.ceil(cooldownMs / 1_000)}s`
                  : "Run five-point scan"}
          </button>
        </header>

        <div className={styles.guardLegend}>
          <span><i /> ORACLE REFERENCE</span>
          <div><b>0 BPS</b><b>{MAX_ORACLE_DEVIATION_BPS} BPS GUARD</b></div>
          <small>Each point is a separate 0.50% slippage preflight. Failed points stay failed; HoodFlow does not interpolate between samples.</small>
        </div>

        <div className={styles.ladder} role="list" aria-live="polite">
          <div className={styles.ladderHead}><span>EXACT INPUT</span><span>DEX / ORACLE DISTANCE</span><span>ESTIMATED OUTPUT</span><span>STATE</span></div>
          {(points.length ? points : DEPTH_MAP_SAMPLE_AMOUNTS.map((amount): DepthMapPoint<DepthQuote> => ({ amount, status: "unavailable" }))).map((point) => {
            const fresh = point.status === "pass" && isFreshDepthMapQuote(point.quote, clock);
            const pointQuote = point.quote;
            const state = point.status === "scanning"
              ? "SCANNING"
              : point.status === "pass" && fresh
                ? "PASS"
                : point.status === "pass"
                  ? "EXPIRED"
                  : point.status === "rate-limited"
                    ? "RATE LIMITED"
                    : points.length
                      ? "NO SAFE PREFLIGHT"
                      : "NOT SCANNED";
            const position = pointQuote ? Math.min(100, pointQuote.reference.deviationBps / pointQuote.reference.maxDeviationBps * 100) : 0;
            return <button
              type="button"
              role="listitem"
              className={`${styles.ladderRow} ${selectedPoint?.amount === point.amount ? styles.rowSelected : ""} ${styles[`state${state.replaceAll(" ", "")}`] ?? ""}`}
              key={point.amount}
              onClick={() => setSelectedAmount(point.amount)}
            >
              <span className={styles.amount}><strong>{Number(point.amount).toLocaleString("en-US")}</strong><small>USDG</small></span>
              <span className={styles.corridor}>
                <i className={`${styles.corridorTrack} ${pointQuote ? styles.corridorObserved : styles.corridorEmpty}`}>
                  {pointQuote && <b style={{ left: `${position}%` }} />}
                </i>
                <small>{pointQuote ? `${pointQuote.reference.deviationBps} bps from oracle` : point.status === "scanning" ? "request in flight" : "no observed point"}</small>
              </span>
              <span className={styles.output}><strong>{pointQuote ? formatTokenAmount(pointQuote.receive.estimatedAmount) : "—"}</strong><small>{pointQuote ? asset : "No result"}</small></span>
              <em>{state}</em>
            </button>;
          })}
        </div>

        {scanError && <div className={styles.scanError} role="alert"><i />{scanError}</div>}
      </div>

      <aside className={styles.inspector}>
        <header><span>POINT INSPECTOR</span><b>{selectedPoint ? `${selectedPoint.amount} USDG` : "NO SAMPLE"}</b></header>
        {!selectedPoint || !quote ? <div className={styles.inspectorEmpty}><i /><strong>{scanBusy ? "Building the depth map…" : "Run the ladder."}</strong><p>Select a reviewed market and request five bounded, wallet-free preflights. A blank point never becomes a green signal.</p></div> : <>
          <div className={`${styles.verdict} ${selectedFresh ? styles.verdictPass : styles.verdictWatch}`}>
            <span>{selectedFresh ? "SAMPLED PASS" : "STALE / UNAVAILABLE"}</span>
            <strong>{selectedFresh ? `${quote.reference.deviationBps} bps from oracle` : "Fresh scan required"}</strong>
            <small>{selectedFresh ? `${quoteSeconds}s until this preflight expires` : "No order can use an expired DepthMap point."}</small>
          </div>

          <div className={styles.deviationDial} aria-label={`${quote.reference.deviationBps} basis points from the oracle reference, maximum ${quote.reference.maxDeviationBps}`}>
            <div><i style={{ left: `${deviationPosition}%` }} /></div>
            <span><b>DEX</b><strong>{money.format(quote.reference.impliedDexPrice)}</strong></span>
            <span><b>ORACLE</b><strong>{money.format(quote.reference.price)}</strong></span>
          </div>

          <dl className={styles.facts}>
            <div><dt>Exact input</dt><dd>{formatTokenAmount(quote.pay.amount)} USDG</dd></div>
            <div><dt>Estimated receive</dt><dd>{formatTokenAmount(quote.receive.estimatedAmount)} {asset}</dd></div>
            <div><dt>Preview floor</dt><dd>{formatTokenAmount(quote.receive.indicativeMinimumAmount)} {asset}</dd></div>
            <div><dt>Observed route</dt><dd>{quote.route.protocol}</dd></div>
            <div><dt>Pool fee</dt><dd>{(quote.route.feeBps / 100).toFixed(2)}%</dd></div>
            <div><dt>Gas estimate</dt><dd>{quote.route.gasEstimate ? Number(quote.route.gasEstimate).toLocaleString("en-US") : "Not returned"}</dd></div>
          </dl>

          <div className={styles.inspectorActions}>
            <button type="button" onClick={openSelectedHandoff} disabled={!selectedFresh}>Open fresh order <span>→</span></button>
            <button type="button" onClick={() => void copySelectedSnapshot()} disabled={!selectedFresh}>{copyState === "copied" ? "Snapshot copied ✓" : copyState === "error" ? "Clipboard blocked" : "Copy snapshot"}</button>
          </div>
        </>}
        <footer>Highest sampled pass is not a maximum trade size, liquidity promise or fill. The order screen requotes and runs ActionLock before any wallet signature.</footer>
      </aside>
    </section>

    <section className={styles.proofRail}>
      <article><span>01</span><p><strong>Fixed ladder</strong><small>Every market is tested at the same five USDG inputs. Users cannot inflate the scanner workload.</small></p></article>
      <article><span>02</span><p><strong>Fail closed</strong><small>No route, stale oracle, excessive deviation or timeout stays visibly unavailable.</small></p></article>
      <article><span>03</span><p><strong>Fresh handoff</strong><small>DepthMap carries the amount only. HoodFlow requotes and the user keeps the final signature.</small></p></article>
    </section>
  </section>;
}
