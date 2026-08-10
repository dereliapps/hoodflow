"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  DEPTH_MAP_SAMPLE_AMOUNTS,
  depthMapCooldownRemaining,
  highestFreshDepthMapPass,
  isFreshDepthMapQuote,
  type DepthMapPoint,
} from "@/lib/depth-map";
import {
  appendDepthMemory,
  clearDepthMemoryAsset,
  createDepthMemoryScan,
  DEPTH_MEMORY_STORAGE_KEY,
  parseDepthMemory,
  sanitizeDepthMemoryScan,
  serializeDepthMemory,
  type DepthMemoryScan,
} from "@/lib/depth-memory";
import { formatTokenAmount } from "@/lib/format-display-number";
import { MAX_ORACLE_DEVIATION_BPS } from "@/lib/oracle-protection";
import { track } from "@/lib/analytics-client";

import DepthMemoryPanel from "./depth-memory-panel";
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
    heartbeat: number;
    oraclePaused: false;
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

const DEPTH_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,36})?$/;
const DEPTH_MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const DEPTH_MAX_QUOTE_TTL_MS = 2 * 60 * 1_000;
const DEPTH_MAX_ORACLE_HEARTBEAT_SECONDS = 7 * 24 * 60 * 60;
const DEPTH_MEMORY_LOCK_NAME = "hoodflow-depth-memory-write-v1";

async function withDepthMemoryStorageLock<T>(operation: () => T | Promise<T>) {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(DEPTH_MEMORY_LOCK_NAME, { mode: "exclusive" }, operation);
  }
  return operation();
}

const DEPTH_ORACLE_TIMESTAMP_TOLERANCE_MS = 1_000;

function positiveDepthDecimal(value: unknown) {
  if (typeof value !== "string" || value.length > 80 || !DEPTH_DECIMAL_PATTERN.test(value)) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

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
  const now = Date.now();
  const amountNumber = positiveDepthDecimal(quote.pay?.amount);
  const expectedAmount = Number(amount);
  const estimatedOutput = positiveDepthDecimal(quote.receive?.estimatedAmount);
  const minimumOutput = positiveDepthDecimal(quote.receive?.indicativeMinimumAmount);
  const feeBps = quote.route?.feeBps;
  const gasEstimate = quote.route?.gasEstimate;
  const quotedAt = Date.parse(quote.quotedAt ?? "");
  const expiresAt = Date.parse(quote.protection?.dataExpiresAt ?? "");
  const oracleUpdatedAt = quote.reference?.updatedAt;
  const oracleHeartbeat = quote.reference?.heartbeat;
  const oracleUpdatedAtMs = typeof oracleUpdatedAt === "number" ? oracleUpdatedAt * 1_000 : Number.NaN;
  if (
    quote.status !== "indicative-preflight"
    || quote.asset !== asset
    || quote.side !== "buy"
    || quote.pay?.ticker !== "USDG"
    || amountNumber === null
    || Math.abs(amountNumber - expectedAmount) > 0.000001
    || quote.receive?.ticker !== asset
    || estimatedOutput === null
    || minimumOutput === null
    || minimumOutput > estimatedOutput
    || !["Uniswap V3", "Uniswap V4"].includes(quote.route?.protocol ?? "")
    || !Number.isInteger(feeBps)
    || !(typeof feeBps === "number" && feeBps >= 0 && feeBps <= 100_000)
    || !(gasEstimate === null || (typeof gasEstimate === "string" && /^\d{1,30}$/.test(gasEstimate)))
    || quote.protection?.executionBinding !== "none-requote-required"
    || quote.protection.slippageBps !== 50
    || !Number.isFinite(quotedAt)
    || !Number.isFinite(expiresAt)
    || quotedAt < now - DEPTH_MAX_CLOCK_SKEW_MS
    || quotedAt > now + DEPTH_MAX_CLOCK_SKEW_MS
    || expiresAt <= quotedAt
    || expiresAt - quotedAt > DEPTH_MAX_QUOTE_TTL_MS
    || expiresAt <= now
    || expiresAt > now + DEPTH_MAX_CLOCK_SKEW_MS + DEPTH_MAX_QUOTE_TTL_MS
    || quote.reference?.status !== "live"
    || quote.reference.oraclePaused !== false
    || !(Number(quote.reference.price) > 0)
    || !(Number(quote.reference.impliedDexPrice) > 0)
    || !Number.isInteger(quote.reference.deviationBps)
    || quote.reference.deviationBps < 0
    || quote.reference.deviationBps > quote.reference.maxDeviationBps
    || quote.reference.maxDeviationBps !== MAX_ORACLE_DEVIATION_BPS
    || !Number.isInteger(oracleUpdatedAt)
    || !(typeof oracleUpdatedAt === "number" && oracleUpdatedAt > 0)
    || !Number.isInteger(oracleHeartbeat)
    || !(typeof oracleHeartbeat === "number" && oracleHeartbeat > 0 && oracleHeartbeat <= DEPTH_MAX_ORACLE_HEARTBEAT_SECONDS)
    || oracleUpdatedAtMs > quotedAt + DEPTH_ORACLE_TIMESTAMP_TOLERANCE_MS
    || quotedAt - oracleUpdatedAtMs > oracleHeartbeat * 1_000 + DEPTH_ORACLE_TIMESTAMP_TOLERANCE_MS
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
  const [memoryScans, setMemoryScans] = useState<DepthMemoryScan[]>([]);
  const [memoryStorage, setMemoryStorage] = useState<"checking" | "enabled" | "blocked">("checking");
  const scanRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const allowedAssetsRef = useRef(new Set(markets.map((market) => market.ticker)));

  const selectedMarket = markets.find((market) => market.ticker === asset) ?? markets[0];
  const highestPass = useMemo(() => highestFreshDepthMapPass(points, clock), [clock, points]);
  const selectedPoint = points.find((point) => point.amount === selectedAmount) ?? highestPass ?? points[0] ?? null;
  const selectedFresh = selectedPoint?.status === "pass" && isFreshDepthMapQuote(selectedPoint.quote, clock);
  const cooldownMs = depthMapCooldownRemaining(lastScanAt, clock);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const syncMemory = () => {
      try {
        const scans = parseDepthMemory(window.localStorage.getItem(DEPTH_MEMORY_STORAGE_KEY), allowedAssetsRef.current);
        if (!active) return;
        setMemoryScans(scans);
        setMemoryStorage("enabled");
      } catch {
        if (active) setMemoryStorage("blocked");
      }
    };
    const receiveStorageUpdate = (event: StorageEvent) => {
      if (event.key !== DEPTH_MEMORY_STORAGE_KEY && event.key !== null) return;
      try {
        const storage = window.localStorage;
        if (event.storageArea !== storage) return;
        syncMemory();
      } catch {
        if (active) setMemoryStorage("blocked");
      }
    };
    const initialSync = window.setTimeout(syncMemory, 0);
    window.addEventListener("storage", receiveStorageUpdate);
    return () => {
      active = false;
      window.clearTimeout(initialSync);
      window.removeEventListener("storage", receiveStorageUpdate);
    };
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

  async function saveMemoryScan(scan: DepthMemoryScan) {
    const validated = sanitizeDepthMemoryScan(scan, allowedAssetsRef.current);
    if (!validated) return "invalid" as const;
    try {
      return await withDepthMemoryStorageLock(() => {
        const stored = parseDepthMemory(window.localStorage.getItem(DEPTH_MEMORY_STORAGE_KEY), allowedAssetsRef.current);
        const next = appendDepthMemory(stored, validated);
        window.localStorage.setItem(DEPTH_MEMORY_STORAGE_KEY, serializeDepthMemory(next));
        setMemoryScans(next);
        setMemoryStorage("enabled");
        track("depth_memory_saved", { ticker: validated.asset });
        return "saved" as const;
      });
    } catch {
      setMemoryStorage("blocked");
      return "blocked" as const;
    }
  }

  async function clearMemoryForAsset() {
    const targetAsset = asset;
    try {
      await withDepthMemoryStorageLock(() => {
        const stored = parseDepthMemory(window.localStorage.getItem(DEPTH_MEMORY_STORAGE_KEY), allowedAssetsRef.current);
        const next = clearDepthMemoryAsset(stored, targetAsset);
        window.localStorage.setItem(DEPTH_MEMORY_STORAGE_KEY, serializeDepthMemory(next));
        setMemoryScans(next);
        setMemoryStorage("enabled");
        track("depth_memory_cleared", { ticker: targetAsset });
      });
    } catch {
      setMemoryStorage("blocked");
    }
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
      const memoryResult = await saveMemoryScan(createDepthMemoryScan(assetAtStart, startedAt, Date.now(), results));
      setScanError(memoryResult === "invalid"
        ? "The completed scan failed local record verification. No observation was saved."
        : passCount > 0
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
  const scanActionLabel = scanBusy
    ? `Scanning ${points.filter((point) => point.status !== "scanning").length}/5…`
    : selectedMarket?.priceStatus !== "live"
      ? "Oracle check required"
      : cooldownMs > 0
        ? `Fresh scan in ${Math.ceil(cooldownMs / 1_000)}s`
        : memoryScans.some((scan) => scan.asset === asset)
          ? "Run fresh comparison"
          : "Run five-point scan";
  const scanDisabled = scanBusy || cooldownMs > 0 || selectedMarket?.priceStatus !== "live";

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
          <button type="button" onClick={() => void runDepthScan()} disabled={scanDisabled}>{scanActionLabel}</button>
        </header>

        <div className={styles.guardLegend}>
          <span><i /> ORACLE REFERENCE</span>
          <div><b>0 BPS</b><b>{MAX_ORACLE_DEVIATION_BPS} BPS GUARD</b></div>
          <small>Each point is a separate 0.50% slippage preflight. Failed points stay failed; HoodFlow does not interpolate between samples.</small>
        </div>

        <p className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
          {scanBusy ? `DepthMap scan progress: ${points.filter((point) => point.status !== "scanning").length} of 5 samples completed.` : ""}
        </p>
        <div className={styles.ladder} role="group" aria-label={`${asset} five-point liquidity samples`}>
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
              aria-pressed={selectedPoint?.amount === point.amount}
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

    {memoryStorage !== "checking" && <DepthMemoryPanel
      asset={asset}
      scans={memoryScans}
      storageEnabled={memoryStorage !== "blocked"}
      runDisabled={scanDisabled}
      runLabel={scanActionLabel}
      onRunAgain={() => void runDepthScan()}
      onClear={() => void clearMemoryForAsset()}
    />}

    <section className={styles.proofRail}>
      <article><span>01</span><p><strong>Fixed ladder</strong><small>Every market is tested at the same five USDG inputs. Users cannot inflate the scanner workload.</small></p></article>
      <article><span>02</span><p><strong>Fail closed</strong><small>No route, stale oracle, excessive deviation or timeout stays visibly unavailable.</small></p></article>
      <article><span>03</span><p><strong>Fresh handoff</strong><small>DepthMap carries the amount only. HoodFlow requotes and the user keeps the final signature.</small></p></article>
    </section>
  </section>;
}
