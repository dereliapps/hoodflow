"use client";

import { FormEvent, useMemo, useState } from "react";

type View = "overview" | "strategies" | "marketplace" | "activity";
type StrategyKind = "DCA" | "Take profit" | "Rebalance";

type Strategy = {
  id: number;
  name: string;
  kind: StrategyKind;
  asset: string;
  rule: string;
  next: string;
  status: "Live" | "Paused";
  spent: string;
};

const assetMeta: Record<string, { name: string; color: string; price: string; move: string }> = {
  AAPL: { name: "Apple", color: "#e8edf2", price: "$211.18", move: "+1.24%" },
  NVDA: { name: "NVIDIA", color: "#76b900", price: "$176.42", move: "+2.82%" },
  GOOGL: { name: "Alphabet", color: "#4285f4", price: "$193.67", move: "+0.61%" },
  TSLA: { name: "Tesla", color: "#e82127", price: "$326.91", move: "-0.84%" },
};

const starterStrategies: Strategy[] = [
  { id: 1, name: "Monday Apple", kind: "DCA", asset: "AAPL", rule: "20 USDG every Monday", next: "Mon, 09:30 UTC", status: "Live", spent: "160 USDG" },
  { id: 2, name: "NVDA trim", kind: "Take profit", asset: "NVDA", rule: "Sell 25% at +15%", next: "Watching price", status: "Live", spent: "0 USDG" },
  { id: 3, name: "Core balance", kind: "Rebalance", asset: "4 assets", rule: "Rebalance at 8% drift", next: "Drift: 3.2%", status: "Paused", spent: "420 USDG" },
];

const marketplace = [
  { name: "Steady Tech", author: "0x71…93F2", desc: "Weekly equal-weight DCA across AAPL, NVDA and GOOGL.", assets: ["AAPL", "NVDA", "GOOGL"], users: 428, volume: "$184k", fee: "0.05%", risk: "Measured" },
  { name: "Three Kings", author: "0xA4…10BD", desc: "Momentum rotation with a strict 35% cap per position.", assets: ["NVDA", "AAPL", "GOOGL"], users: 216, volume: "$96k", fee: "0.08%", risk: "Active" },
  { name: "Cash Cushion", author: "0x22…7AE1", desc: "Moves gains into USDG whenever portfolio drift exceeds 10%.", assets: ["AAPL", "NVDA", "USDG"], users: 139, volume: "$61k", fee: "0.04%", risk: "Defensive" },
];

function Mark({ ticker, small = false }: { ticker: string; small?: boolean }) {
  const bg = assetMeta[ticker]?.color ?? (ticker === "USDG" ? "#26c281" : "#24282b");
  return <span className={`asset-mark ${small ? "small" : ""}`} style={{ "--mark": bg } as React.CSSProperties}>{ticker.slice(0, 1)}</span>;
}

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [connected, setConnected] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [kind, setKind] = useState<StrategyKind>("DCA");
  const [strategies, setStrategies] = useState(starterStrategies);
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const liveCount = useMemo(() => strategies.filter((item) => item.status === "Live").length, [strategies]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  function toggleWallet() {
    setConnected((current) => !current);
    notify(connected ? "Wallet disconnected" : "Testnet wallet connected");
  }

  function toggleStrategy(id: number) {
    setStrategies((current) => current.map((item) => item.id === id ? { ...item, status: item.status === "Live" ? "Paused" : "Live" } : item));
  }

  function createStrategy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const asset = String(form.get("asset") || "AAPL");
    const amount = String(form.get("amount") || "20");
    const frequency = String(form.get("frequency") || "Monday");
    const rule = kind === "DCA" ? `${amount} USDG every ${frequency}` : kind === "Take profit" ? `Sell ${amount}% at +${frequency}%` : `Rebalance at ${amount}% drift`;
    setStrategies((current) => [{ id: Date.now(), name: String(form.get("name") || `${asset} ${kind}`), kind, asset: kind === "Rebalance" ? "4 assets" : asset, rule, next: "Ready to execute", status: "Live", spent: "0 USDG" }, ...current]);
    setComposerOpen(false);
    setView("strategies");
    notify("Strategy created on Robinhood Chain Testnet");
  }

  function copyStrategy(name: string) {
    setCopied(name);
    notify(`${name} added to your drafts`);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("overview")} aria-label="HoodFlow home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>hoodflow</span>
        </button>

        <nav className="main-nav" aria-label="Main navigation">
          {(["overview", "strategies", "marketplace", "activity"] as View[]).map((item) => (
            <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}</button>
          ))}
        </nav>

        <div className="top-actions">
          <span className="network"><i /> Robinhood Chain</span>
          <button className={connected ? "wallet connected" : "wallet"} onClick={toggleWallet}>
            {connected ? "0x71A4…93F2" : "Connect wallet"}
          </button>
        </div>
      </header>

      <div className="mobile-nav">
        {(["overview", "strategies", "marketplace", "activity"] as View[]).map((item) => (
          <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}</button>
        ))}
      </div>

      {view === "overview" && (
        <section className="page overview-page">
          <div className="page-heading">
            <div>
              <p className="eyebrow">PORTFOLIO AUTOMATION</p>
              <h1>Your portfolio,<br /><span>on schedule.</span></h1>
              <p className="lede">Set the rule once. HoodFlow watches the market and executes within the limits you approve.</p>
            </div>
            <button className="primary-action" onClick={() => setComposerOpen(true)}><span>＋</span> New strategy</button>
          </div>

          <div className="overview-grid">
            <article className="balance-card dark-card">
              <div className="card-label"><span>Portfolio balance</span><span className="live-label"><i /> LIVE</span></div>
              <div className="balance-line"><strong>$12,804.62</strong><span>+$284.17 today</span></div>
              <div className="chart" aria-label="Portfolio performance chart">
                <div className="chart-area" />
                <div className="chart-line" />
                <div className="chart-dot" />
                <div className="chart-labels"><span>09 JUL</span><span>11 JUL</span><span>13 JUL</span><span>TODAY</span></div>
              </div>
              <div className="balance-foot"><span>30D return <b>+7.42%</b></span><span>Automated volume <b>$2,480</b></span></div>
            </article>

            <article className="stats-stack">
              <div className="stat-card"><span>ACTIVE STRATEGIES</span><strong>{liveCount}</strong><small>of {strategies.length} total</small><div className="mini-bars"><i /><i /><i /><i /><i /><i /></div></div>
              <div className="stat-card fee-card"><span>FEES SAVED THIS MONTH</span><strong>$18.44</strong><small>vs. manual execution</small><b className="delta">↓ 12%</b></div>
            </article>
          </div>

          <div className="section-title"><div><p className="eyebrow">RUNNING NOW</p><h2>Active strategies</h2></div><button onClick={() => setView("strategies")}>View all <span>→</span></button></div>
          <div className="strategy-list">
            {strategies.filter((item) => item.status === "Live").slice(0, 3).map((item) => (
              <StrategyRow key={item.id} item={item} onToggle={() => toggleStrategy(item.id)} />
            ))}
          </div>

          <div className="trust-strip">
            <div><span className="trust-icon">⌁</span><p><strong>Non-custodial by design</strong><small>Your assets stay in your wallet. Every strategy has a spending cap and expiry.</small></p></div>
            <div><span className="trust-icon">✓</span><p><strong>Canonical assets only</strong><small>Every ticker is checked against Robinhood Chain&apos;s official token registry.</small></p></div>
            <button onClick={() => notify("Security brief opened")}>Read security brief →</button>
          </div>
        </section>
      )}

      {view === "strategies" && (
        <section className="page inner-page">
          <div className="inner-heading"><div><p className="eyebrow">AUTOMATION DESK</p><h1>Strategies</h1><p>Rules that execute from your wallet, inside the limits you set.</p></div><button className="primary-action" onClick={() => setComposerOpen(true)}><span>＋</span> New strategy</button></div>
          <div className="summary-row"><div><span>Active</span><strong>{liveCount}</strong></div><div><span>Executed this month</span><strong>24</strong></div><div><span>Automated volume</span><strong>$2,480</strong></div><div><span>Protocol fees</span><strong>$2.48</strong></div></div>
          <div className="table-card">
            <div className="table-head"><span>STRATEGY</span><span>RULE</span><span>NEXT ACTION</span><span>SPENT</span><span>STATUS</span></div>
            {strategies.map((item) => <StrategyRow key={item.id} item={item} detailed onToggle={() => toggleStrategy(item.id)} />)}
          </div>
        </section>
      )}

      {view === "marketplace" && (
        <section className="page inner-page">
          <div className="market-hero"><p className="eyebrow">BUILT BY THE MARKET</p><h1>Don&apos;t start from zero.</h1><p>Copy transparent strategies into your own wallet. Creators earn only when their rules execute.</p></div>
          <div className="market-toolbar"><div><button className="selected">Featured</button><button>Most copied</button><button>Lowest risk</button></div><label><span>⌕</span><input aria-label="Search strategies" placeholder="Search strategies" /></label></div>
          <div className="market-grid">
            {marketplace.map((item, index) => (
              <article className="market-card" key={item.name}>
                <div className="market-number">0{index + 1}</div>
                <div className="market-top"><span className={`risk risk-${index}`}>{item.risk}</span><span>{item.fee} creator fee</span></div>
                <h2>{item.name}</h2><p>{item.desc}</p>
                <div className="asset-pile">{item.assets.map((asset) => <Mark key={asset} ticker={asset} small />)}</div>
                <div className="market-metrics"><div><span>30D VOLUME</span><strong>{item.volume}</strong></div><div><span>COPIERS</span><strong>{item.users}</strong></div></div>
                <div className="creator"><span>by {item.author}</span><button onClick={() => copyStrategy(item.name)}>{copied === item.name ? "Added ✓" : "Copy strategy"}</button></div>
              </article>
            ))}
          </div>
          <p className="market-note">Marketplace performance is historical, net of HoodFlow fees, and never a promise of future returns.</p>
        </section>
      )}

      {view === "activity" && (
        <section className="page inner-page">
          <div className="inner-heading"><div><p className="eyebrow">ONCHAIN RECORD</p><h1>Activity</h1><p>Every authorization, execution and fee in one audit trail.</p></div><button className="secondary-action" onClick={() => notify("CSV export prepared")}>Export CSV</button></div>
          <div className="activity-card">
            {[
              ["DCA executed", "Monday Apple", "20 USDG → 0.0947 AAPL", "2 minutes ago", "Complete"],
              ["Authorization renewed", "Monday Apple", "Budget cap: 240 USDG", "Yesterday", "Confirmed"],
              ["Price condition checked", "NVDA trim", "Target +15% · Current +9.4%", "Yesterday", "No action"],
              ["Strategy paused", "Core balance", "Paused by owner", "12 Jul, 18:42", "Confirmed"],
              ["DCA executed", "Monday Apple", "20 USDG → 0.0951 AAPL", "08 Jul, 09:30", "Complete"],
            ].map((event, index) => (
              <div className="activity-row" key={event[0] + index}><span className={`activity-symbol symbol-${index}`}>{index === 2 ? "·" : index === 3 ? "Ⅱ" : "↓"}</span><div><strong>{event[0]}</strong><small>{event[1]}</small></div><p>{event[2]}</p><time>{event[3]}</time><span className="activity-status">{event[4]}</span></div>
            ))}
          </div>
        </section>
      )}

      <footer><span>HoodFlow Labs · Robinhood Chain Testnet</span><div><button>Security</button><button>Docs</button><button>Terms</button></div><span className="testnet-tag"><i /> TESTNET ONLY</span></footer>

      {composerOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setComposerOpen(false); }}>
          <section className="composer" role="dialog" aria-modal="true" aria-labelledby="composer-title">
            <div className="composer-head"><div><p className="eyebrow">NEW AUTOMATION</p><h2 id="composer-title">Build a strategy</h2></div><button aria-label="Close strategy builder" onClick={() => setComposerOpen(false)}>×</button></div>
            <div className="kind-grid">
              {(["DCA", "Take profit", "Rebalance"] as StrategyKind[]).map((item) => <button key={item} className={kind === item ? "selected" : ""} onClick={() => setKind(item)}><span>{item === "DCA" ? "↻" : item === "Take profit" ? "↗" : "≋"}</span><strong>{item}</strong><small>{item === "DCA" ? "Buy on a schedule" : item === "Take profit" ? "Trim at your target" : "Keep target weights"}</small></button>)}
            </div>
            <form onSubmit={createStrategy}>
              <label>STRATEGY NAME<input name="name" placeholder="e.g. Monday Apple" required /></label>
              {kind !== "Rebalance" && <label>ASSET<select name="asset" defaultValue="AAPL">{Object.entries(assetMeta).map(([ticker, meta]) => <option key={ticker} value={ticker}>{ticker} · {meta.name}</option>)}</select></label>}
              <div className="form-pair">
                <label>{kind === "DCA" ? "AMOUNT" : kind === "Take profit" ? "POSITION TO SELL" : "DRIFT LIMIT"}<span className="input-unit"><input name="amount" type="number" min="1" defaultValue={kind === "DCA" ? "20" : kind === "Take profit" ? "25" : "8"} required /><b>{kind === "DCA" ? "USDG" : "%"}</b></span></label>
                <label>{kind === "DCA" ? "SCHEDULE" : kind === "Take profit" ? "PROFIT TARGET" : "CHECK"}{kind === "DCA" ? <select name="frequency" defaultValue="Monday"><option>Monday</option><option>Friday</option><option>day</option><option>month</option></select> : <span className="input-unit"><input name="frequency" type="number" min="1" defaultValue={kind === "Take profit" ? "15" : "24"} /><b>{kind === "Take profit" ? "%" : "HR"}</b></span>}</label>
              </div>
              <div className="limit-note"><span>✓</span><p><strong>Spending limits stay enforced onchain.</strong><small>HoodFlow cannot move funds outside this strategy&apos;s token, budget and expiry rules.</small></p></div>
              <div className="composer-actions"><button type="button" onClick={() => setComposerOpen(false)}>Cancel</button><button type="submit" className="primary-action">Create on testnet <span>→</span></button></div>
            </form>
          </section>
        </div>
      )}

      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}

function StrategyRow({ item, detailed = false, onToggle }: { item: Strategy; detailed?: boolean; onToggle: () => void }) {
  return (
    <article className={`strategy-row ${detailed ? "detailed" : ""}`}>
      <div className="strategy-name"><Mark ticker={item.asset === "4 assets" ? "4" : item.asset} /><p><strong>{item.name}</strong><small>{item.kind} · {item.asset}</small></p></div>
      <div className="rule-cell"><span>{detailed ? "" : "RULE"}</span><strong>{item.rule}</strong></div>
      <div className="next-cell"><span>{detailed ? "" : "NEXT"}</span><strong>{item.next}</strong></div>
      {detailed && <div className="spent-cell"><strong>{item.spent}</strong></div>}
      <button className={`status-button ${item.status.toLowerCase()}`} onClick={onToggle}><i />{item.status}</button>
      {!detailed && <button className="row-more" aria-label={`More options for ${item.name}`}>•••</button>}
    </article>
  );
}
