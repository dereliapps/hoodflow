"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  isFillProof,
  isFillProofLocalSnapshot,
  rawDeltaBps,
  type FillProof,
  type FillProofLocalSnapshot,
} from "@/lib/fill-proof";
import { formatPercentage, formatTokenAmount } from "@/lib/format-display-number";
import { ROBINHOOD_MAINNET } from "@/lib/hoodflow-mainnet";

type FillProofReceiptProps = {
  txHash: string;
  walletAddress?: string;
  localSnapshot?: FillProofLocalSnapshot;
  onClose?: () => void;
  onNotify?: (message: string) => void;
  standalone?: boolean;
};

function compact(value: string, lead = 8, tail = 6) {
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

function amountLabel(value: string | null, raw: string, ticker: string) {
  return value === null ? `${raw} raw ${ticker}` : `${formatTokenAmount(value)} ${ticker}`;
}

function percentFromBps(bps: number | null) {
  return bps === null ? "Unavailable" : formatPercentage(bps / 100);
}

function quoteDeltaLabel(bps: number | null) {
  return bps === null ? "Quote comparison unavailable" : `Actual ${percentFromBps(bps)} vs quote`;
}

function minimumOutcomeLabel(bps: number) {
  return bps === 0 ? "Met protected floor" : `${percentFromBps(bps)} above protected floor`;
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function FillProofReceipt({
  txHash,
  walletAddress,
  localSnapshot,
  onClose,
  onNotify,
  standalone = false,
}: FillProofReceiptProps) {
  const [proof, setProof] = useState<FillProof | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requestVersion, setRequestVersion] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/fill-proof?txHash=${encodeURIComponent(txHash)}`, {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        const payload = await response.json() as { proof?: unknown; error?: string };
        if (!response.ok || !isFillProof(payload.proof)) {
          throw new Error(payload.error || "The onchain settlement could not be reconstructed.");
        }
        if (walletAddress && payload.proof.transaction.from.toLowerCase() !== walletAddress.toLowerCase()) {
          throw new Error("This receipt belongs to a different wallet.");
        }
        setProof(payload.proof);
      } catch (reason) {
        if (controller.signal.aborted) return;
        setProof(null);
        setError(reason instanceof Error ? reason.message : "Mainnet verification is temporarily unavailable.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [requestVersion, txHash, walletAddress]);

  useEffect(() => {
    if (standalone) return;
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const focusFrame = requestAnimationFrame(() => dialog?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onClose) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [onClose, standalone]);

  const snapshotCandidate = useMemo(
    () => isFillProofLocalSnapshot(localSnapshot) ? localSnapshot : null,
    [localSnapshot],
  );
  const snapshot = useMemo(() => proof && snapshotCandidate
    && snapshotCandidate.asset === proof.asset
    && snapshotCandidate.side === proof.side
    && snapshotCandidate.minimumRawOutput === proof.amounts.output.rawMinimum
    && snapshotCandidate.protocol === proof.route.protocol
    && snapshotCandidate.feeTier === proof.route.feeTier
    ? snapshotCandidate
    : null, [proof, snapshotCandidate]);
  const snapshotMismatch = Boolean(proof && snapshotCandidate && !snapshot);
  const quoteDeltaBps = proof && snapshot
    ? rawDeltaBps(proof.amounts.output.rawActual, snapshot.expectedRawOutput)
    : null;
  const publicUrl = useCallback(() => `${window.location.origin}/fillproof/${txHash}`, [txHash]);
  const notify = useCallback((message: string) => onNotify?.(message), [onNotify]);

  const copySummary = useCallback(async () => {
    if (!proof) return;
    const lines = [
      `HoodFlow FillProof · ${proof.side.toUpperCase()} ${proof.asset}`,
      `Actual: ${amountLabel(proof.amounts.output.displayActual, proof.amounts.output.rawActual, proof.amounts.output.ticker)}`,
      `Protected minimum: ${amountLabel(proof.amounts.output.displayMinimum, proof.amounts.output.rawMinimum, proof.amounts.output.ticker)}`,
      `Minimum-output surplus: ${percentFromBps(proof.amounts.output.minimumSurplusBps)}`,
      `Block: ${proof.transaction.blockNumber}`,
      `Verify: ${publicUrl()}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      notify("FillProof summary copied");
    } catch {
      notify("Copy failed. Open the public receipt and copy its URL.");
    }
  }, [notify, proof, publicUrl]);

  const copyPublicLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(publicUrl());
      notify("Public FillProof link copied");
    } catch {
      notify("Copy failed. Use the browser address bar instead.");
    }
  }, [notify, publicUrl]);

  const download = useCallback(() => {
    if (!proof) return;
    downloadJson(`hoodflow-fillproof-${proof.transaction.hash.slice(2, 10)}.json`, {
      proof,
      localPretradeSnapshot: snapshot,
      localSnapshotNotice: snapshot
        ? "This optional pretrade snapshot was saved by the browser. It is not covered by the onchain-reconstruction checksum."
        : "No device-local pretrade quote was supplied.",
    });
    notify("FillProof JSON downloaded");
  }, [notify, proof, snapshot]);

  const retryVerification = useCallback(() => {
    setProof(null);
    setError("");
    setLoading(true);
    setRequestVersion((value) => value + 1);
  }, []);

  const shellClass = standalone ? "fillproof-shell standalone" : "fillproof-shell";
  return <section ref={dialogRef} tabIndex={standalone ? undefined : -1} className={shellClass} role={standalone ? undefined : "dialog"} aria-modal={standalone ? undefined : true} aria-label="FillProof execution receipt">
    <header className="fillproof-head">
      <div>
        <p><i /> FILLPROOF / EXECUTION RECEIPT</p>
        <h1>{proof ? `${proof.side === "buy" ? "Bought" : "Sold"} ${proof.asset}` : "Verify a mainnet fill"}</h1>
      </div>
      <div className="fillproof-head-actions">
        {proof && <span className="fillproof-verdict"><i /> PROTECTED FILL</span>}
        {onClose && <button type="button" aria-label="Close FillProof" onClick={onClose}>×</button>}
      </div>
    </header>

    {loading && <div className="fillproof-loading" role="status"><span><i /><i /><i /></span><strong>Reconstructing settlement from mainnet…</strong><p>Checking the router, canonical token transfer and protected minimum.</p></div>}

    {!loading && error && <div className="fillproof-error" role="alert"><span>!</span><strong>FillProof unavailable</strong><p>{error}</p><button type="button" onClick={retryVerification}>Retry verification</button></div>}

    {!loading && proof && <>
      <div className="fillproof-hero">
        <div>
          <span>ACTUAL RECEIVED</span>
          <strong>{amountLabel(proof.amounts.output.displayActual, proof.amounts.output.rawActual, proof.amounts.output.ticker)}</strong>
          <small>for {amountLabel(proof.amounts.input.display, proof.amounts.input.raw, proof.amounts.input.ticker)}</small>
        </div>
        <dl>
          <div><dt>Transaction</dt><dd>{compact(proof.transaction.hash)}</dd></div>
          <div><dt>Block</dt><dd>#{proof.transaction.blockNumber.toLocaleString("en-US")}</dd></div>
          <div><dt>Confirmed</dt><dd>{new Date(proof.transaction.blockTimestamp * 1_000).toLocaleString()}</dd></div>
        </dl>
      </div>

      <div className="fillproof-comparison">
        <header><span>PROTECTION LANE</span><strong>Raw-unit comparison</strong></header>
        <div className="fillproof-comparison-grid">
          <article className={!snapshot ? "muted" : ""}><span>PRETRADE QUOTE</span><strong>{snapshot ? `${formatTokenAmount(snapshot.expectedDisplayOutput)} ${proof.amounts.output.ticker}` : snapshotMismatch ? "Snapshot mismatch" : "Not saved"}</strong><small>{snapshot ? quoteDeltaLabel(quoteDeltaBps) : snapshotMismatch ? "Local quote does not match this settlement and was excluded." : "This trade predates FillProof quote snapshots."}</small></article>
          <article><span>PROTECTED MINIMUM</span><strong>{amountLabel(proof.amounts.output.displayMinimum, proof.amounts.output.rawMinimum, proof.amounts.output.ticker)}</strong><small>Encoded in router calldata</small></article>
          <article className="actual"><span>ACTUAL SETTLEMENT</span><strong>{amountLabel(proof.amounts.output.displayActual, proof.amounts.output.rawActual, proof.amounts.output.ticker)}</strong><small>{minimumOutcomeLabel(proof.amounts.output.minimumSurplusBps)}</small></article>
        </div>
        <div className="fillproof-lane" aria-label="Actual output met or exceeded the protected minimum"><span>MIN</span><i><b /></i><span>ACTUAL</span></div>
      </div>

      <div className="fillproof-details">
        <section>
          <header><span>ROUTE & COST</span></header>
          <dl>
            <div><dt>Venue</dt><dd>Uniswap {proof.route.protocol}</dd></div>
            <div><dt>Pool fee tier</dt><dd>{(proof.route.feeTier / 10_000).toFixed(2)}%</dd></div>
            <div><dt>Gas used</dt><dd>{Number(proof.gas.used).toLocaleString("en-US")}</dd></div>
            <div><dt>Native gas paid</dt><dd>{formatTokenAmount(proof.gas.paidEth)} ETH</dd></div>
            <div><dt>Settlement token</dt><dd>{proof.amounts.output.ticker}</dd></div>
            <div><dt>Transfers counted</dt><dd>{proof.amounts.output.transferCount}</dd></div>
          </dl>
        </section>
        <section>
          <header><span>VERIFICATION TRAIL</span></header>
          <ol>{proof.checks.map((check, index) => <li key={check.code}><b>{String(index + 1).padStart(2, "0")}</b><p><strong>{check.label}</strong><small>{check.detail}</small></p><i>PASS</i></li>)}</ol>
        </section>
      </div>

      <div className="fillproof-provenance">
        <header><span>PROVENANCE</span><strong>Copy full values from the JSON receipt</strong></header>
        <dl>
          <div><dt>Transaction hash</dt><dd>{compact(proof.transaction.hash, 12, 10)}</dd></div>
          <div><dt>Block hash</dt><dd>{compact(proof.transaction.blockHash, 12, 10)}</dd></div>
          <div><dt>Router</dt><dd>{compact(proof.transaction.to, 10, 8)}</dd></div>
          <div><dt>Calldata hash</dt><dd>{compact(proof.transaction.calldataHash, 12, 10)}</dd></div>
          <div><dt>Receipt checksum</dt><dd>{compact(proof.integrity.digest, 12, 10)}</dd></div>
          <div><dt>ActionLock snapshot</dt><dd>{snapshot ? compact(snapshot.actionLockDigest, 12, 10) : "Device snapshot unavailable"}</dd></div>
        </dl>
      </div>

      <div className="fillproof-actions">
        <button type="button" className="primary" onClick={download}>Download JSON <span>↓</span></button>
        <button type="button" onClick={() => void copySummary()}>Copy summary</button>
        <button type="button" onClick={() => void copyPublicLink()}>Share receipt</button>
        <a href={`${ROBINHOOD_MAINNET.blockExplorerUrls[0]}/tx/${proof.transaction.hash}`} target="_blank" rel="noreferrer">Open explorer ↗</a>
      </div>
      <p className="fillproof-notice">{proof.notice} {snapshot ? "The displayed pretrade quote is a separate device-local ActionLock snapshot." : "No pretrade quote is claimed for this receipt."}</p>
    </>}
  </section>;
}
