"use client";

import { useEffect, useMemo, useState } from "react";

import {
  compareDepthMemory,
  highestHistoricalPass,
  serializeDepthMemory,
  type DepthMemoryComparisonPoint,
  type DepthMemoryPoint,
  type DepthMemoryScan,
} from "@/lib/depth-memory";

import styles from "./depth-memory-panel.module.css";

type Props = {
  asset: string;
  scans: DepthMemoryScan[];
  storageEnabled: boolean;
  runDisabled: boolean;
  runLabel: string;
  onRunAgain: () => void;
  onClear: () => void;
};

function timeLabel(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function pointStatus(point: DepthMemoryPoint) {
  if (point.status === "passed-then") return "PASSED THEN";
  if (point.status === "rate-limited") return "SCAN LIMITED";
  return "NO SIGNAL";
}

function signed(value: number, suffix: string) {
  if (value === 0) return `No change ${suffix}`;
  return `${value > 0 ? "+" : ""}${value.toLocaleString("en-US")} ${suffix}`;
}

function comparisonCopy(point: DepthMemoryComparisonPoint) {
  const baselinePassed = point.previous.status === "passed-then";
  const latestPassed = point.current.status === "passed-then";
  if (point.transition === "appeared") return ["Sampled pass appeared", "The latest saved scan observed a pass that the baseline did not. Memory never enables an order."];
  if (point.transition === "unresolved" && baselinePassed && !latestPassed) return ["Pass not re-observed", "The latest saved scan returned no comparable pass at this input. This does not prove that liquidity disappeared."];
  if (point.transition === "unresolved") return ["No comparable pass", "Neither saved scan produced a passed sample at this exact input."];
  const outputDelta = point.outputDeltaBps === null ? "Output change unavailable" : signed(point.outputDeltaBps / 100, "% output");
  const deviationDelta = point.deviationDeltaBps === null ? "Distance change unavailable" : signed(point.deviationDeltaBps, "bps from oracle");
  return [deviationDelta, `${outputDelta}${point.protocolChanged ? " · venue changed" : ""}`];
}

function downloadHistory(asset: string, scans: DepthMemoryScan[]) {
  const blob = new Blob([`${serializeDepthMemory(scans)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `hoodflow-depth-memory-${asset.toLowerCase()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function DepthMemoryPanel({
  asset,
  scans,
  storageEnabled,
  runDisabled,
  runLabel,
  onRunAgain,
  onClear,
}: Props) {
  const sorted = useMemo(
    () => [...scans].filter((scan) => scan.asset === asset).sort((left, right) => right.completedAt - left.completedAt),
    [asset, scans],
  );
  const latest = sorted[0] ?? null;
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [clearArmedAsset, setClearArmedAsset] = useState<string | null>(null);
  const clearArmed = clearArmedAsset === asset;

  useEffect(() => {
    if (!clearArmedAsset) return;
    const timeout = window.setTimeout(
      () => setClearArmedAsset(null),
      clearArmedAsset === asset ? 6_000 : 0,
    );
    return () => window.clearTimeout(timeout);
  }, [asset, clearArmedAsset]);

  const baseline = sorted.find((scan) => scan.id === baselineId && scan.id !== latest?.id) ?? sorted[1] ?? null;
  const comparison = latest && baseline ? compareDepthMemory(latest, baseline) : null;
  const latestHighest = latest ? highestHistoricalPass(latest) : null;
  const latestPassCount = latest?.points.filter((point) => point.status === "passed-then").length ?? 0;

  return <section className={styles.memory} aria-labelledby="depth-memory-title">
    <header className={styles.head}>
      <div>
        <p><i /> DEPTH MEMORY / DEVICE-LOCAL OBSERVATIONS</p>
        <h2 id="depth-memory-title">See what changed.<br /><span>Then scan again.</span></h2>
      </div>
      <div className={styles.headMeta}>
        <span>SAVED SCANS</span>
        <strong>{sorted.length}</strong>
        <small>Up to 5 per market · this browser only. No wallet, transaction or signature data is stored.</small>
      </div>
    </header>

    {!storageEnabled && <div className={styles.storageNotice} role="status">
      <i /> Depth Memory is unavailable because this browser blocked local storage. Live DepthMap scans still work normally.
    </div>}

    {storageEnabled && !latest && <div className={styles.empty}>
      <div className={styles.emptySignal} aria-hidden="true">
        {["10", "25", "100", "250", "1K"].map((amount, index) => <span key={amount}><i />{amount}<b>{String(index + 1).padStart(2, "0")}</b></span>)}
      </div>
      <div>
        <span>NO OBSERVATIONS SAVED</span>
        <h3>Your first complete scan starts the memory.</h3>
        <p>Come back and run the same fixed ladder again. HoodFlow compares only the exact inputs it actually observed—nothing is backfilled or interpolated.</p>
        <button type="button" onClick={onRunAgain} disabled={runDisabled}>{runLabel}</button>
      </div>
    </div>}

    {storageEnabled && latest && <>
      <div className={styles.summary}>
        <article>
          <span>LATEST SAVED SCAN</span>
          <strong>{latestPassCount} / 5</strong>
          <small>sampled passes · historical only</small>
        </article>
        <article>
          <span>HIGHEST SAMPLED PASS</span>
          <strong>{latestHighest ? `${Number(latestHighest.amount).toLocaleString("en-US")} USDG` : "—"}</strong>
          <small>{latestHighest ? `previously observed ${timeLabel(latest.completedAt)}` : "No passed sample in latest scan"}</small>
        </article>
        <article>
          <span>VERSUS SELECTED BASELINE</span>
          <strong>{comparison ? `${comparison.appearedCount} appeared` : "One more scan"}</strong>
          <small>{comparison ? `${comparison.notReobservedCount} baseline passes not re-observed · ${comparison.comparableCount} exact inputs comparable` : "Run later to unlock a real comparison"}</small>
        </article>
        <button type="button" onClick={onRunAgain} disabled={runDisabled}>{runLabel}<span>→</span></button>
      </div>

      <div className={styles.timeline}>
        <div className={styles.timelineHead}>
          <span>OBSERVATION TAPE</span>
          <small>Discrete scans, not continuous market data</small>
        </div>
        <div className={styles.timelineList} role="group" aria-label={`${asset} saved DepthMap observations`}>
          {sorted.map((scan, index) => {
            const passCount = scan.points.filter((point) => point.status === "passed-then").length;
            const highest = highestHistoricalPass(scan);
            const selected = scan.id === baseline?.id;
            return <button
              type="button"
              aria-pressed={selected}
              className={`${styles.timelineItem} ${selected ? styles.timelineSelected : ""} ${index === 0 ? styles.timelineLatest : ""}`}
              key={scan.id}
              disabled={index === 0}
              onClick={() => setBaselineId(scan.id)}
            >
              <span>{index === 0 ? "LATEST SAVED" : selected ? "BASELINE" : `-${index}`}</span>
              <time dateTime={new Date(scan.completedAt).toISOString()}>{timeLabel(scan.completedAt)}</time>
              <strong>{passCount}/5 passed then</strong>
              <small>{highest ? `up to sampled ${Number(highest.amount).toLocaleString("en-US")} USDG` : "no sampled pass"}</small>
            </button>;
          })}
        </div>
      </div>

      {comparison && baseline && <div className={styles.compare}>
        <header>
          <div><span>BASELINE</span><time dateTime={new Date(baseline.completedAt).toISOString()}>{timeLabel(baseline.completedAt)}</time></div>
          <strong>EXACT-INPUT CHANGE</strong>
          <div><span>LATEST SAVED</span><time dateTime={new Date(latest.completedAt).toISOString()}>{timeLabel(latest.completedAt)}</time></div>
        </header>
        <div className={styles.compareColumns} aria-hidden="true"><span>INPUT</span><span>BASELINE</span><span>OBSERVED CHANGE</span><span>LATEST SAVED</span></div>
        <div className={styles.compareRows}>
          {comparison.points.map((point) => {
            const [primary, secondary] = comparisonCopy(point);
            const transitionClass = point.transition === "unresolved" && point.previous.status === "passed-then" && point.current.status !== "passed-then"
              ? styles["not-reobserved"]
              : styles[point.transition];
            return <article className={styles.compareRow} key={point.amount}>
              <div className={styles.compareAmount}><b className={styles.srOnly}>Exact input: </b><strong>{Number(point.amount).toLocaleString("en-US")}</strong><small>USDG</small></div>
              <div className={`${styles.memoryState} ${point.previous.status === "passed-then" ? styles.memoryPassed : ""}`}><b className={styles.srOnly}>Baseline saved observation: </b><i /><span>{pointStatus(point.previous)}</span><small>{point.previous.status === "passed-then" ? `${point.previous.deviationBps} bps · ${point.previous.protocol?.replace("Uniswap ", "")}` : "historical observation"}</small></div>
              <div className={`${styles.change} ${transitionClass ?? ""}`}><b className={styles.srOnly}>Observed change: </b><strong>{primary}</strong><small>{secondary}</small></div>
              <div className={`${styles.memoryState} ${point.current.status === "passed-then" ? styles.memoryPassed : ""}`}><b className={styles.srOnly}>Latest saved observation: </b><i /><span>{pointStatus(point.current)}</span><small>{point.current.status === "passed-then" ? `${point.current.deviationBps} bps · ${point.current.protocol?.replace("Uniswap ", "")}` : "historical observation"}</small></div>
            </article>;
          })}
        </div>
      </div>}

      {!comparison && <div className={styles.oneScan}>
        <span>01 / FIRST OBSERVATION SAVED</span>
        <strong>Return later. Run the same five points.</strong>
        <p>The next complete scan will compare each exact input with this observation. Historical passes remain expired and can never open an order.</p>
      </div>}

      <footer className={styles.footer}>
        <p><i /> Depth Memory is a local comparison notebook. It is not an execution signal, price history, liquidity maximum or fill guarantee.</p>
        <div>
          <button type="button" onClick={() => downloadHistory(asset, sorted)}>Export JSON</button>
          {clearArmed && <span className={styles.clearPrompt} role="status" aria-live="polite"><strong>Delete saved observations?</strong><small>This cannot be undone.</small></span>}
          {clearArmed && <button className={styles.cancelClear} type="button" onClick={() => setClearArmedAsset(null)}>Cancel</button>}
          <button className={clearArmed ? styles.confirmClear : ""} type="button" onClick={() => {
            if (clearArmed) {
              onClear();
              setClearArmedAsset(null);
            } else {
              setClearArmedAsset(asset);
            }
          }}>{clearArmed ? `Permanently clear ${sorted.length} ${asset} observation${sorted.length === 1 ? "" : "s"} from this browser` : `Clear ${asset} history`}</button>
        </div>
      </footer>
    </>}
  </section>;
}
