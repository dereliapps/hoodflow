"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type View = "overview" | "strategies" | "assets" | "marketplace" | "activity" | "controls";
type StrategyKind = "DCA" | "Take profit" | "Rebalance";
type StrategyStatus = "Prepared" | "Paused" | "Shadow";

type Strategy = {
  id: number;
  name: string;
  kind: StrategyKind;
  asset: string;
  rule: string;
  next: string;
  status: StrategyStatus;
  spent: string;
  health: number;
  budget: string;
  expires: string;
};

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const TESTNET = {
  chainId: "0xb626",
  chainName: "Robinhood Chain Testnet",
  rpcUrls: ["https://rpc.testnet.chain.robinhood.com"],
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  blockExplorerUrls: ["https://explorer.testnet.chain.robinhood.com"],
};

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_HOODFLOW_CONTRACT_ADDRESS?.trim() ?? "";
const contractConfigured = /^0x[a-fA-F0-9]{40}$/.test(CONTRACT_ADDRESS);

const assetMeta: Record<string, { name: string; color: string; price: number; move: string }> = {
  AAPL: { name: "Apple", color: "#e8edf2", price: 211.18, move: "+1.24%" },
  AMD: { name: "AMD", color: "#ed1c24", price: 163.14, move: "+0.72%" },
  AMZN: { name: "Amazon", color: "#ff9900", price: 223.18, move: "+0.44%" },
  INTC: { name: "Intel", color: "#00c7fd", price: 24.16, move: "+0.31%" },
  META: { name: "Meta", color: "#0866ff", price: 704.28, move: "+0.94%" },
  MU: { name: "Micron", color: "#5b75a6", price: 128.42, move: "+1.08%" },
  NVDA: { name: "NVIDIA", color: "#76b900", price: 176.42, move: "+2.82%" },
  GOOGL: { name: "Alphabet", color: "#4285f4", price: 193.67, move: "+0.61%" },
  SNDK: { name: "Sandisk", color: "#a33bc2", price: 52.61, move: "+0.39%" },
  SPCX: { name: "SpaceX", color: "#c5cbd0", price: 212.0, move: "+0.00%" },
  TSLA: { name: "Tesla", color: "#e82127", price: 326.91, move: "-0.84%" },
  QQQ: { name: "Invesco QQQ", color: "#1c4a85", price: 563.72, move: "+0.48%" },
  SPY: { name: "SPDR S&P 500", color: "#bd252c", price: 626.44, move: "+0.34%" },
};

const assetRegistry = [
  ["AAPL", "Apple", "Stock", true], ["AMD", "AMD", "Stock", true],
  ["AMZN", "Amazon", "Stock", true], ["BABA", "Alibaba", "Stock", false],
  ["BE", "Bloom Energy", "Stock", false], ["COIN", "Coinbase", "Stock", false],
  ["CRCL", "Circle", "Stock", false], ["CRWV", "CoreWeave", "Stock", false],
  ["GOOGL", "Alphabet", "Stock", true], ["INTC", "Intel", "Stock", true],
  ["META", "Meta", "Stock", true], ["MSFT", "Microsoft", "Stock", false],
  ["MU", "Micron", "Stock", true], ["NVDA", "NVIDIA", "Stock", true],
  ["ORCL", "Oracle", "Stock", false], ["PLTR", "Palantir", "Stock", false],
  ["SNDK", "Sandisk", "Stock", true], ["SPCX", "SpaceX", "Stock", true],
  ["TSLA", "Tesla", "Stock", true], ["USAR", "USA Rare Earth", "Stock", false],
  ["QQQ", "Invesco QQQ", "ETF", true], ["SGOV", "iShares Treasury", "ETF", false],
  ["SLV", "iShares Silver", "ETF", false], ["SPY", "SPDR S&P 500", "ETF", true],
  ["CUSO", "United States Oil", "ETF", false],
] as const;

const starterStrategies: Strategy[] = [
  { id: 1, name: "Monday Apple", kind: "DCA", asset: "AAPL", rule: "20 USDG every Monday", next: "Authorization draft ready", status: "Prepared", spent: "160 USDG", health: 96, budget: "240 USDG", expires: "30 Sep 2026" },
  { id: 2, name: "NVDA trim", kind: "Take profit", asset: "NVDA", rule: "Sell 25% at +15%", next: "Watching price", status: "Shadow", spent: "0 USDG", health: 91, budget: "25% position", expires: "15 Oct 2026" },
  { id: 3, name: "Core balance", kind: "Rebalance", asset: "4 assets", rule: "Rebalance at 8% drift", next: "Drift: 3.2%", status: "Paused", spent: "420 USDG", health: 82, budget: "600 USDG", expires: "Paused" },
];

const marketplace = [
  { name: "Steady Tech", author: "0x71...93F2", desc: "Weekly equal-weight DCA across AAPL, NVDA and GOOGL.", assets: ["AAPL", "NVDA", "GOOGL"], users: 428, volume: "$184k", fee: "0.05%", risk: "Measured", drawdown: "-5.8%", age: "184 days" },
  { name: "Three Kings", author: "0xA4...10BD", desc: "Momentum rotation with a strict 35% cap per position.", assets: ["NVDA", "AAPL", "GOOGL"], users: 216, volume: "$96k", fee: "0.08%", risk: "Active", drawdown: "-11.2%", age: "97 days" },
  { name: "Cash Cushion", author: "0x22...7AE1", desc: "Moves gains into USDG whenever portfolio drift exceeds 10%.", assets: ["AAPL", "NVDA", "USDG"], users: 139, volume: "$61k", fee: "0.04%", risk: "Defensive", drawdown: "-3.1%", age: "221 days" },
];

function Mark({ ticker, small = false }: { ticker: string; small?: boolean }) {
  const bg = assetMeta[ticker]?.color ?? (ticker === "USDG" ? "#26c281" : "#24282b");
  return <span className={`asset-mark ${small ? "small" : ""}`} style={{ "--mark": bg } as React.CSSProperties}>{ticker.slice(0, 1)}</span>;
}

function compactAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The wallet request was declined.";
}

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [walletAddress, setWalletAddress] = useState("");
  const [walletBalance, setWalletBalance] = useState("");
  const [networkBlock, setNetworkBlock] = useState("Checking");
  const [contractStatus, setContractStatus] = useState(contractConfigured ? "Checking bytecode" : "Deploy pending");
  const [composerOpen, setComposerOpen] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [kind, setKind] = useState<StrategyKind>("DCA");
  const [strategies, setStrategies] = useState(starterStrategies);
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [shadowMode, setShadowMode] = useState(true);
  const [draftName, setDraftName] = useState("Monday Apple");
  const [draftAsset, setDraftAsset] = useState("AAPL");
  const [draftAmount, setDraftAmount] = useState("20");
  const [draftFrequency, setDraftFrequency] = useState("Monday");
  const [confirmStop, setConfirmStop] = useState(false);
  const [assetSearch, setAssetSearch] = useState("");
  const [assetScope, setAssetScope] = useState<"all" | "routed" | "registry">("all");

  const connected = Boolean(walletAddress);
  const preparedCount = useMemo(() => strategies.filter((item) => item.status === "Prepared").length, [strategies]);
  const shadowCount = useMemo(() => strategies.filter((item) => item.status === "Shadow").length, [strategies]);
  const estimatedUnits = useMemo(() => {
    const price = assetMeta[draftAsset]?.price ?? 1;
    return (Number(draftAmount || 0) / price).toFixed(4);
  }, [draftAmount, draftAsset]);

  useEffect(() => {
    async function readNetwork() {
      try {
        const response = await fetch(TESTNET.rpcUrls[0], {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
        });
        const data = await response.json() as { result?: string };
        setNetworkBlock(data.result ? Number.parseInt(data.result, 16).toLocaleString("en-US") : "Online");
        if (contractConfigured) {
          const codeResponse = await fetch(TESTNET.rpcUrls[0], {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_getCode", params: [CONTRACT_ADDRESS, "latest"] }),
          });
          const codeData = await codeResponse.json() as { result?: string };
          setContractStatus(codeData.result && codeData.result !== "0x" ? "Bytecode verified" : "Address empty");
        }
      } catch {
        setNetworkBlock("Online");
        if (contractConfigured) setContractStatus("RPC check failed");
      }
    }
    void readNetwork();
  }, []);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  async function connectWallet() {
    if (connected) {
      setWalletAddress("");
      setWalletBalance("");
      notify("Wallet disconnected from HoodFlow");
      return;
    }
    if (!window.ethereum) {
      notify("No browser wallet found. Install Robinhood Wallet or MetaMask.");
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: TESTNET.chainId }] });
      } catch (switchError: unknown) {
        if ((switchError as { code?: number })?.code === 4902) {
          await window.ethereum.request({ method: "wallet_addEthereumChain", params: [TESTNET] });
        } else {
          throw switchError;
        }
      }
      const address = accounts[0];
      const balanceHex = await window.ethereum.request({ method: "eth_getBalance", params: [address, "latest"] }) as string;
      const balance = Number(BigInt(balanceHex)) / 1e18;
      setWalletAddress(address);
      setWalletBalance(balance.toFixed(4));
      notify("Wallet connected to Robinhood Chain Testnet");
    } catch (error) {
      notify(errorMessage(error));
    }
  }

  function openComposer(nextKind: StrategyKind = "DCA") {
    setKind(nextKind);
    setDraftName(nextKind === "DCA" ? "Monday Apple" : nextKind === "Take profit" ? "NVDA trim" : "Core balance");
    setDraftAsset(nextKind === "Take profit" ? "NVDA" : "AAPL");
    setDraftAmount(nextKind === "DCA" ? "20" : nextKind === "Take profit" ? "25" : "8");
    setDraftFrequency(nextKind === "DCA" ? "Monday" : nextKind === "Take profit" ? "15" : "24");
    setShadowMode(true);
    setComposerOpen(true);
  }

  function toggleStrategy(id: number) {
    setStrategies((current) => current.map((item) => item.id === id ? { ...item, status: item.status === "Prepared" ? "Paused" : "Prepared" } : item));
  }

  function createStrategy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rule = kind === "DCA" ? `${draftAmount} USDG every ${draftFrequency}` : kind === "Take profit" ? `Sell ${draftAmount}% at +${draftFrequency}%` : `Rebalance at ${draftAmount}% drift`;
    const status: StrategyStatus = shadowMode || !connected ? "Shadow" : "Prepared";
    setStrategies((current) => [{
      id: Date.now(), name: draftName, kind, asset: kind === "Rebalance" ? "4 assets" : draftAsset,
      rule, next: status === "Shadow" ? "Simulating next execution" : "Authorization draft ready", status,
      spent: "0 USDG", health: 100, budget: kind === "DCA" ? `${Number(draftAmount) * 12} USDG` : `${draftAmount}% position`, expires: "30 Sep 2026",
    }, ...current]);
    setComposerOpen(false);
    setView("strategies");
    notify(status === "Shadow" ? "Shadow strategy started without moving funds" : "Authorization prepared; no transaction was broadcast");
  }

  function copyStrategy(name: string) {
    setCopied(name);
    notify(`${name} copied as a safe, editable draft`);
  }

  function stopAllStrategies() {
    setStrategies((current) => current.map((item) => ({ ...item, status: "Paused" as const })));
    setConfirmStop(false);
    notify("All strategy permissions paused locally");
  }

  const visibleAssets = assetRegistry.filter(([ticker, name, , routed]) => {
    const matchesScope = assetScope === "all" || (assetScope === "routed" ? routed : !routed);
    const query = assetSearch.trim().toLowerCase();
    return matchesScope && (!query || ticker.toLowerCase().includes(query) || name.toLowerCase().includes(query));
  });
  const navigation: View[] = ["overview", "strategies", "assets", "marketplace", "activity", "controls"];

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("overview")} aria-label="HoodFlow home">
          <span className="brand-mark"><i /><i /><i /></span><span>hoodflow</span><b className="version-badge">V6</b>
        </button>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}</button>)}
        </nav>
        <div className="top-actions">
          <span className="network"><i /> Testnet <b>#{networkBlock}</b></span>
          <button className={connected ? "wallet connected" : "wallet"} onClick={() => void connectWallet()}>{connected ? compactAddress(walletAddress) : "Connect wallet"}</button>
        </div>
      </header>

      <div className="mobile-nav">
        {navigation.map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}</button>)}
      </div>

      {view === "overview" && (
        <section className="page overview-page">
          <div className="market-state"><span><i /> TESTNET RPC ONLINE</span><span>Block #{networkBlock}</span><span>25/25 safety tests · 13 current routes</span></div>
          <div className="page-heading">
            <div><p className="eyebrow">AUTOMATION WITHOUT CUSTODY</p><h1>Set it. Cap it.<br /><span>Let it run.</span></h1><p className="lede">Build self-running stock-token strategies with hard spending limits, live health checks and a kill switch you control.</p></div>
            <div className="hero-command"><button className="primary-action" onClick={() => openComposer()}><span>+</span> Build an automation</button><div className="hero-proof"><span>V6 ROUTE ENGINE</span><strong>25 canonical assets indexed</strong><small>13 quoted now · 25 tests · 0 broadcast</small></div></div>
          </div>

          <div className="feature-dock">
            <button onClick={() => openComposer()}><span>01</span><div><strong>Shadow Lab</strong><small>Simulate before funds move</small></div><b>&rarr;</b></button>
            <button onClick={() => setView("controls")}><span>02</span><div><strong>Permission Center</strong><small>Inspect every spending cap</small></div><b>&rarr;</b></button>
            <button onClick={() => setView("assets")}><span>03</span><div><strong>Asset Matrix</strong><small>25 canonical Robinhood assets</small></div><b>&rarr;</b></button>
          </div>

          <div className="overview-grid">
            <article className="balance-card dark-card">
              <div className="card-label"><span>{connected ? "CONNECTED WALLET" : "SAMPLE PORTFOLIO"}</span><span className="live-label"><i /> {connected ? "TESTNET" : "PREVIEW"}</span></div>
              <div className="balance-line"><strong>{connected ? `${walletBalance} ETH` : "$12,804.62"}</strong><span>{connected ? compactAddress(walletAddress) : "+$284.17 today"}</span></div>
              <div className="chart" aria-label="Portfolio performance chart"><div className="chart-area" /><div className="chart-line" /><div className="chart-dot" /><div className="chart-labels"><span>09 JUL</span><span>11 JUL</span><span>13 JUL</span><span>TODAY</span></div></div>
              <div className="balance-foot"><span>30D return <b>+7.42%</b></span><span>Automated volume <b>$2,480</b></span><span>Avg. slippage <b>0.08%</b></span></div>
            </article>
            <article className="stats-stack">
              <div className="stat-card"><span>PREPARED STRATEGIES</span><strong>{preparedCount}</strong><small>{shadowCount} in shadow mode</small><div className="mini-bars"><i /><i /><i /><i /><i /><i /></div></div>
              <div className="stat-card fee-card"><span>STRATEGY HEALTH</span><strong>94</strong><small>All systems normal</small><b className="delta">HEALTHY</b></div>
            </article>
          </div>

          <div className="section-title"><div><p className="eyebrow">SAFE WORKSPACE</p><h2>Strategy workspace</h2></div><button onClick={() => setView("strategies")}>View all <span>&rarr;</span></button></div>
          <div className="strategy-list">
            {strategies.slice(0, 3).map((item) => <StrategyRow key={item.id} item={item} onToggle={() => toggleStrategy(item.id)} onInspect={() => setSelectedStrategy(item)} />)}
          </div>

          <div className="trust-strip">
            <div><span className="trust-icon">P</span><p><strong>Bounded permissions</strong><small>Every strategy has an asset allowlist, spending cap and expiry.</small></p></div>
            <div><span className="trust-icon">S</span><p><strong>Shadow Mode first</strong><small>Simulate live conditions before a strategy can touch funds.</small></p></div>
            <button onClick={() => setView("controls")}>Open controls &rarr;</button>
          </div>
        </section>
      )}

      {view === "strategies" && (
        <section className="page inner-page">
          <div className="inner-heading"><div><p className="eyebrow">AUTOMATION DESK</p><h1>Strategies</h1><p>Every rule, limit and execution state in one place.</p></div><button className="primary-action" onClick={() => openComposer()}><span>+</span> New strategy</button></div>
          <div className="summary-row"><div><span>Prepared</span><strong>{preparedCount}</strong></div><div><span>Shadow mode</span><strong>{shadowCount}</strong></div><div><span>Simulated volume</span><strong>$2,480</strong></div><div><span>Estimated fees</span><strong>$2.48</strong></div></div>
          <div className="table-card">
            <div className="table-head upgraded"><span>STRATEGY</span><span>RULE</span><span>NEXT ACTION</span><span>HEALTH</span><span>STATUS</span><span /></div>
            {strategies.map((item) => <StrategyRow key={item.id} item={item} detailed onToggle={() => toggleStrategy(item.id)} onInspect={() => setSelectedStrategy(item)} />)}
          </div>
        </section>
      )}

      {view === "assets" && (
        <section className="page inner-page assets-page">
          <div className="asset-hero">
            <div><p className="eyebrow">ROBINHOOD ASSET MATRIX</p><h1>Twenty-five assets.<br /><span>One route engine.</span></h1><p>Every canonical Robinhood stock token and ETF is indexed. The keeper quotes all reviewed V4 pool types before each execution and skips assets without a viable route.</p></div>
            <div className="asset-totals"><div><strong>25</strong><span>CANONICAL</span></div><div><strong>13</strong><span>QUOTED NOW</span></div><div><strong>12</strong><span>WATCH-ONLY</span></div></div>
          </div>
          <div className="asset-toolbar">
            <div>{(["all", "routed", "registry"] as const).map((scope) => <button key={scope} className={assetScope === scope ? "selected" : ""} onClick={() => setAssetScope(scope)}>{scope === "all" ? "All 25" : scope === "routed" ? "Route ready" : "Watch-only"}</button>)}</div>
            <label><span>Q</span><input aria-label="Search assets" placeholder="Ticker or company" value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} /></label>
          </div>
          <div className="asset-table">
            <div className="asset-table-head"><span>ASSET</span><span>TYPE</span><span>V4 ROUTE</span><span>EXECUTION POLICY</span></div>
            {visibleAssets.map(([ticker, name, type, routed]) => <article className="asset-catalog-row" key={ticker}><div><Mark ticker={ticker} /><p><strong>{ticker}</strong><small>{name}</small></p></div><span className="asset-type">{type}</span><b className={routed ? "route-ready" : "route-watch"}><i />{routed ? "Quoted" : "Watch-only"}</b><p className="asset-policy">{routed ? "Best of 3 reviewed pools" : "Keeper skips until a quote exists"}</p></article>)}
          </div>
          <p className="asset-footnote">Route status is a verified infrastructure snapshot, not a liquidity guarantee. Every execution is quoted again immediately before broadcast.</p>
        </section>
      )}

      {view === "marketplace" && (
        <section className="page inner-page">
          <div className="market-hero"><p className="eyebrow">MARKETPLACE PREVIEW</p><h1>Copy the rules.<br />Keep control.</h1><p>Explore editable strategy concepts now. Verified execution proofs and creator payouts unlock only after the testnet indexer is live.</p></div>
          <div className="market-toolbar"><div><button className="selected">Featured</button><button>Most copied</button><button>Lowest risk</button></div><label><span>Q</span><input aria-label="Search strategies" placeholder="Search strategies" /></label></div>
          <div className="market-grid">
            {marketplace.map((item, index) => (
              <article className="market-card" key={item.name}>
                <div className="market-number">0{index + 1}</div><div className="market-top"><span className={`risk risk-${index}`}>{item.risk}</span><span>{item.fee} creator fee</span></div>
                <h2>{item.name}</h2><p>{item.desc}</p><div className="asset-pile">{item.assets.map((asset) => <Mark key={asset} ticker={asset} small />)}</div>
                <div className="market-metrics triple"><div><span>30D VOLUME</span><strong>{item.volume}</strong></div><div><span>MAX DRAWDOWN</span><strong>{item.drawdown}</strong></div><div><span>LIVE AGE</span><strong>{item.age}</strong></div></div>
                <div className="creator"><span>by {item.author}</span><button onClick={() => copyStrategy(item.name)}>{copied === item.name ? "Added" : "Copy safely"}</button></div>
              </article>
            ))}
          </div>
          <p className="market-note">Preview metrics are illustrative, not live performance or a promise of future returns.</p>
        </section>
      )}

      {view === "activity" && (
        <section className="page inner-page">
          <div className="inner-heading"><div><p className="eyebrow">AUDIT TRAIL PREVIEW</p><h1>Activity</h1><p>The event model for authorizations, checks, executions and fees. Live events begin after deployment.</p></div><button className="secondary-action" onClick={() => notify("Demo CSV export prepared")}>Export demo CSV</button></div>
          <div className="activity-card">
            {[
              ["DCA simulation", "Monday Apple", "20 USDG -> 0.0947 AAPL", "2 minutes ago", "Preview"],
              ["Oracle freshness checked", "Monday Apple", "Age 34s · within 120s limit", "2 minutes ago", "Passed"],
              ["Shadow execution", "NVDA trim", "Target +15% · Current +9.4%", "Yesterday", "No action"],
              ["Strategy paused", "Core balance", "Permission paused by owner", "12 Jul, 18:42", "Confirmed"],
              ["Slippage protected", "Monday Apple", "Quote 0.0951 · received 0.0950", "08 Jul, 09:30", "Passed"],
            ].map((event, index) => <div className="activity-row" key={event[0] + index}><span className={`activity-symbol symbol-${index}`}>{index === 2 ? "S" : index === 3 ? "II" : "OK"}</span><div><strong>{event[0]}</strong><small>{event[1]}</small></div><p>{event[2]}</p><time>{event[3]}</time><span className="activity-status">{event[4]}</span></div>)}
          </div>
        </section>
      )}

      {view === "controls" && (
        <section className="page inner-page controls-page">
          <div className="inner-heading"><div><p className="eyebrow">PERMISSION CENTER</p><h1>You hold the keys.</h1><p>Review every allowance, expiry and safety condition before it can execute.</p></div><button className="danger-action" onClick={() => setConfirmStop(true)}>Pause everything</button></div>
          <div className="control-grid">
            <article className="control-card control-score"><span>PROTOCOL READINESS</span><strong>6<span>/8 gates</span></strong><p>Core, asset registry, oracle defense, route engine, keeper and product checks are complete.</p><div className="score-line"><i /></div></article>
            <article className="control-card"><span>MAINNET INFRA</span><strong>13 routes</strong><p>34 bytecode checks · 25 canonical assets · local fork swaps</p><b className="control-ok">VERIFIED</b></article>
            <article className="control-card"><span>CONTRACT</span><strong>{contractStatus}</strong><p>{contractConfigured ? compactAddress(CONTRACT_ADDRESS) : "No live contract is being claimed."}</p><b className={`control-ok ${contractConfigured && contractStatus !== "Bytecode verified" ? "warning" : ""}`}>{contractStatus === "Bytecode verified" ? "ONCHAIN" : "GATED"}</b></article>
          </div>
          <div className="readiness-board">
            <div className="readiness-head"><div><p className="eyebrow">MAINNET GATES</p><h2>Ship only when every gate is green.</h2></div><span>6 of 8 complete</span></div>
            {[
              ["01", "Protocol core", "25/25 engine, oracle and adapter safety tests passing", "complete"],
              ["02", "Bounded V4 adapter", "Hookless direct pools, fixed actions, temporary approvals", "complete"],
              ["03", "Canonical asset registry", "20 stocks + 5 ETFs and 34 bytecode targets verified", "complete"],
              ["04", "Dynamic route engine", "Best quote across 3 reviewed V4 pool configurations", "complete"],
              ["05", "Oracle defense", "Sequencer grace period, staleness and token pause guards", "complete"],
              ["06", "Keeper + product", "Preflight simulation, spending limits and kill switch UX", "complete"],
              ["07", "Capped canary", "Deploy feeds and run one monitored low-limit strategy", "pending"],
              ["08", "Independent audit", "Resolve findings and move ownership to timelocked multisig", "locked"],
            ].map((gate) => <div className="readiness-row" key={gate[0]}><span>{gate[0]}</span><p><strong>{gate[1]}</strong><small>{gate[2]}</small></p><b className={`gate-${gate[3]}`}>{gate[3]}</b></div>)}
          </div>
          <div className="permissions-card">
            <div className="permissions-head"><div><p className="eyebrow">LOCAL POLICY DRAFTS</p><h2>Strategy permissions</h2></div><span>{strategies.length} policies</span></div>
            {strategies.map((item) => <div className="permission-row" key={item.id}><div className="permission-name"><Mark ticker={item.asset === "4 assets" ? "4" : item.asset} /><p><strong>{item.name}</strong><small>{item.asset} only</small></p></div><div><span>SPENDING CAP</span><strong>{item.budget}</strong></div><div><span>EXPIRES</span><strong>{item.expires}</strong></div><div><span>HEALTH</span><strong>{item.health}/100</strong></div><button onClick={() => toggleStrategy(item.id)}>{item.status === "Prepared" ? "Pause" : "Prepare"}</button></div>)}
          </div>
          <div className="safety-notes"><article><span>01</span><div><strong>Asset allowlist</strong><p>A strategy cannot swap into a token that was not approved when it was created.</p></div></article><article><span>02</span><div><strong>Hard budget caps</strong><p>Keepers cannot execute above the per-trade or lifetime spending limit.</p></div></article><article><span>03</span><div><strong>Automatic circuit breaker</strong><p>Stale prices, excess slippage or low liquidity stop execution before a swap.</p></div></article></div>
        </section>
      )}

      <footer><span>HoodFlow Labs · Robinhood Chain Testnet</span><div><button onClick={() => setView("controls")}>Security</button><button>Docs</button><button>Terms</button></div><span className="testnet-tag"><i /> MAINNET LOCKED</span></footer>

      {composerOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setComposerOpen(false); }}>
          <section className="composer wide-composer" role="dialog" aria-modal="true" aria-labelledby="composer-title">
            <div className="composer-head"><div><p className="eyebrow">NEW AUTOMATION</p><h2 id="composer-title">Build with limits.</h2></div><button aria-label="Close strategy builder" onClick={() => setComposerOpen(false)}>x</button></div>
            <div className="kind-grid">
              {(["DCA", "Take profit", "Rebalance"] as StrategyKind[]).map((item) => <button type="button" key={item} className={kind === item ? "selected" : ""} onClick={() => openComposer(item)}><span>{item === "DCA" ? "01" : item === "Take profit" ? "02" : "03"}</span><strong>{item}</strong><small>{item === "DCA" ? "Buy on a schedule" : item === "Take profit" ? "Trim at your target" : "Keep target weights"}</small></button>)}
            </div>
            <form onSubmit={createStrategy}>
              <label>STRATEGY NAME<input name="name" value={draftName} onChange={(event) => setDraftName(event.target.value)} required /></label>
              {kind !== "Rebalance" && <label>ASSET<select name="asset" value={draftAsset} onChange={(event) => setDraftAsset(event.target.value)}>{Object.entries(assetMeta).map(([ticker, meta]) => <option key={ticker} value={ticker}>{ticker} · {meta.name}</option>)}</select></label>}
              <div className="form-pair">
                <label>{kind === "DCA" ? "AMOUNT" : kind === "Take profit" ? "POSITION TO SELL" : "DRIFT LIMIT"}<span className="input-unit"><input name="amount" type="number" min="1" value={draftAmount} onChange={(event) => setDraftAmount(event.target.value)} required /><b>{kind === "DCA" ? "USDG" : "%"}</b></span></label>
                <label>{kind === "DCA" ? "SCHEDULE" : kind === "Take profit" ? "PROFIT TARGET" : "CHECK"}{kind === "DCA" ? <select name="frequency" value={draftFrequency} onChange={(event) => setDraftFrequency(event.target.value)}><option>Monday</option><option>Friday</option><option>day</option><option>month</option></select> : <span className="input-unit"><input name="frequency" type="number" min="1" value={draftFrequency} onChange={(event) => setDraftFrequency(event.target.value)} /><b>{kind === "Take profit" ? "%" : "HR"}</b></span>}</label>
              </div>
              <button type="button" className={`shadow-toggle ${shadowMode ? "on" : ""}`} onClick={() => setShadowMode((current) => !current)}><i /><span><strong>Start in Shadow Mode</strong><small>Run against live prices without moving funds.</small></span><b>{shadowMode ? "ON" : "OFF"}</b></button>
              <div className="execution-preview"><div className="preview-head"><span>EXECUTION PREVIEW</span><b>{shadowMode ? "NO FUNDS AT RISK" : "TESTNET AUTHORIZATION"}</b></div><div className="preview-grid"><p><span>Estimated receive</span><strong>{kind === "DCA" ? `${estimatedUnits} ${draftAsset}` : "Condition based"}</strong></p><p><span>Protocol fee</span><strong>{kind === "DCA" ? `${(Number(draftAmount || 0) * .001).toFixed(3)} USDG` : "0.10%"}</strong></p><p><span>Max slippage</span><strong>0.50%</strong></p><p><span>Price freshness</span><strong>120s max</strong></p></div></div>
              <div className="limit-note"><span>✓</span><p><strong>Spending limits stay enforced onchain.</strong><small>HoodFlow cannot move funds outside this strategy&apos;s asset, budget and expiry rules.</small></p></div>
              <div className="composer-actions"><button type="button" onClick={() => setComposerOpen(false)}>Cancel</button><button type="submit" className="primary-action">{shadowMode ? "Start simulation" : "Prepare authorization"} <span>&rarr;</span></button></div>
            </form>
          </section>
        </div>
      )}

      {selectedStrategy && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedStrategy(null); }}><section className="detail-drawer" role="dialog" aria-modal="true" aria-label={`${selectedStrategy.name} details`}><div className="composer-head"><div><p className="eyebrow">STRATEGY HEALTH</p><h2>{selectedStrategy.name}</h2></div><button onClick={() => setSelectedStrategy(null)}>x</button></div><div className="health-hero"><strong>{selectedStrategy.health}</strong><span>/100</span><p>Healthy</p></div><div className="health-checks"><div><span>Oracle rule</span><strong>120s max <b>PASS</b></strong></div><div><span>Budget rule</span><strong>Bounded <b>PASS</b></strong></div><div><span>Keeper rule</span><strong>Allowlisted <b>PASS</b></strong></div><div><span>Slippage rule</span><strong>0.50% <b>PASS</b></strong></div></div><div className="permission-summary"><p><span>Asset access</span><strong>{selectedStrategy.asset} only</strong></p><p><span>Spending cap</span><strong>{selectedStrategy.budget}</strong></p><p><span>Permission expires</span><strong>{selectedStrategy.expires}</strong></p></div><button className="drawer-action" onClick={() => { toggleStrategy(selectedStrategy.id); setSelectedStrategy(null); }}>{selectedStrategy.status === "Prepared" ? "Pause strategy" : "Prepare strategy"}</button></section></div>}

      {confirmStop && <div className="confirm-backdrop"><section className="confirm-card" role="alertdialog" aria-modal="true"><p className="eyebrow">EMERGENCY CONTROL</p><h2>Pause every strategy?</h2><p>No new executions will be prepared. Your assets stay in your wallet and existing history remains available.</p><div><button onClick={() => setConfirmStop(false)}>Cancel</button><button onClick={stopAllStrategies}>Pause everything</button></div></section></div>}
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}

function StrategyRow({ item, detailed = false, onToggle, onInspect }: { item: Strategy; detailed?: boolean; onToggle: () => void; onInspect: () => void }) {
  return <article className={`strategy-row ${detailed ? "detailed upgraded" : ""}`}><div className="strategy-name"><Mark ticker={item.asset === "4 assets" ? "4" : item.asset} /><p><strong>{item.name}</strong><small>{item.kind} · {item.asset}</small></p></div><div className="rule-cell"><span>{detailed ? "" : "RULE"}</span><strong>{item.rule}</strong></div><div className="next-cell"><span>{detailed ? "" : "NEXT"}</span><strong>{item.next}</strong></div>{detailed && <div className="health-cell"><strong>{item.health}</strong><span>/100</span></div>}<button className={`status-button ${item.status.toLowerCase()}`} onClick={onToggle}><i />{item.status}</button><button className="row-more" onClick={onInspect} aria-label={`Inspect ${item.name}`}>DETAILS</button></article>;
}
