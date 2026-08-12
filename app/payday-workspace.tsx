"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { seoAssets } from "@/lib/seo-assets";

import styles from "./payday-workspace.module.css";

type Instruction = "compound" | "cash" | "redirect";
type EligibilityState = "eligible" | "pending" | "blocked" | "unavailable";
type EvidenceState = "pass" | "pending" | "block";

type EvidenceItem = {
  id: string;
  label: string;
  status: EvidenceState;
  value: string;
  source?: string;
};

type PaydaySnapshot = {
  ticker: string;
  name: string;
  uid: string | null;
  action: {
    uid: string | null;
    type: string;
    status: string | null;
    processDate: string | null;
    sourceUpdatedAt: string | null;
    amountPerUnit: string | null;
    currency: string | null;
  } | null;
  eligibility: {
    state: EligibilityState;
    reason: string;
  };
  currentMultiplier: string | null;
  pendingMultiplier: string | null;
  pendingMultiplierEffectiveAt: string | null;
  preview: {
    oldMultiplier: string;
    newMultiplier: string;
    rawBalance: string;
    principalPreservingRawBalance: string;
    harvestRawAmount: string;
    estimatedUsdg: string | null;
    formula: string;
    rounding: string;
  } | null;
  evidence: EvidenceItem[];
  integrity: {
    checksum: string;
    notice: string;
  } | null;
  generatedAt: string | null;
};

const MARKETS = seoAssets;
const MARKET_TICKERS = new Set(MARKETS.map((market) => market.ticker));
const REFRESH_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 12_000;
const QUALIFYING_ACTION_TYPE = "CORPORATE_ACTION_TYPE_CASH_DIVIDEND";

const INSTRUCTIONS: Array<{
  id: Instruction;
  number: string;
  title: string;
  description: string;
}> = [
  {
    id: "compound",
    number: "01",
    title: "Compound",
    description: "Keep the full Stock Token position if an aligned multiplier transition becomes eligible.",
  },
  {
    id: "cash",
    number: "02",
    title: "Cash to USDG",
    description: "Preview the raw increment from an eligible multiplier transition before any separate execution.",
  },
  {
    id: "redirect",
    number: "03",
    title: "Redirect",
    description: "Preview the same eligible increment as a possible future handoff to another market.",
  },
];

const ELIGIBILITY_COPY: Record<EligibilityState, { label: string; eyebrow: string }> = {
  eligible: { label: "Math preview available", eyebrow: "ELIGIBLE FOR PREVIEW" },
  pending: { label: "Verification open", eyebrow: "EVIDENCE INCOMPLETE" },
  blocked: { label: "No verified preview", eyebrow: "PREVIEW HELD" },
  unavailable: { label: "Source unavailable", eyebrow: "FAIL CLOSED" },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized && normalized.length <= 240) return normalized;
  }
  return null;
}

function decimalString(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length <= 160 && /^\d+(?:\.\d+)?$/.test(normalized) ? normalized : null;
}

function dateString(value: unknown) {
  const candidate = firstString(value);
  if (!candidate || !Number.isFinite(Date.parse(candidate))) return null;
  return candidate;
}

function eligibilityState(value: unknown): EligibilityState {
  if (value === "eligible" || value === "pending" || value === "blocked" || value === "unavailable") return value;
  return "unavailable";
}

function evidenceState(value: unknown): EvidenceState {
  if (value === "pass" || value === "pending" || value === "block") return value;
  return "pending";
}

function parseEvidence(value: unknown): EvidenceItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index): EvidenceItem[] => {
    const item = asRecord(entry);
    if (!item) return [];
    const label = firstString(item.label);
    if (!label) return [];
    return [{
      id: firstString(item.id) ?? `evidence-${index + 1}`,
      label,
      status: evidenceState(item.status),
      value: firstString(item.detail) ?? "Awaiting source evidence",
      ...(firstString(item.source) ? { source: firstString(item.source) ?? undefined } : {}),
    }];
  }).slice(0, 8);
}

function parseSnapshot(value: unknown, requestedTicker: string): PaydaySnapshot {
  const outer = asRecord(value);
  if (!outer || outer.ok !== true) throw new Error("Payday returned an unreadable response.");
  const payload = asRecord(outer.data);
  if (!payload) throw new Error("Payday returned an unreadable response.");

  const asset = asRecord(payload.asset);
  const action = asRecord(payload.corporateAction);
  const eligibility = asRecord(payload.eligibility);
  const previewRecord = asRecord(payload.preview);
  const integrity = asRecord(payload.integrity);
  if (!asset || !eligibility) throw new Error("Payday omitted required safety fields.");
  const returnedTicker = (firstString(asset.ticker) ?? "").toUpperCase();

  if (!MARKET_TICKERS.has(returnedTicker) || returnedTicker !== requestedTicker) {
    throw new Error("Payday returned evidence for a different asset.");
  }

  const market = MARKETS.find((item) => item.ticker === returnedTicker);
  const state = eligibilityState(eligibility.state);
  const preview = previewRecord ? {
    oldMultiplier: decimalString(previewRecord.oldMultiplier),
    newMultiplier: decimalString(previewRecord.newMultiplier),
    rawBalance: decimalString(previewRecord.rawBalance),
    principalPreservingRawBalance: decimalString(previewRecord.principalPreservingRawBalance),
    harvestRawAmount: decimalString(previewRecord.harvestRawAmount),
    estimatedUsdg: previewRecord.estimatedUsdg === null ? null : decimalString(previewRecord.estimatedUsdg),
    formula: firstString(previewRecord.formula),
    rounding: firstString(previewRecord.rounding),
  } : null;
  const validPreview = preview
    && preview.oldMultiplier
    && preview.newMultiplier
    && preview.rawBalance
    && preview.principalPreservingRawBalance
    && preview.harvestRawAmount
    && preview.formula
    && preview.rounding
    ? preview as PaydaySnapshot["preview"]
    : null;
  const actionType = action ? firstString(action.type) : null;
  if (state === "eligible" && (actionType !== QUALIFYING_ACTION_TYPE || !validPreview)) {
    throw new Error("The eligible response failed local corporate-action safety checks.");
  }
  return {
    ticker: returnedTicker,
    name: firstString(asset.name) ?? market?.name ?? returnedTicker,
    uid: firstString(asset.uid),
    action: action ? {
      uid: firstString(action.uid),
      type: actionType ?? "UNCLASSIFIED",
      status: firstString(action.status),
      processDate: dateString(action.processDate),
      sourceUpdatedAt: dateString(action.sourceUpdatedAt),
      amountPerUnit: decimalString(action.amountPerUnit),
      currency: firstString(action.currency),
    } : null,
    eligibility: {
      state,
      reason: firstString(eligibility.reason) ?? "The API did not return a bounded eligibility reason.",
    },
    currentMultiplier: decimalString(asset.currentMultiplier),
    pendingMultiplier: decimalString(asset.pendingMultiplier),
    pendingMultiplierEffectiveAt: dateString(asset.pendingMultiplierEffectiveTime),
    preview: state === "eligible" ? validPreview : null,
    evidence: parseEvidence(payload.evidence),
    integrity: integrity && /^sha256:[a-f0-9]{64}$/.test(firstString(integrity.checksum) ?? "")
      ? {
          checksum: firstString(integrity.checksum)!,
          notice: firstString(integrity.notice) ?? "Response checksum only; not a signature or attestation.",
        }
      : null,
    generatedAt: dateString(payload.generatedAt),
  };
}

function formatDate(value: string | null) {
  if (!value) return "Not returned";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not returned";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatActionLabel(value: string | null | undefined) {
  if (!value) return "None returned";
  return value.replace(/^CORPORATE_ACTION_TYPE_/, "").replaceAll("_", " ");
}

function formatProcessDate(value: string | null) {
  if (!value) return "Not returned";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not returned";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatDecimal(value: string | null, maximumFractionDigits = 12) {
  if (!value) return "—";
  const [integerPart, fractionalPart = ""] = value.split(".");
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = fractionalPart.slice(0, maximumFractionDigits).replace(/0+$/, "");
  if (!fraction && integerPart === "0" && /[1-9]/.test(fractionalPart)) {
    const visibleDigits = Math.max(1, maximumFractionDigits);
    return `<0.${"0".repeat(visibleDigits - 1)}1`;
  }
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function formatEventStatus(value: string | null | undefined) {
  if (!value) return "Not returned";
  return value.replace(/^CORPORATE_ACTION_STATUS_/, "").replaceAll("_", " ");
}

function formatReportedRate(action: PaydaySnapshot["action"]) {
  if (!action?.amountPerUnit) return "Not returned";
  return `${formatDecimal(action.amountPerUnit, 12)}${action.currency ? ` ${action.currency}` : ""} / unit`;
}

function formatToken(value: string | null, ticker: string) {
  return value ? `${formatDecimal(value, 12)} ${ticker}` : "—";
}

function shortValue(value: string) {
  return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}

export default function PaydayWorkspace() {
  const [asset, setAsset] = useState("SPY");
  const [instruction, setInstruction] = useState<Instruction>("compound");
  const [redirectAsset, setRedirectAsset] = useState("SGOV");
  const [snapshot, setSnapshot] = useState<PaydaySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshCounter, setRefreshCounter] = useState(0);
  const requestRef = useRef<AbortController | null>(null);

  const selectedMarket = MARKETS.find((market) => market.ticker === asset) ?? MARKETS[0];
  const destinationMarket = MARKETS.find((market) => market.ticker === redirectAsset);

  const refresh = useCallback(() => {
    setSnapshot(null);
    setLoading(true);
    setError("");
    setRefreshCounter((value) => value + 1);
  }, []);

  function changeAsset(nextAsset: string) {
    if (!MARKET_TICKERS.has(nextAsset) || nextAsset === asset) return;
    setSnapshot(null);
    setLoading(true);
    setError("");
    setAsset(nextAsset);
  }

  useEffect(() => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    void fetch(`/api/payday?asset=${encodeURIComponent(asset)}`, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        // A bounded message below is safer than exposing a parsing exception.
      }
      if (!response.ok) {
        const body = asRecord(payload);
        throw new Error(firstString(body?.error, body?.message) ?? "Live corporate-action evidence is unavailable.");
      }
      setSnapshot(parseSnapshot(payload, asset));
    }).catch((requestError: unknown) => {
      if (requestError instanceof DOMException && requestError.name === "AbortError") {
        if (timedOut) {
          setSnapshot(null);
          setError("The evidence request timed out. No eligibility conclusion was promoted.");
        }
        return;
      }
      setSnapshot(null);
      setError(requestError instanceof Error ? requestError.message : "Live corporate-action evidence is unavailable.");
    }).finally(() => {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    });

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [asset, refreshCounter]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !requestRef.current) refresh();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // A prior result is never presented as current while a new evidence request is open.
  const liveSnapshot = loading ? null : snapshot;
  const evidence = liveSnapshot?.evidence ?? [];
  const verifiedCount = evidence.filter((item) => item.status === "pass").length;
  const status = liveSnapshot?.eligibility.state ?? (error ? "unavailable" : "pending");
  const statusCopy = ELIGIBILITY_COPY[status];
  const activePreview = status === "eligible"
    && liveSnapshot?.action?.type === QUALIFYING_ACTION_TYPE
    ? liveSnapshot.preview
    : null;
  const radarMode = !loading && !error && Boolean(liveSnapshot) && !activePreview;
  const visibleEvidence: EvidenceItem[] = evidence.length ? evidence : Array.from({ length: 4 }, (_, index) => ({
    id: `pending-${index}`,
    label: ["Canonical asset identity", "Corporate-action class", "ERC-8056 multiplier change", "Effective-time alignment"][index],
    status: "pending" as const,
    value: loading ? "Checking source evidence" : "No evidence returned",
  }));

  return (
    <section className={styles.workspace} aria-labelledby="payday-title">
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>FLOWRIGHTS / PAYDAY PREVIEW</p>
          <p className={styles.previewBoundary}>EVIDENCE PREVIEW · NOT A PAYOUT</p>
          <h1 id="payday-title">Read the event. <em>Preview only the aligned multiplier transition.</em></h1>
        </div>
        <aside className={styles.heroNote} aria-label="Release boundary">
          <i aria-hidden="true" />
          <p><strong>Read-only release.</strong> HoodFlow classifies evidence and previews the math. It cannot approve, vault, swap or sign.</p>
        </aside>
      </header>

      <div className={styles.frame}>
        <aside className={styles.controls}>
          <div className={styles.controlHead}>
            <span>CORPORATE ACTION RADAR</span>
            <b>PREVIEW 01</b>
          </div>

          <label className={styles.assetField}>
            <span>Stock Token</span>
            <div>
              <Image src={`/logos/${selectedMarket.ticker}.png`} alt="" width={42} height={42} />
              <select value={asset} onChange={(event) => changeAsset(event.target.value)} aria-label="Choose Stock Token">
                {MARKETS.map((market) => (
                  <option key={market.ticker} value={market.ticker}>{market.ticker} · {market.name}</option>
                ))}
              </select>
            </div>
          </label>

          {activePreview ? (
            <fieldset className={styles.instructionList}>
              <legend>FUTURE HANDLING CONCEPT · NON-OPERATIONAL</legend>
              {INSTRUCTIONS.map((item) => (
                <label key={item.id} className={styles.instruction} data-selected={instruction === item.id}>
                  <input
                    type="radio"
                    name="payday-instruction"
                    value={item.id}
                    checked={instruction === item.id}
                    onChange={() => setInstruction(item.id)}
                  />
                  <span>{item.number}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </div>
                  <i aria-hidden="true" />
                </label>
              ))}
            </fieldset>
          ) : (
            <div className={styles.instructionLocked}>
              <span>FUTURE HANDLING CONCEPT · NON-OPERATIONAL</span>
              <strong>Compound · Cash to USDG · Redirect</strong>
              <p>Collapsed until a live multiplier transition is eligible for math preview. No option can execute, approve or prepare a transaction.</p>
            </div>
          )}

          {activePreview && instruction === "redirect" ? (
            <label className={styles.redirectField}>
              <span>Future destination</span>
              <select value={redirectAsset} onChange={(event) => setRedirectAsset(event.target.value)}>
                {MARKETS.filter((market) => market.ticker !== asset).map((market) => (
                  <option key={market.ticker} value={market.ticker}>{market.ticker} · {market.name}</option>
                ))}
              </select>
              <small>No transfer or order is prepared in this release.</small>
            </label>
          ) : null}

          <div className={styles.boundary}>
            <span aria-hidden="true">!</span>
            <p>Stock Tokens are not shares. This preview does not establish shareholder rights, dividend entitlement or any distribution owed to the holder.</p>
          </div>
        </aside>

        <div className={styles.output}>
          <section className={styles.eligibility} data-status={status} data-radar={radarMode} aria-live="polite" aria-busy={loading}>
            <div className={styles.statusCopy}>
              <p>{loading ? "CHECKING LIVE SOURCES" : radarMode ? "CORPORATE ACTION RADAR" : statusCopy.eyebrow}</p>
              <h2>{loading
                ? "Verifying the event"
                : radarMode
                  ? "No live multiplier transition is currently eligible."
                  : statusCopy.label}</h2>
              <span>{loading
                ? "Comparing fresh corporate-action, canonical-asset and multiplier evidence. The prior result is not treated as current."
                : error
                  ? error
                  : liveSnapshot?.eligibility.reason ?? "No verified conclusion is available."}</span>
            </div>
            <dl className={styles.eventFacts}>
              <div>
                <dt>ASSET UID</dt>
                <dd>{liveSnapshot?.uid ? shortValue(liveSnapshot.uid) : "Not verified"}</dd>
              </div>
              <div>
                <dt>EVENT</dt>
                <dd>{formatActionLabel(liveSnapshot?.action?.type)}</dd>
              </div>
              <div>
                <dt>PROCESS DATE</dt>
                <dd>{formatProcessDate(liveSnapshot?.action?.processDate ?? null)}</dd>
              </div>
              <div>
                <dt>EVENT STATUS</dt>
                <dd>{formatEventStatus(liveSnapshot?.action?.status)}</dd>
              </div>
              <div>
                <dt>REPORTED RATE</dt>
                <dd>{formatReportedRate(liveSnapshot?.action ?? null)}</dd>
              </div>
              <div>
                <dt>OBSERVED</dt>
                <dd>{formatDate(liveSnapshot?.generatedAt ?? null)}</dd>
              </div>
            </dl>
            <button type="button" className={styles.refreshButton} onClick={refresh} disabled={loading}>
              <span>{loading ? "Refreshing" : "Refresh evidence"}</span>
              <b aria-hidden="true">↻</b>
            </button>
          </section>

          <div className={styles.analysisGrid}>
            <section className={styles.evidenceSection} aria-labelledby="payday-evidence-title">
              <header>
                <div>
                  <p>VERIFICATION TRAIL</p>
                  <h2 id="payday-evidence-title">Evidence before economics.</h2>
                </div>
                <span>{verifiedCount}/{evidence.length || 4} VERIFIED</span>
              </header>
              <ol className={styles.evidenceList}>
                {visibleEvidence.map((item, index) => (
                  <li key={item.id} data-status={item.status}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{item.label}</strong>
                      <p>{item.value}</p>
                      {item.source ? <small>{item.source}</small> : null}
                    </div>
                    <b>{item.status}</b>
                  </li>
                ))}
              </ol>
            </section>

            <section className={styles.mathSection} data-active={Boolean(activePreview)} aria-labelledby="payday-math-title">
              <header>
                <p>{activePreview ? "PRINCIPAL-PRESERVING MATH" : "CORPORATE ACTION RADAR"}</p>
                <h2 id="payday-math-title">{activePreview ? "Model only the increment." : "Watch evidence, not promises."}</h2>
              </header>

              {activePreview ? (
                <>
                  <div className={styles.balanceField}>
                    <span>Pre-event economic units</span>
                    <div>
                      <strong>{formatDecimal(activePreview.rawBalance, 12)}</strong>
                      <b>{asset}</b>
                    </div>
                    <small>Bounded API illustration. No wallet balance is read.</small>
                  </div>

                  <dl className={styles.multiplierRail}>
                    <div>
                      <dt>BEFORE</dt>
                      <dd>{formatDecimal(activePreview.oldMultiplier)}</dd>
                    </div>
                    <i aria-hidden="true">→</i>
                    <div>
                      <dt>AFTER</dt>
                      <dd>{formatDecimal(activePreview.newMultiplier)}</dd>
                    </div>
                    <div className={styles.delta}>
                      <dt>CLASS</dt>
                      <dd>CASH DIVIDEND</dd>
                    </div>
                  </dl>

                  <div className={styles.formula}>
                    <span>MODELED RAW INCREMENT</span>
                    <code>{activePreview.formula}</code>
                  </div>

                  <dl className={styles.previewResult}>
                    <div>
                      <dt>Principal raw remaining</dt>
                      <dd>{formatToken(activePreview.principalPreservingRawBalance, asset)}</dd>
                    </div>
                    <div>
                      <dt>{instruction === "compound" ? "Modeled increment kept attached" : instruction === "cash" ? "Modeled increment for USDG handoff" : `Modeled increment for ${destinationMarket?.ticker ?? redirectAsset} handoff`}</dt>
                      <dd>{formatToken(activePreview.harvestRawAmount, asset)}</dd>
                    </div>
                  </dl>

                  <footer className={styles.mathFoot}>
                    <i aria-hidden="true" />
                    <p>{activePreview.rounding} This is server-returned arithmetic, not a quote. The cash-dividend record and multiplier transition are verified as concurrent evidence; causality is not asserted. Fees, liquidity and execution are not included.</p>
                  </footer>
                </>
              ) : (
                <div className={styles.radarPanel} aria-live="polite">
                  <div className={styles.radarSignal} aria-hidden="true"><i /><i /><i /></div>
                  <div className={styles.radarCopy}>
                    <span>NO ELIGIBLE TRANSITION</span>
                    <h3>No separation math is promoted.</h3>
                    <p>{loading
                      ? "Fresh official and onchain evidence is being checked. Any prior snapshot is hidden until the refresh finishes."
                      : error
                        ? "Evidence is unavailable, so the preview fails closed."
                        : liveSnapshot?.action
                          ? "A corporate-action record is available as reference evidence, but no current multiplier transition passed every eligibility gate."
                          : "No qualifying cash-dividend record and positive multiplier transition currently pass every eligibility gate."}</p>
                  </div>

                  <dl className={styles.radarFacts}>
                    <div>
                      <dt>CURRENT MULTIPLIER</dt>
                      <dd>{formatDecimal(liveSnapshot?.currentMultiplier ?? null)}</dd>
                    </div>
                    <div>
                      <dt>PENDING MULTIPLIER</dt>
                      <dd>{formatDecimal(liveSnapshot?.pendingMultiplier ?? null)}</dd>
                    </div>
                    <div>
                      <dt>PENDING EFFECTIVE</dt>
                      <dd>{formatDate(liveSnapshot?.pendingMultiplierEffectiveAt ?? null)}</dd>
                    </div>
                    <div>
                      <dt>REFERENCE CLASS</dt>
                      <dd>{formatActionLabel(liveSnapshot?.action?.type)}</dd>
                    </div>
                  </dl>

                  <ol className={styles.radarGate}>
                    <li><span>01</span><p>Canonical asset UID and chain 4663 deployment must align.</p></li>
                    <li><span>02</span><p>An exact CASH_DIVIDEND record must be verifiable as concurrent evidence.</p></li>
                    <li><span>03</span><p>A positive current-to-pending multiplier transition and effective time must align.</p></li>
                  </ol>

                  <footer className={styles.radarFoot}>
                    <i aria-hidden="true" />
                    <p>Reference evidence is not a claim, payout, shareholder right or dividend entitlement. HoodFlow shows no arithmetic until every live gate passes.</p>
                  </footer>
                </div>
              )}
            </section>
          </div>

          <footer className={styles.releaseBoundary}>
            <div>
              <span>RELEASE BOUNDARY</span>
              <strong>Preview only · no vault · no claim token · no wallet permission</strong>
            </div>
            <div className={styles.integrityNote}>
              <span>RESPONSE CHECKSUM · NON-AUTHENTICATING</span>
              <code title={liveSnapshot?.integrity?.notice}>{liveSnapshot?.integrity?.checksum ? shortValue(liveSnapshot.integrity.checksum) : "Unavailable"}</code>
            </div>
            <p>Any future handling or transferable claim would require audited contracts, explicit user consent and a separate mainnet release.</p>
          </footer>
        </div>
      </div>
    </section>
  );
}
