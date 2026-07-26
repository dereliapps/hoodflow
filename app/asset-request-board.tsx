"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserProvider, getAddress, type Eip1193Provider } from "ethers";
import { ASSET_REQUEST_CANDIDATES, ASSET_REQUEST_LIMIT, buildAssetVoteMessage } from "@/lib/asset-requests";

type Candidate = (typeof ASSET_REQUEST_CANDIDATES)[number] & { votes: number };
type Props = {
  walletAddress: string;
  walletProvider: Eip1193Provider | null;
  onWallet: () => void;
  notify: (message: string) => void;
};

export default function AssetRequestBoard({ walletAddress, walletProvider, onWallet, notify }: Props) {
  const [candidates, setCandidates] = useState<Candidate[]>(ASSET_REQUEST_CANDIDATES.map((asset) => ({ ...asset, votes: 0 })));
  const [walletVotes, setWalletVotes] = useState<string[]>([]);
  const [busyTicker, setBusyTicker] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const query = walletAddress ? `?wallet=${encodeURIComponent(walletAddress)}` : "";
      const response = await fetch(`/api/asset-requests${query}`, { cache: "no-store", signal });
      const payload = await response.json() as { candidates?: Candidate[]; walletVotes?: string[] };
      if (!response.ok || !Array.isArray(payload.candidates)) throw new Error("Market requests are temporarily unavailable.");
      if (signal?.aborted) return;
      setCandidates(payload.candidates);
      setWalletVotes(Array.isArray(payload.walletVotes) ? payload.walletVotes : []);
    } catch {
      // Keep the queue visible even when its live vote totals cannot be read.
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    const controller = new AbortController();
    const start = window.setTimeout(() => void load(controller.signal), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(controller.signal);
    }, 30_000);
    return () => {
      controller.abort();
      window.clearTimeout(start);
      window.clearInterval(timer);
    };
  }, [load]);

  const maxVotes = useMemo(() => Math.max(1, ...candidates.map((asset) => asset.votes)), [candidates]);

  async function vote(ticker: string) {
    if (!walletAddress || !walletProvider) return onWallet();
    if (walletVotes.includes(ticker)) return notify(`${ticker} is already in your request list.`);
    if (walletVotes.length >= ASSET_REQUEST_LIMIT) return notify(`Each wallet can request up to ${ASSET_REQUEST_LIMIT} markets.`);
    setBusyTicker(ticker);
    try {
      const provider = new BrowserProvider(walletProvider, "any");
      const signer = await provider.getSigner();
      const timestamp = new Date().getTime();
      const normalized = getAddress(walletAddress);
      const signature = await signer.signMessage(buildAssetVoteMessage(normalized, ticker, timestamp));
      const response = await fetch("/api/asset-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: normalized, ticker, timestamp, signature }),
      });
      const payload = await response.json() as { candidates?: Candidate[]; walletVotes?: string[]; error?: string };
      if (!response.ok || !Array.isArray(payload.candidates)) throw new Error(payload.error || "The market request could not be saved.");
      setCandidates(payload.candidates);
      setWalletVotes(payload.walletVotes ?? []);
      notify(`${ticker} added to your market requests`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The market request failed.");
    } finally {
      setBusyTicker("");
    }
  }

  return <section className="request-board">
    <div className="request-board-head">
      <div><p className="eyebrow">COMMUNITY REQUEST BOARD</p><h2>Which route should we review next?</h2><span>One signed request, no transaction. Each wallet gets {ASSET_REQUEST_LIMIT} choices.</span></div>
      <div className="request-counter"><strong>{walletVotes.length}/{ASSET_REQUEST_LIMIT}</strong><span>YOUR REQUESTS</span></div>
    </div>
    <div className="request-grid">
      {candidates.map((asset, index) => {
        const selected = walletVotes.includes(asset.ticker);
        return <article key={asset.ticker} className={selected ? "selected" : ""} style={{ "--vote-fill": `${Math.max(6, asset.votes / maxVotes * 100)}%` } as React.CSSProperties}>
          <div className="request-rank">0{index + 1}</div>
          <div><span>{asset.type} · {asset.stage}</span><h3>{asset.name} <em>{asset.ticker}</em></h3><p>{asset.votes} verified {asset.votes === 1 ? "request" : "requests"}</p></div>
          <button type="button" onClick={() => void vote(asset.ticker)} disabled={selected || Boolean(busyTicker)}>{busyTicker === asset.ticker ? "Check wallet…" : selected ? "Requested ✓" : walletAddress ? "Request route" : "Connect to vote"}</button>
        </article>;
      })}
    </div>
    <p className="request-disclaimer">Requests help prioritize route testing; they do not guarantee a listing, launch date or safe liquidity.</p>
    {loading && <span className="request-loading">Syncing verified totals…</span>}
  </section>;
}
