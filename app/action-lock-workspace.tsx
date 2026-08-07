"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import type { ActionLockPassport } from "@/lib/action-lock";
import { seoAssets } from "@/lib/seo-assets";

import styles from "./action-lock-workspace.module.css";

type ActionLockResponse = ActionLockPassport & { stateFingerprint: string };

type ApiError = { error?: string };

const MARKETS = seoAssets.filter((market) => market.fullFill);
const MARKET_TICKERS = new Set(MARKETS.map((market) => market.ticker));
const PRICE_FORMAT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

function formatPrice(value: number | string | null | undefined, currency = "USD") {
  if (value === null || value === undefined || value === "") return "Not supplied";
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return "Not supplied";
  if (currency === "USD") return PRICE_FORMAT.format(number);
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(number)} ${currency}`;
}

function formatTime(value: string | number | null | undefined) {
  if (!value) return "Not supplied";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not supplied";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function shortFingerprint(value: string) {
  if (value.length <= 34) return value;
  return `${value.slice(0, 18)}...${value.slice(-12)}`;
}

function decisionCopy(decision: ActionLockResponse["decision"]) {
  if (decision === "clear") return "The live route is inside every ActionLock boundary.";
  if (decision === "watch") return "The route is available, but one or more conditions need attention.";
  return "The handoff is locked because a required market condition did not pass.";
}

export default function ActionLockWorkspace() {
  const [asset, setAsset] = useState(() => {
    if (typeof window === "undefined") return "AAPL";
    const requestedAsset = new URLSearchParams(window.location.search).get("lockAsset")?.trim().toUpperCase();
    return requestedAsset && MARKET_TICKERS.has(requestedAsset) ? requestedAsset : "AAPL";
  });
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("25");
  const [slippageBps, setSlippageBps] = useState(50);
  const [result, setResult] = useState<ActionLockResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [passportStatus, setPassportStatus] = useState("");
  const [watchArmed, setWatchArmed] = useState(false);
  const [watchStatus, setWatchStatus] = useState("");
  const [changeNotice, setChangeNotice] = useState("");
  const [changeReviewed, setChangeReviewed] = useState(true);
  const [clock, setClock] = useState(() => Date.now());
  const activeRequest = useRef<AbortController | null>(null);
  const watchRequest = useRef<AbortController | null>(null);
  const watchedStateFingerprint = useRef("");

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => {
      window.clearInterval(interval);
      activeRequest.current?.abort();
      watchRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    watchedStateFingerprint.current = result?.stateFingerprint || "";
  }, [result]);

  useEffect(() => {
    if (!watchArmed || !watchedStateFingerprint.current) return;
    let stopped = false;
    let timer: number | undefined;

    const schedule = () => {
      if (!stopped) timer = window.setTimeout(checkForChange, 15_000);
    };

    const checkForChange = async () => {
      if (stopped) return;
      if (document.visibilityState !== "visible") {
        schedule();
        return;
      }

      const controller = new AbortController();
      watchRequest.current = controller;
      setWatchStatus("Checking the pinned market state...");
      try {
        const response = await fetch("/api/action-lock", {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ asset, side, amount, slippageBps }),
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json() as ActionLockResponse & ApiError;
        if (!response.ok) throw new Error(payload.error || "Change Watch could not refresh this passport.");
        if (payload.stateFingerprint !== watchedStateFingerprint.current) {
          const prior = watchedStateFingerprint.current;
          watchedStateFingerprint.current = payload.stateFingerprint;
          setResult(payload);
          setClock(Date.now());
          setChangeNotice(`The earlier quote/passport changed (state ${shortFingerprint(prior)}). Review the new decision before continuing.`);
          setChangeReviewed(false);
          setWatchStatus(`Change detected at ${new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date())}.`);
        } else {
          setResult(payload);
          setClock(Date.now());
          setWatchStatus(`Safety state unchanged as of ${new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date())}.`);
        }
      } catch (watchError) {
        if (!(watchError instanceof DOMException && watchError.name === "AbortError")) {
          setWatchStatus("Change Watch could not refresh. It will retry while this tab is visible.");
        }
      } finally {
        if (watchRequest.current === controller) watchRequest.current = null;
        schedule();
      }
    };

    setWatchStatus("Armed. Next comparison in 15 seconds while this tab is visible.");
    schedule();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      watchRequest.current?.abort();
      watchRequest.current = null;
    };
  }, [watchArmed, asset, side, amount, slippageBps]);

  const quoteSeconds = result
    ? Math.max(0, Math.ceil((new Date(result.quote.protection.dataExpiresAt).getTime() - clock) / 1_000))
    : 0;
  const quoteExpired = Boolean(result && quoteSeconds === 0);
  const issuer = result?.issuerState;
  const corporateAction = result?.corporateAction;
  const currency = issuer?.currency || "USD";
  const adjustedBid = issuer?.adjustedBid;
  const adjustedAsk = issuer?.adjustedAsk;
  const passportJson = useMemo(() => result ? JSON.stringify(result, null, 2) : "", [result]);

  function invalidate() {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setBusy(false);
    watchedStateFingerprint.current = "";
    setResult(null);
    setError("");
    setPassportStatus("");
    setWatchArmed(false);
    setWatchStatus("");
    setChangeNotice("");
    setChangeReviewed(true);
  }

  function changeSide(nextSide: "buy" | "sell") {
    setSide(nextSide);
    setAmount(nextSide === "buy" ? "25" : "0.1");
    invalidate();
  }

  async function runActionLock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy(true);
    setError("");
    setResult(null);
    setPassportStatus("");
    setWatchArmed(false);
    setWatchStatus("");
    watchRequest.current?.abort();

    const intent = { asset, side, amount, slippageBps };
    try {
      const response = await fetch("/api/action-lock", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(intent),
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await response.json() as ActionLockResponse & ApiError;
      if (!response.ok) throw new Error(payload.error || "ActionLock could not verify this route.");
      if (
        payload.intent.asset !== intent.asset
        || payload.intent.side !== intent.side
        || payload.intent.amount !== intent.amount
        || payload.intent.slippageBps !== intent.slippageBps
      ) {
        throw new Error("ActionLock returned a passport for a different intent.");
      }
      if (activeRequest.current !== controller) return;
      setResult(payload);
      setClock(Date.now());
      setChangeNotice("");
      setChangeReviewed(true);
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setError(requestError instanceof Error ? requestError.message : "ActionLock could not verify this route.");
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setBusy(false);
      }
    }
  }

  async function copyPassport() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(passportJson);
      setPassportStatus("Passport JSON copied.");
    } catch {
      setPassportStatus("Clipboard access was blocked. Download the passport instead.");
    }
  }

  function downloadPassport() {
    if (!result) return;
    const blob = new Blob([passportJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `hoodflow-actionlock-${result.quote.asset.toLowerCase()}-${result.fingerprint.slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setPassportStatus("Passport JSON downloaded.");
  }

  const handoffUrl = result?.executionHandoff?.marketPath || result?.executionHandoff?.marketUrl || "#";

  return (
    <section className={styles.workspace} aria-labelledby="action-lock-title">
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>ACTIONLOCK / PRE-SIGN MARKET PASSPORT</p>
          <h1 id="action-lock-title">Know what changed<br /><em>before you sign.</em></h1>
        </div>
        <div className={styles.heroNote}>
          <span className={styles.liveDot} aria-hidden="true" />
          <p><strong>No wallet required.</strong> ActionLock compares issuer events, adjusted official prices, oracle state and the live DEX route before handing anything to the trading desk.</p>
        </div>
      </header>

      <div className={styles.frame}>
        <form className={styles.ticket} onSubmit={runActionLock} aria-busy={busy}>
          <div className={styles.ticketHead}>
            <span>01 / INTENT</span>
            <b>Policy before permission</b>
          </div>

          <fieldset className={styles.sideSwitch}>
            <legend>Trade side</legend>
            <button type="button" disabled={busy} aria-pressed={side === "buy"} onClick={() => changeSide("buy")}>Buy with USDG</button>
            <button type="button" disabled={busy} aria-pressed={side === "sell"} onClick={() => changeSide("sell")}>Sell to USDG</button>
          </fieldset>

          <label className={styles.field}>
            <span>Market</span>
            <select disabled={busy} value={asset} onChange={(event) => { setAsset(event.target.value); invalidate(); }}>
              {MARKETS.map((market) => <option key={market.ticker} value={market.ticker}>{market.ticker} / {market.name}</option>)}
            </select>
          </label>

          <label className={styles.field}>
            <span>Exact input</span>
            <div className={styles.amountField}>
              <input
                value={amount}
                onChange={(event) => { setAmount(event.target.value); invalidate(); }}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]+)?"
                aria-describedby="action-lock-amount-unit"
                required
                disabled={busy}
              />
              <b id="action-lock-amount-unit">{side === "buy" ? "USDG" : asset}</b>
            </div>
          </label>

          <label className={styles.field}>
            <span>Maximum slippage</span>
            <select disabled={busy} value={slippageBps} onChange={(event) => { setSlippageBps(Number(event.target.value)); invalidate(); }}>
              <option value={10}>0.10%</option>
              <option value={25}>0.25%</option>
              <option value={50}>0.50%</option>
              <option value={100}>1.00%</option>
              <option value={200}>2.00%</option>
            </select>
          </label>

          <button className={styles.runButton} type="submit" disabled={busy}>
            <span>{busy ? "Reading market state" : "Run ActionLock"}</span>
            <i aria-hidden="true">{busy ? "..." : "02"}</i>
          </button>
          <p className={styles.formFoot}>Read-only preflight. No approval, signature or transaction is requested.</p>
        </form>

        <div className={styles.output}>
          {!result && !busy && !error ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyMark} aria-hidden="true"><i /><i /><i /></span>
              <p>One intent. One readable decision line.</p>
              <h2>ActionLock waits here.</h2>
              <small>Run a preflight to compare issuer state with the route your wallet would receive.</small>
            </div>
          ) : null}

          {busy ? (
            <div className={styles.loadingState} role="status" aria-live="polite">
              <span aria-hidden="true" />
              <p>Pinning issuer, oracle and DEX observations to one moment.</p>
              <strong>Building market passport</strong>
            </div>
          ) : null}

          {error ? (
            <div className={styles.errorState} role="alert">
              <p>ActionLock stopped before handoff</p>
              <strong>{error}</strong>
              <small>No transaction was prepared and no wallet action is required.</small>
            </div>
          ) : null}

          {result ? (
            <article className={styles.result} data-decision={result.decision} data-changed={!changeReviewed}>
              {changeNotice ? (
                <div className={styles.changeAlert} role="alert">
                  <div>
                    <strong>The earlier quote/passport changed.</strong>
                    <p>{changeNotice}</p>
                  </div>
                  <button type="button" onClick={() => setChangeReviewed(true)}>Use current passport</button>
                </div>
              ) : null}
              <header className={styles.decisionHead}>
                <div>
                  <p>02 / DECISION</p>
                  <h2>{result.decision.toUpperCase()}</h2>
                  <span>{decisionCopy(result.decision)}</span>
                </div>
                <div className={styles.expiry} data-expired={quoteExpired}>
                  <small>{quoteExpired ? "Passport expired" : "Quote expires"}</small>
                  <strong>{quoteExpired ? "Re-run required" : `${quoteSeconds}s`}</strong>
                  <span>Observed {formatTime(result.observedAt)}</span>
                </div>
              </header>

              <section className={styles.routeSection} aria-labelledby="action-lock-route-title">
                <div className={styles.sectionLabel}>
                  <span id="action-lock-route-title">THE EXECUTION LINE</span>
                  <b>{result.checks.filter((check) => check.status === "pass").length}/{result.checks.length} checks passed</b>
                </div>
                <ol className={styles.executionLine}>
                  {result.checks.map((check, index) => (
                    <li key={`${check.code}-${index}`} data-status={check.status}>
                      <span className={styles.checkIndex}>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <b>{check.label}</b>
                        <p>{check.detail}</p>
                      </div>
                      <em>{check.status}</em>
                    </li>
                  ))}
                </ol>
              </section>

              <section className={styles.marketTape} aria-label="Price comparison">
                <div className={styles.tapeTitle}>
                  <span>03 / PRICE TAPE</span>
                  <p>{issuer?.issuerName || issuer?.symbol || asset} <b>{issuer?.marketStatus || "UNKNOWN"}</b></p>
                </div>
                <dl className={styles.priceLine}>
                  <div><dt>Official bid</dt><dd>{formatPrice(issuer?.officialBid, currency)}</dd></div>
                  <div><dt>Adjusted bid</dt><dd>{formatPrice(adjustedBid, currency)}</dd></div>
                  <div><dt>DEX implied</dt><dd>{formatPrice(result.quote.reference.impliedDexPrice)}</dd></div>
                  <div><dt>Oracle</dt><dd>{formatPrice(result.quote.reference.price)}</dd></div>
                  <div><dt>Adjusted ask</dt><dd>{formatPrice(adjustedAsk, currency)}</dd></div>
                  <div><dt>Official ask</dt><dd>{formatPrice(issuer?.officialAsk, currency)}</dd></div>
                </dl>
                <footer>
                  <span>Source: {issuer?.source || "Issuer state provider"}</span>
                  <span>As of {formatTime(issuer?.asOf || result.observedAt)}</span>
                  <span>DEX deviation {result.quote.reference.deviationBps} bps</span>
                </footer>
              </section>

              <section className={styles.actionStrip} aria-labelledby="corporate-action-title">
                <div>
                  <span id="corporate-action-title">04 / ISSUER EVENT</span>
                  <h3>{corporateAction?.label || "No active adjustment"}</h3>
                </div>
                <p>{corporateAction?.detail || "No corporate action affecting this preflight was supplied."}</p>
                <dl>
                  <div><dt>Type</dt><dd>{corporateAction?.type || "None"}</dd></div>
                  <div><dt>Status</dt><dd>{corporateAction?.status || "UNKNOWN"}</dd></div>
                  <div><dt>Effective</dt><dd>{formatTime(corporateAction?.effectiveAt)}</dd></div>
                  <div><dt>Adjustment</dt><dd>{corporateAction?.adjustment ?? "None"}</dd></div>
                </dl>
              </section>

              <section className={styles.passport} aria-labelledby="passport-title">
                <div className={styles.passportCopy}>
                  <span id="passport-title">ACTIONLOCK PASSPORT</span>
                  <code title={result.fingerprint}>{shortFingerprint(result.fingerprint)}</code>
                  <p>{result.passportVersion} / Policy {result.policy.version} / State {shortFingerprint(result.stateFingerprint)}</p>
                </div>
                <div className={styles.passportActions}>
                  <button type="button" onClick={() => void copyPassport()}>Copy JSON</button>
                  <button type="button" onClick={downloadPassport}>Download</button>
                </div>
                <div className={styles.changeWatch}>
                  <button
                    type="button"
                    aria-pressed={watchArmed}
                    onClick={() => {
                      setWatchArmed((current) => !current);
                      setWatchStatus(watchArmed ? "Change Watch disarmed." : "Arming Change Watch...");
                    }}
                  >
                    <i aria-hidden="true" />
                    <span>{watchArmed ? "Change Watch armed" : "Arm change watch"}</span>
                  </button>
                  <p>Opt-in comparison every 15 seconds, only while this tab is visible.</p>
                </div>
                <p className={styles.passportStatus} role="status" aria-live="polite">{passportStatus}</p>
                <p className={styles.watchStatus} role="status" aria-live="polite">{watchStatus}</p>
              </section>

              {result.handoffAllowed && result.executionHandoff ? (
                <footer className={styles.handoff}>
                  <div>
                    <span>{quoteExpired ? "A fresh quote will be required" : `${result.quote.receive.indicativeMinimumAmount} ${result.quote.receive.ticker} protected minimum`}</span>
                    <p>The live desk rechecks every value before the wallet is asked to sign.</p>
                  </div>
                  {changeReviewed
                    ? <a href={handoffUrl}>Continue to live quote</a>
                    : <button type="button" className={styles.reviewButton} onClick={() => setChangeReviewed(true)}>Review changed passport</button>}
                </footer>
              ) : (
                <footer className={styles.blockedFoot}>
                  <strong>Handoff unavailable</strong>
                  <span>Resolve the blocking market condition, then run ActionLock again.</span>
                </footer>
              )}
            </article>
          ) : null}
        </div>
      </div>
    </section>
  );
}
