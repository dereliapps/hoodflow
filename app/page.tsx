/* eslint-disable @next/next/no-img-element -- local brand marks are intentionally served as original logo assets. */
"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type View = "overview" | "strategies" | "assets" | "marketplace" | "activity" | "controls";
type StrategyKind = "DCA" | "Take profit" | "Rebalance";
type StrategyStatus = "Prepared" | "Paused" | "Shadow";
type MarketplaceSort = "featured" | "copied" | "risk";
type InfoPanel = "docs" | "terms";

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
  { ticker: "AAPL", name: "Apple", type: "Stock", fullFill: true, logo: "/logos/AAPL.png" },
  { ticker: "AMD", name: "AMD", type: "Stock", fullFill: true, logo: "/logos/AMD.png" },
  { ticker: "AMZN", name: "Amazon", type: "Stock", fullFill: true, logo: "/logos/AMZN.png" },
  { ticker: "BABA", name: "Alibaba", type: "Stock", fullFill: false, logo: "/logos/BABA.png" },
  { ticker: "BE", name: "Bloom Energy", type: "Stock", fullFill: false, logo: "/logos/BE.png" },
  { ticker: "COIN", name: "Coinbase", type: "Stock", fullFill: false, logo: "/logos/COIN.png" },
  { ticker: "CRCL", name: "Circle", type: "Stock", fullFill: false, logo: "/logos/CRCL.png" },
  { ticker: "CRWV", name: "CoreWeave", type: "Stock", fullFill: false, logo: "/logos/CRWV.png" },
  { ticker: "GOOGL", name: "Alphabet", type: "Stock", fullFill: true, logo: "/logos/GOOGL.png" },
  { ticker: "INTC", name: "Intel", type: "Stock", fullFill: true, logo: "/logos/INTC.png" },
  { ticker: "META", name: "Meta", type: "Stock", fullFill: true, logo: "/logos/META.png" },
  { ticker: "MSFT", name: "Microsoft", type: "Stock", fullFill: false, logo: "/logos/MSFT.png" },
  { ticker: "MU", name: "Micron", type: "Stock", fullFill: true, logo: "/logos/MU.png" },
  { ticker: "NVDA", name: "NVIDIA", type: "Stock", fullFill: true, logo: "/logos/NVDA.png" },
  { ticker: "ORCL", name: "Oracle", type: "Stock", fullFill: false, logo: "/logos/ORCL.png" },
  { ticker: "PLTR", name: "Palantir", type: "Stock", fullFill: false, logo: "/logos/PLTR.png" },
  { ticker: "SNDK", name: "Sandisk", type: "Stock", fullFill: true, logo: "/logos/SNDK.png" },
  { ticker: "SPCX", name: "SpaceX", type: "Stock", fullFill: true, logo: "/logos/SPCX.png" },
  { ticker: "TSLA", name: "Tesla", type: "Stock", fullFill: true, logo: "/logos/TSLA.png" },
  { ticker: "USAR", name: "USA Rare Earth", type: "Stock", fullFill: false, logo: "/logos/USAR.png" },
  { ticker: "QQQ", name: "Invesco QQQ", type: "ETF", fullFill: true, logo: "/logos/QQQ.png" },
  { ticker: "SGOV", name: "iShares 0-3 Month Treasury", type: "ETF", fullFill: false, logo: "/logos/SGOV.png" },
  { ticker: "SLV", name: "iShares Silver Trust", type: "ETF", fullFill: false, logo: "/logos/SLV.png" },
  { ticker: "SPY", name: "SPDR S&P 500", type: "ETF", fullFill: true, logo: "/logos/SPY.png" },
  { ticker: "CUSO", name: "United States Oil Fund", type: "ETF", fullFill: false, logo: "/logos/CUSO.png" },
] as const;

const assetByTicker = Object.fromEntries(assetRegistry.map((asset) => [asset.ticker, asset])) as Record<string, (typeof assetRegistry)[number]>;

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

const activityEvents = [
  { ticker: "AAPL", event: "DCA simulation", strategy: "Monday Apple", detail: "20 USDG -> 0.0947 AAPL", time: "2 minutes ago", status: "Preview" },
  { ticker: "AAPL", event: "Oracle freshness checked", strategy: "Monday Apple", detail: "Age 34s · within 120s limit", time: "2 minutes ago", status: "Passed" },
  { ticker: "NVDA", event: "Shadow execution", strategy: "NVDA trim", detail: "Target +15% · Current +9.4%", time: "Yesterday", status: "No action" },
  { ticker: "4", event: "Strategy paused", strategy: "Core balance", detail: "Permission paused by owner", time: "12 Jul, 18:42", status: "Confirmed" },
  { ticker: "AAPL", event: "Slippage protected", strategy: "Monday Apple", detail: "Quote 0.0951 · received 0.0950", time: "08 Jul, 09:30", status: "Passed" },
] as const;

function Mark({ ticker, small = false }: { ticker: string; small?: boolean }) {
  const asset = assetByTicker[ticker];
  if (asset) {
    return <span className={`asset-mark logo-mark ${small ? "small" : ""}`} title={`${asset.name} (${asset.ticker})`}><img src={asset.logo} alt="" width={40} height={40} loading="lazy" decoding="async" /></span>;
  }
  const bg = ticker === "USDG" ? "#26c281" : "#24282b";
  return <span className={`asset-mark ${small ? "small" : ""}`} style={{ "--mark": bg } as React.CSSProperties}>{ticker === "USDG" ? "$" : ticker}</span>;
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
  const [marketSearch, setMarketSearch] = useState("");
  const [marketSort, setMarketSort] = useState<MarketplaceSort>("featured");
  const [infoPanel, setInfoPanel] = useState<InfoPanel | null>(null);

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

  function exportActivity() {
    const escapeCell = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = [
      ["Asset", "Event", "Strategy", "Detail", "Time", "Status"],
      ...activityEvents.map((event) => [event.ticker, event.event, event.strategy, event.detail, event.time, event.status]),
    ];
    const csv = rows.map((row) => row.map(escapeCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "hoodflow-demo-activity.csv";
    link.click();
    URL.revokeObjectURL(url);
    notify("Demo activity CSV downloaded");
  }

  const visibleAssets = assetRegistry.filter(({ ticker, name, fullFill }) => {
    const matchesScope = assetScope === "all" || (assetScope === "routed" ? fullFill : !fullFill);
    const query = assetSearch.trim().toLowerCase();
    return matchesScope && (!query || ticker.toLowerCase().includes(query) || name.toLowerCase().includes(query));
  });
  const visibleMarketplace = useMemo(() => {
    const query = marketSearch.trim().toLowerCase();
    const filtered = marketplace.filter((item) => !query || [item.name, item.desc, ...item.assets].some((value) => value.toLowerCase().includes(query)));
    if (marketSort === "copied") return [...filtered].sort((left, right) => right.users - left.users);
    if (marketSort === "risk") return [...filtered].sort((left, right) => Math.abs(Number.parseFloat(left.drawdown)) - Math.abs(Number.parseFloat(right.drawdown)));
    return filtered;
  }, [marketSearch, marketSort]);
  const navigation: View[] = ["overview", "strategies", "assets", "marketplace", "activity", "controls"];

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("overview")} aria-label="HoodFlow home">
          <span className="brand-mark"><i /><i /><i /></span><span>hoodflow</span><b className="version-badge">V7</b>
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
          <div className="market-state"><span><i /> TESTNET RPC ONLINE</span><span>Block #{networkBlock}</span><span>25/25 safety tests · 13 full-fill routes</span></div>
          <div className="page-heading">
            <div><p className="eyebrow">AUTOMATION WITHOUT CUSTODY</p><h1>Set it. Cap it.<br /><span>Let it run.</span></h1><p className="lede">Build self-running stock-token strategies with hard spending limits, live health checks and a kill switch you control.</p></div>
            <div className="hero-command"><button className="primary-action" onClick={() => openComposer()}><span>+</span> Build an automation</button><div className="hero-proof"><span>V7 SAFETY PREVIEW</span><strong>25 official assets indexed</strong><small>13 full-fill ready · 2/2 canary runs · 0 broadcast</small></div></div>
          </div>

          <div className="feature-dock">
            <button onClick={() => openComposer()}><span>01</span><div><strong>Shadow Lab</strong><small>Simulate before funds move</small></div><b>&rarr;</b></button>
            <button onClick={() => setView("controls")}><span>02</span><div><strong>Permission Center</strong><small>Inspect every spending cap</small></div><b>&rarr;</b></button>
            <button onClick={() => setView("assets")}><span>03</span><div><strong>Asset Matrix</strong><small>25 canonical Robinhood assets</small></div><b>&rarr;</b></button>
          </div>

          <div className="preview-callout"><div><strong>Explore safely today</strong><span>Browse every official asset, build a strategy and test it in Shadow Mode.</span></div><b>NO MAINNET ORDERS</b></div>

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

          <div className="section-title how-title"><div><p className="eyebrow">HOW HOODFLOW WORKS</p><h2>Three steps. You stay in control.</h2></div><button onClick={() => setView("assets")}>See ready assets <span>&rarr;</span></button></div>
          <div className="how-grid">
            <article><span>01</span><div><strong>Choose an asset</strong><p>Pick from 13 full-fill verified assets. Watch-only assets stay visible but cannot prepare an order.</p></div></article>
            <article><span>02</span><div><strong>Set hard limits</strong><p>Choose the amount, schedule and expiry. The keeper cannot spend outside those rules.</p></div></article>
            <article><span>03</span><div><strong>Simulate first</strong><p>Shadow Mode shows what would happen without moving funds. Mainnet remains locked.</p></div></article>
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
            <div><p className="eyebrow">ROBINHOOD ASSET MATRIX</p><h1>Twenty-five assets.<br /><span>Clearly explained.</span></h1><p>Every canonical Robinhood stock token and ETF is indexed with its real brand mark. HoodFlow only enables assets that completed a full-input fork swap; everything else stays safely watch-only.</p></div>
            <div className="asset-totals"><div><strong>25</strong><span>OFFICIAL ASSETS</span></div><div><strong>13</strong><span>FULL-FILL READY</span></div><div><strong>12</strong><span>WATCH-ONLY</span></div></div>
          </div>
          <div className="asset-logo-cloud" aria-label="All supported brands">{assetRegistry.map((asset) => <Mark key={asset.ticker} ticker={asset.ticker} small />)}<span>20 stocks + 5 ETFs</span></div>
          <div className="route-explainer"><div><b className="route-ready"><i />READY</b><p><strong>Can be simulated</strong><span>A full-input fork swap passed. The route is quoted again before every execution.</span></p></div><div><b className="route-watch"><i />WATCH</b><p><strong>Visible, never forced</strong><span>No order is prepared until a full-fill route passes. MSFT has a quote but remains blocked after a partial fill.</span></p></div></div>
          <div className="asset-toolbar">
            <div>{(["all", "routed", "registry"] as const).map((scope) => <button key={scope} className={assetScope === scope ? "selected" : ""} onClick={() => setAssetScope(scope)}>{scope === "all" ? "All 25" : scope === "routed" ? "Full-fill ready" : "Watch-only"}</button>)}</div>
            <label><span>Q</span><input aria-label="Search assets" placeholder="Ticker or company" value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} /></label>
          </div>
          <p className="result-count">Showing {visibleAssets.length} of 25 assets</p>
          <div className="asset-table">
            <div className="asset-table-head"><span>ASSET</span><span>TYPE</span><span>STATUS</span><span>WHAT HOODFLOW WILL DO</span></div>
            {visibleAssets.map(({ ticker, name, type, fullFill }) => <article className="asset-catalog-row" key={ticker}><div><Mark ticker={ticker} /><p><strong>{ticker}</strong><small>{name}</small></p></div><span className="asset-type">{type}</span><b className={fullFill ? "route-ready" : "route-watch"}><i />{fullFill ? "Ready" : "Watch-only"}</b><p className="asset-policy">{fullFill ? "Requote, preflight, then prepare" : ticker === "MSFT" ? "Partial fill detected — block the order" : "No full-fill route — skip the order"}</p></article>)}
            {visibleAssets.length === 0 && <div className="empty-state"><strong>No matching asset</strong><span>Try another ticker or clear the current filter.</span></div>}
          </div>
          <p className="asset-footnote">Status is a verified infrastructure snapshot, not a liquidity guarantee or investment recommendation. Every execution must pass a fresh quote and preflight check.</p>
        </section>
      )}

      {view === "marketplace" && (
        <section className="page inner-page">
          <div className="market-hero"><p className="eyebrow">MARKETPLACE PREVIEW</p><h1>Copy the rules.<br />Keep control.</h1><p>Explore editable strategy concepts now. Verified execution proofs and creator payouts unlock only after the testnet indexer is live.</p></div>
          <div className="market-toolbar"><div>{(["featured", "copied", "risk"] as MarketplaceSort[]).map((sort) => <button key={sort} className={marketSort === sort ? "selected" : ""} onClick={() => setMarketSort(sort)}>{sort === "featured" ? "Featured" : sort === "copied" ? "Most copied" : "Lowest drawdown"}</button>)}</div><label><span>Q</span><input aria-label="Search strategies" placeholder="Strategy or ticker" value={marketSearch} onChange={(event) => setMarketSearch(event.target.value)} /></label></div>
          <div className="market-grid">
            {visibleMarketplace.map((item, index) => (
              <article className="market-card" key={item.name}>
                <div className="market-number">0{index + 1}</div><div className="market-top"><span className={`risk risk-${index}`}>{item.risk}</span><span>{item.fee} creator fee</span></div>
                <h2>{item.name}</h2><p>{item.desc}</p><div className="asset-pile">{item.assets.map((asset) => <Mark key={asset} ticker={asset} small />)}</div>
                <div className="market-metrics triple"><div><span>30D VOLUME</span><strong>{item.volume}</strong></div><div><span>MAX DRAWDOWN</span><strong>{item.drawdown}</strong></div><div><span>LIVE AGE</span><strong>{item.age}</strong></div></div>
                <div className="creator"><span>by {item.author} · {item.users} copies</span><button onClick={() => copyStrategy(item.name)}>{copied === item.name ? "Added" : "Copy as draft"}</button></div>
              </article>
            ))}
            {visibleMarketplace.length === 0 && <div className="empty-state market-empty"><strong>No strategy found</strong><span>Try another name or asset ticker.</span></div>}
          </div>
          <p className="market-note">Copying creates an editable local draft. Preview metrics are illustrative, not live performance or a promise of future returns.</p>
        </section>
      )}

      {view === "activity" && (
        <section className="page inner-page">
          <div className="inner-heading"><div><p className="eyebrow">AUDIT TRAIL PREVIEW</p><h1>Activity</h1><p>The event model for authorizations, checks, executions and fees. Live events begin after deployment.</p></div><button className="secondary-action" onClick={exportActivity}>Export demo CSV</button></div>
          <div className="activity-card">
            {activityEvents.map((event, index) => <div className="activity-row" key={event.event + index}><Mark ticker={event.ticker} /><div><strong>{event.event}</strong><small>{event.strategy}</small></div><p>{event.detail}</p><time>{event.time}</time><span className="activity-status">{event.status}</span></div>)}
          </div>
        </section>
      )}

      {view === "controls" && (
        <section className="page inner-page controls-page">
          <div className="inner-heading"><div><p className="eyebrow">PERMISSION CENTER</p><h1>You hold the keys.</h1><p>Review every allowance, expiry and safety condition before it can execute.</p></div><button className="danger-action" onClick={() => setConfirmStop(true)}>Pause everything</button></div>
          <div className="control-grid">
            <article className="control-card control-score"><span>PROTOCOL READINESS</span><strong>7<span>/9 gates</span></strong><p>Core, routes, oracle defense and the full-engine fork canary are complete.</p><div className="score-line"><i /></div></article>
            <article className="control-card"><span>MAINNET INFRA</span><strong>13 full-fill</strong><p>14 quote-ready · 34 bytecode checks · local fork swaps</p><b className="control-ok">VERIFIED</b></article>
            <article className="control-card"><span>CONTRACT</span><strong>{contractStatus}</strong><p>{contractConfigured ? compactAddress(CONTRACT_ADDRESS) : "No live contract is being claimed."}</p><b className={`control-ok ${contractConfigured && contractStatus !== "Bytecode verified" ? "warning" : ""}`}>{contractStatus === "Bytecode verified" ? "ONCHAIN" : "GATED"}</b></article>
          </div>
          <div className="readiness-board">
            <div className="readiness-head"><div><p className="eyebrow">MAINNET GATES</p><h2>Ship only when every gate is green.</h2></div><span>7 of 9 complete</span></div>
            {[
              ["01", "Protocol core", "25/25 engine, oracle and adapter safety tests passing", "complete"],
              ["02", "Bounded V4 adapter", "Hookless direct pools, fixed actions, temporary approvals", "complete"],
              ["03", "Canonical asset registry", "20 stocks + 5 ETFs and 34 bytecode targets verified", "complete"],
              ["04", "Dynamic route engine", "Best quote across 3 reviewed V4 pool configurations", "complete"],
              ["05", "Oracle defense", "Sequencer grace period, staleness and token pause guards", "complete"],
              ["06", "Keeper + product", "Preflight simulation, spending limits and kill switch UX", "complete"],
              ["07", "Full-engine fork canary", "2/2 capped executions, replay blocked, zero custody and allowances", "complete"],
              ["08", "Funded network canary", "Run the same 1 USDG tranche with a 2 USDG lifetime cap", "pending"],
              ["09", "Independent audit", "Resolve findings and move ownership to timelocked multisig", "locked"],
            ].map((gate) => <div className="readiness-row" key={gate[0]}><span>{gate[0]}</span><p><strong>{gate[1]}</strong><small>{gate[2]}</small></p><b className={`gate-${gate[3]}`}>{gate[3]}</b></div>)}
          </div>
          <div className="permissions-card">
            <div className="permissions-head"><div><p className="eyebrow">LOCAL POLICY DRAFTS</p><h2>Strategy permissions</h2></div><span>{strategies.length} policies</span></div>
            {strategies.map((item) => <div className="permission-row" key={item.id}><div className="permission-name"><Mark ticker={item.asset === "4 assets" ? "4" : item.asset} /><p><strong>{item.name}</strong><small>{item.asset} only</small></p></div><div><span>SPENDING CAP</span><strong>{item.budget}</strong></div><div><span>EXPIRES</span><strong>{item.expires}</strong></div><div><span>HEALTH</span><strong>{item.health}/100</strong></div><button onClick={() => toggleStrategy(item.id)}>{item.status === "Prepared" ? "Pause" : "Prepare"}</button></div>)}
          </div>
          <div className="safety-notes"><article><span>01</span><div><strong>Asset allowlist</strong><p>A strategy cannot swap into a token that was not approved when it was created.</p></div></article><article><span>02</span><div><strong>Hard budget caps</strong><p>Keepers cannot execute above the per-trade or lifetime spending limit.</p></div></article><article><span>03</span><div><strong>Automatic circuit breaker</strong><p>Stale prices, excess slippage or low liquidity stop execution before a swap.</p></div></article></div>
        </section>
      )}

      <footer><span>HoodFlow Labs · Robinhood Chain Testnet</span><div><button onClick={() => setView("controls")}>Security</button><button onClick={() => setInfoPanel("docs")}>Quick guide</button><button onClick={() => setInfoPanel("terms")}>Testnet terms</button></div><span className="testnet-tag"><i /> MAINNET LOCKED</span></footer>

      {composerOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setComposerOpen(false); }}>
          <section className="composer wide-composer" role="dialog" aria-modal="true" aria-labelledby="composer-title">
            <div className="composer-head"><div><p className="eyebrow">NEW AUTOMATION</p><h2 id="composer-title">Build with limits.</h2></div><button aria-label="Close strategy builder" onClick={() => setComposerOpen(false)}>x</button></div>
            <div className="kind-grid">
              {(["DCA", "Take profit", "Rebalance"] as StrategyKind[]).map((item) => <button type="button" key={item} className={kind === item ? "selected" : ""} onClick={() => openComposer(item)}><span>{item === "DCA" ? "01" : item === "Take profit" ? "02" : "03"}</span><strong>{item}</strong><small>{item === "DCA" ? "Buy on a schedule" : item === "Take profit" ? "Trim at your target" : "Keep target weights"}</small></button>)}
            </div>
            <form onSubmit={createStrategy}>
              <label>STRATEGY NAME<input name="name" value={draftName} onChange={(event) => setDraftName(event.target.value)} required /></label>
              {kind !== "Rebalance" && <div className="asset-choice"><Mark ticker={draftAsset} /><label>ASSET <small>13 full-fill verified assets</small><select name="asset" value={draftAsset} onChange={(event) => setDraftAsset(event.target.value)}>{Object.entries(assetMeta).map(([ticker, meta]) => <option key={ticker} value={ticker}>{ticker} · {meta.name}</option>)}</select></label></div>}
              <div className="form-pair">
                <label>{kind === "DCA" ? "AMOUNT" : kind === "Take profit" ? "POSITION TO SELL" : "DRIFT LIMIT"}<span className="input-unit"><input name="amount" type="number" min="1" value={draftAmount} onChange={(event) => setDraftAmount(event.target.value)} required /><b>{kind === "DCA" ? "USDG" : "%"}</b></span></label>
                <label>{kind === "DCA" ? "SCHEDULE" : kind === "Take profit" ? "PROFIT TARGET" : "CHECK"}{kind === "DCA" ? <select name="frequency" value={draftFrequency} onChange={(event) => setDraftFrequency(event.target.value)}><option>Monday</option><option>Friday</option><option>day</option><option>month</option></select> : <span className="input-unit"><input name="frequency" type="number" min="1" value={draftFrequency} onChange={(event) => setDraftFrequency(event.target.value)} /><b>{kind === "Take profit" ? "%" : "HR"}</b></span>}</label>
              </div>
              <button type="button" className={`shadow-toggle ${shadowMode ? "on" : ""}`} onClick={() => setShadowMode((current) => !current)}><i /><span><strong>Start in Shadow Mode</strong><small>Run against live prices without moving funds.</small></span><b>{shadowMode ? "ON" : "OFF"}</b></button>
              <div className="execution-preview"><div className="preview-head"><span>EXECUTION PREVIEW</span><b>{shadowMode ? "NO FUNDS AT RISK" : "PREPARE ONLY · NO BROADCAST"}</b></div><div className="preview-grid"><p><span>Estimated receive</span><strong>{kind === "DCA" ? `${estimatedUnits} ${draftAsset}` : "Condition based"}</strong></p><p><span>Protocol fee</span><strong>{kind === "DCA" ? `${(Number(draftAmount || 0) * .001).toFixed(3)} USDG` : "0.10%"}</strong></p><p><span>Max slippage</span><strong>0.50%</strong></p><p><span>Price freshness</span><strong>120s max</strong></p></div></div>
              <div className="limit-note"><span>✓</span><p><strong>Spending limits stay enforced onchain.</strong><small>HoodFlow cannot move funds outside this strategy&apos;s asset, budget and expiry rules.</small></p></div>
              <div className="composer-actions"><button type="button" onClick={() => setComposerOpen(false)}>Cancel</button><button type="submit" className="primary-action">{shadowMode ? "Start simulation" : "Prepare authorization"} <span>&rarr;</span></button></div>
            </form>
          </section>
        </div>
      )}

      {selectedStrategy && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedStrategy(null); }}><section className="detail-drawer" role="dialog" aria-modal="true" aria-label={`${selectedStrategy.name} details`}><div className="composer-head"><div><p className="eyebrow">STRATEGY HEALTH</p><h2>{selectedStrategy.name}</h2></div><button onClick={() => setSelectedStrategy(null)}>x</button></div><div className="health-hero"><strong>{selectedStrategy.health}</strong><span>/100</span><p>Healthy</p></div><div className="health-checks"><div><span>Oracle rule</span><strong>120s max <b>PASS</b></strong></div><div><span>Budget rule</span><strong>Bounded <b>PASS</b></strong></div><div><span>Keeper rule</span><strong>Allowlisted <b>PASS</b></strong></div><div><span>Slippage rule</span><strong>0.50% <b>PASS</b></strong></div></div><div className="permission-summary"><p><span>Asset access</span><strong>{selectedStrategy.asset} only</strong></p><p><span>Spending cap</span><strong>{selectedStrategy.budget}</strong></p><p><span>Permission expires</span><strong>{selectedStrategy.expires}</strong></p></div><button className="drawer-action" onClick={() => { toggleStrategy(selectedStrategy.id); setSelectedStrategy(null); }}>{selectedStrategy.status === "Prepared" ? "Pause strategy" : "Prepare strategy"}</button></section></div>}

      {infoPanel && <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setInfoPanel(null); }}><section className="info-card" role="dialog" aria-modal="true" aria-labelledby="info-title"><div className="composer-head"><div><p className="eyebrow">{infoPanel === "docs" ? "QUICK GUIDE" : "TESTNET TERMS"}</p><h2 id="info-title">{infoPanel === "docs" ? "Know every status." : "Clear before you start."}</h2></div><button aria-label="Close information" onClick={() => setInfoPanel(null)}>x</button></div>{infoPanel === "docs" ? <div className="info-list"><article><span>01</span><p><strong>Shadow</strong><small>Uses live-style inputs but never moves funds.</small></p></article><article><span>02</span><p><strong>Prepared</strong><small>A reviewed local authorization draft. This release does not broadcast it.</small></p></article><article><span>03</span><p><strong>Full-fill ready</strong><small>The complete input passed the official-router fork test. A fresh quote is still required.</small></p></article><article><span>04</span><p><strong>Watch-only</strong><small>The asset is visible, but HoodFlow blocks order preparation.</small></p></article></div> : <div className="info-copy"><p>HoodFlow is a testnet product preview, not a live brokerage or investment adviser.</p><p>Portfolio values, marketplace activity and performance figures are illustrative. No return is promised.</p><p>Mainnet stays locked until the funded network canary and independent contract audit are complete.</p></div>}<button className="drawer-action" onClick={() => setInfoPanel(null)}>Got it</button></section></div>}

      {confirmStop && <div className="confirm-backdrop"><section className="confirm-card" role="alertdialog" aria-modal="true"><p className="eyebrow">EMERGENCY CONTROL</p><h2>Pause every strategy?</h2><p>No new executions will be prepared. Your assets stay in your wallet and existing history remains available.</p><div><button onClick={() => setConfirmStop(false)}>Cancel</button><button onClick={stopAllStrategies}>Pause everything</button></div></section></div>}
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}

function StrategyRow({ item, detailed = false, onToggle, onInspect }: { item: Strategy; detailed?: boolean; onToggle: () => void; onInspect: () => void }) {
  return <article className={`strategy-row ${detailed ? "detailed upgraded" : ""}`}><div className="strategy-name"><Mark ticker={item.asset === "4 assets" ? "4" : item.asset} /><p><strong>{item.name}</strong><small>{item.kind} · {item.asset}</small></p></div><div className="rule-cell"><span>{detailed ? "" : "RULE"}</span><strong>{item.rule}</strong></div><div className="next-cell"><span>{detailed ? "" : "NEXT"}</span><strong>{item.next}</strong></div>{detailed && <div className="health-cell"><strong>{item.health}</strong><span>/100</span></div>}<button className={`status-button ${item.status.toLowerCase()}`} onClick={onToggle}><i />{item.status}</button><button className="row-more" onClick={onInspect} aria-label={`Inspect ${item.name}`}>DETAILS</button></article>;
}
