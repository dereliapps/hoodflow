"use client";

import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, getAddress, type Eip1193Provider } from "ethers";
import { buildReferralMessage, INVITEE_POINTS, REFERRER_POINTS, SEASON_REFERRAL_CAP } from "@/lib/referrals";
import { track } from "@/lib/analytics-client";

type ProfileResponse = {
  profile: { wallet: string; code: string; points: number; createdAt: number } | null;
  pending: number;
  qualified: number;
  attribution: { referralCode: string; status: string } | null;
};
type Props = { walletAddress: string; walletProvider: Eip1193Provider | null; onWallet: () => void; notify: (message: string) => void };
const REF_KEY = "hoodflow_referral_code_v1";

export default function ReferralRewards({ walletAddress, walletProvider, onWallet, notify }: Props) {
  const [data, setData] = useState<ProfileResponse>({ profile: null, pending: 0, qualified: 0, attribution: null });
  const [referralCode, setReferralCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get("ref")?.trim().toUpperCase() || "";
    const saved = localStorage.getItem(REF_KEY) || "";
    const code = /^[A-Z0-9]{6,12}$/.test(query) ? query : saved;
    if (code) {
      localStorage.setItem(REF_KEY, code);
      window.setTimeout(() => setReferralCode(code), 0);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!walletAddress) return setData({ profile: null, pending: 0, qualified: 0, attribution: null });
    try {
      const response = await fetch(`/api/referrals?wallet=${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
      const payload = await response.json() as ProfileResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Rewards could not be loaded.");
      setData(payload);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Rewards could not be loaded."); }
  }, [walletAddress]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  async function activate() {
    if (!walletAddress || !walletProvider) return onWallet();
    setBusy(true);
    setError("");
    try {
      const timestamp = Date.now();
      const normalized = getAddress(walletAddress);
      const code = referralCode.trim().toUpperCase();
      const signer = await new BrowserProvider(walletProvider, "any").getSigner();
      const signature = await signer.signMessage(buildReferralMessage(normalized, timestamp, code));
      const response = await fetch("/api/referrals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "register", wallet: normalized, referralCode: code, timestamp, signature }),
      });
      const payload = await response.json() as ProfileResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Rewards could not be activated.");
      setData(payload);
      localStorage.removeItem(REF_KEY);
      track("referral_registered");
      notify("HoodFlow Rewards activated");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Rewards could not be activated."); }
    finally { setBusy(false); }
  }

  const referralLink = data.profile && typeof window !== "undefined" ? `${window.location.origin}/?ref=${data.profile.code}` : "";

  async function copyLink() {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink);
    track("referral_shared");
    notify("Referral link copied");
  }

  return <section className="page inner-page rewards-page">
    <div className="rewards-hero"><div><p className="eyebrow">HOODFLOW REWARDS / SEASON 0</p><h1>Bring real traders.<br /><span>Earn real signal.</span></h1><p>Referral points reward verified first trades, not clicks or volume farming. Every qualification is tied to one wallet and one confirmed Robinhood Chain router transaction.</p></div><div className="points-orbit"><span>HF</span><strong>{data.profile?.points.toLocaleString("en-US") ?? "—"}</strong><small>HF POINTS</small></div></div>
    <div className="hflow-disclosure"><strong>PLANNED $HFLOW ELIGIBILITY</strong><p>HF Points are planned to inform eligibility for a future $HFLOW conversion. They are non-transferable, have no current monetary value, and do not guarantee an allocation. Launch, rate, eligibility and anti-sybil terms will be announced separately.</p></div>
    {!data.profile ? <section className="rewards-activate"><div><span>01 / ACTIVATE</span><h2>One wallet signature.<br />No transaction.</h2><p>Create a unique referral code and lock in an inviter, if you have one. The signature cannot move funds or approve tokens.</p></div><div className="activation-box"><label>INVITE CODE <span>OPTIONAL</span><input value={referralCode} onChange={(event) => setReferralCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))} placeholder="e.g. HFLOW8X2" /></label><button onClick={() => void activate()} disabled={busy}>{busy ? "Waiting for signature…" : walletAddress ? "Activate Rewards →" : "Connect wallet →"}</button>{error && <p>{error}</p>}</div></section> : <>
      <section className="rewards-dashboard"><article><span>TOTAL POINTS</span><strong>{data.profile.points.toLocaleString("en-US")}</strong><small>Season 0 balance</small></article><article><span>QUALIFIED REFERRALS</span><strong>{data.qualified}<em>/{SEASON_REFERRAL_CAP}</em></strong><small>First trade confirmed</small></article><article><span>PENDING WALLETS</span><strong>{data.pending}</strong><small>Activated, not qualified</small></article><article><span>YOUR INVITE STATUS</span><strong className="status-copy">{data.attribution ? data.attribution.status : "DIRECT"}</strong><small>{data.attribution ? `Code ${data.attribution.referralCode}` : "No inviter attached"}</small></article></section>
      <section className="referral-link-card"><div><span>YOUR REFERRAL LINK</span><strong>{referralLink}</strong></div><button onClick={() => void copyLink()}>Copy link</button><a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent("I’m exploring protected Stock Token and crypto routes on Robinhood Chain with HoodFlow. Join Season 0:")}&url=${encodeURIComponent(referralLink)}`} target="_blank" rel="noreferrer" onClick={() => track("referral_shared")}>Share on X ↗</a></section>
      {error && <p className="rewards-error">{error}</p>}
    </>}
    <section className="points-rules"><div><p className="eyebrow">POINT LOGIC</p><h2>Simple enough to audit.</h2></div><div className="rule-ledger"><article><span>INVITED WALLET</span><strong>+{INVITEE_POINTS}</strong><p>After its first eligible, confirmed HoodFlow router trade.</p></article><article><span>REFERRER</span><strong>+{REFERRER_POINTS}</strong><p>For each qualified wallet, capped at {SEASON_REFERRAL_CAP} referrals this season.</p></article><article><span>CLICKS / VOLUME</span><strong>+0</strong><p>No points for empty clicks, wash volume or repeated trades.</p></article></div></section>
    <section className="anti-sybil"><div><span>01</span><h3>One inviter per wallet</h3><p>The relationship locks when Rewards is activated and cannot be replaced later.</p></div><div><span>02</span><h3>First trade only</h3><p>A transaction hash and invitee wallet can qualify only once.</p></div><div><span>03</span><h3>Onchain verification</h3><p>The server verifies chain, sender, router, confirmation and referral activation time.</p></div><div><span>04</span><h3>Review reserved</h3><p>Sybil clusters, self-referrals and manipulated activity can be excluded from future eligibility.</p></div></section>
    <p className="rewards-fineprint">Season 0 is an experimental loyalty program, not an investment product. HoodFlow may amend, pause or end the program before any token launch. Participation may be restricted by jurisdiction.</p>
  </section>;
}
