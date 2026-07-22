"use client";

import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, getAddress, type Eip1193Provider } from "ethers";
import { buildReferralMessage, INVITEE_POINTS, REFERRER_POINTS, SEASON_REFERRAL_CAP } from "@/lib/referrals";
import { track } from "@/lib/analytics-client";

type ProfileResponse = {
  profile: { wallet: string; code: string; points: number; rank: number; createdAt: number } | null;
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

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!walletAddress) return setData({ profile: null, pending: 0, qualified: 0, attribution: null });
    try {
      const response = await fetch(`/api/referrals?wallet=${encodeURIComponent(walletAddress)}`, { cache: "no-store", signal });
      const payload = await response.json() as ProfileResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Rewards could not be loaded.");
      if (signal?.aborted) return;
      setData(payload);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) setError(caught instanceof Error ? caught.message : "Rewards could not be loaded.");
    }
  }, [walletAddress]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void refresh(controller.signal), 0);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
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

  const referralLink = data.profile && typeof window !== "undefined" ? `${window.location.origin}/?view=rewards&ref=${data.profile.code}` : "";

  async function copyLink() {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink);
    track("referral_shared");
    notify("Referral link copied");
  }

  return <section className="page inner-page rewards-page">
    <div className="rewards-hero"><div><p className="eyebrow">HOODFLOW REWARDS / SEASON 0</p><h1>Invite a wallet.<br /><span>Earn when they trade.</span></h1><p>Create your link, share it, and earn points after an invited wallet completes its first eligible HoodFlow trade. Clicks alone earn nothing.</p></div><div className="points-orbit"><span>HF</span><strong>{data.profile?.points.toLocaleString("en-US") ?? "—"}</strong><small>HF POINTS</small></div></div>
    <div className="hflow-disclosure"><strong>PLANNED $HFLOW ELIGIBILITY</strong><p>HF Points are planned to inform eligibility for a future $HFLOW conversion. They are non-transferable, have no current monetary value, and do not guarantee an allocation. Launch, rate, eligibility and anti-sybil terms will be announced separately.</p></div>
    {!data.profile ? <section className="rewards-activate"><div><span>CREATE YOUR LINK</span><h2>Sign once.<br />Start inviting.</h2><p>The signature creates your referral code. It does not approve a token, send a transaction, or move funds. If someone invited you, enter their code first.</p></div><div className="activation-box"><label>INVITE CODE <span>OPTIONAL</span><input value={referralCode} onChange={(event) => setReferralCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))} placeholder="e.g. HFLOW8X2" /></label><button onClick={() => void activate()} disabled={busy}>{busy ? "Check your wallet…" : walletAddress ? "Create my referral link →" : "Connect wallet to create link →"}</button>{error && <p>{error}</p>}</div></section> : <>
      <section className="rewards-dashboard"><article><span>TOTAL POINTS</span><strong>{data.profile.points.toLocaleString("en-US")}</strong><small>Season 0 balance</small></article><article><span>SEASON STATUS</span><strong className="status-copy">COMING SOON</strong><small>Leaderboard opens with the season</small></article><article><span>QUALIFIED REFERRALS</span><strong>{data.qualified}<em>/{SEASON_REFERRAL_CAP}</em></strong><small>First trade confirmed</small></article><article><span>PENDING WALLETS</span><strong>{data.pending}</strong><small>Joined, not traded yet</small></article></section>
      <section className="referral-link-card"><div><span>YOUR REFERRAL LINK</span><strong>{referralLink}</strong></div><button onClick={() => void copyLink()}>Copy link</button><a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent("Trading Robinhood Chain markets from one wallet. I joined HoodFlow Season 0:")}&url=${encodeURIComponent(referralLink)}`} target="_blank" rel="noreferrer" onClick={() => track("referral_shared")}>Share on X ↗</a></section>
      <p className="reward-attribution">Joined {data.attribution ? `with code ${data.attribution.referralCode} · ${data.attribution.status}` : "directly, without an invite code"}.</p>
      {error && <p className="rewards-error">{error}</p>}
    </>}
    <section className="rewards-leaderboard leaderboard-coming-soon"><div><p className="eyebrow">LEADERBOARD</p><span className="soon-pill">SEASON 0 · COMING SOON</span><h2>Earn now.<br />Rankings open later.</h2><p>Referral points are already tracked. Public standings will open when Season 0 has enough verified participants to make the board useful.</p></div><aside><strong>01</strong><span>Verified referrals only</span><strong>02</strong><span>No click or wash-volume points</span><strong>03</strong><span>Wallet privacy preserved</span></aside></section>
    <section className="points-rules"><div><p className="eyebrow">HOW POINTS WORK</p><h2>Only completed actions count.</h2></div><div className="rule-ledger"><article><span>INVITED WALLET</span><strong>+{INVITEE_POINTS}</strong><p>After its first reviewed USDG / Stock Token route settles at least 1 USDG of value.</p></article><article><span>REFERRER</span><strong>+{REFERRER_POINTS}</strong><p>For each qualified wallet, capped at {SEASON_REFERRAL_CAP} referrals this season.</p></article><article><span>CLICKS / VOLUME</span><strong>+0</strong><p>No points for clicks, repeated trades, community-token swaps or wash volume.</p></article></div></section>
    <section className="anti-sybil"><div><span>01</span><h3>One inviter per wallet</h3><p>The relationship locks when Rewards is activated and cannot be replaced later.</p></div><div><span>02</span><h3>First trade only</h3><p>A transaction hash and invitee wallet can qualify only once.</p></div><div><span>03</span><h3>Onchain verification</h3><p>The server verifies chain, sender, router, confirmation and referral activation time.</p></div><div><span>04</span><h3>Review reserved</h3><p>Sybil clusters, self-referrals and manipulated activity can be excluded from future eligibility.</p></div></section>
    <p className="rewards-fineprint">Season 0 is an experimental loyalty program, not an investment product. HoodFlow may amend, pause or end the program before any token launch. Participation may be restricted by jurisdiction.</p>
  </section>;
}
