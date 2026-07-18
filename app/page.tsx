/* eslint-disable @next/next/no-img-element -- local brand marks are intentionally served as original logo assets. */
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  formatEther,
  formatUnits,
  parseUnits,
  type Eip1193Provider,
} from "ethers";
import {
  ERC20_ABI,
  HOODFLOW_ENGINE_ABI,
  PERMIT2_ABI,
  PERMIT2_ADDRESS,
  PERMIT2_TYPES,
  ROBINHOOD_MAINNET,
  ROBINHOOD_TOKENS,
  STOCK_TOKEN_DECIMALS,
  UNIVERSAL_ROUTER_ABI,
  UNIVERSAL_ROUTER_ADDRESS,
  USDG_ADDRESS,
  USDG_DECIMALS,
  V4_POOL_CANDIDATES,
  V4_QUOTER_ABI,
  V4_QUOTER_ADDRESS,
  buildDirectBuyCalldata,
  buildQuoteParams,
  isRoutedAsset,
  type PoolCandidate,
  type PermitSingle,
} from "@/lib/hoodflow-mainnet";
import {
  buildRobinhoodPriceRequests,
  parseRobinhoodPriceResults,
  PUBLIC_ROBINHOOD_PRICE_RPC_URL,
  type PricePoint,
  type PriceResponse,
} from "@/lib/robinhood-prices";

type View = "overview" | "strategies" | "assets" | "marketplace" | "activity" | "controls";
type StrategyKind = "Buy" | "DCA" | "Take profit" | "Rebalance";
type StrategyStatus = "Prepared" | "Paused" | "Shadow" | "Confirmed";
type MarketplaceSort = "featured" | "copied" | "risk";
type InfoPanel = "docs" | "terms";
type BootPhase = "loading" | "leaving" | "done";
type PriceState = "loading" | "live" | "degraded" | "error";

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
  txHash?: string;
  chainStrategyId?: string;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_HOODFLOW_CONTRACT_ADDRESS?.trim() ?? "";
const contractConfigured = /^0x[a-fA-F0-9]{40}$/.test(CONTRACT_ADDRESS);
const DRAFT_STORAGE_KEY = "hoodflow-device-orders-v2";
const MAX_UINT128 = (1n << 128n) - 1n;

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
const priceSpotlight = ["AAPL", "NVDA", "TSLA", "GOOGL", "SPY"] as const;

const starterStrategies: Strategy[] = [
  { id: 1, name: "Intel first buy", kind: "Buy", asset: "INTC", rule: "Buy once with 20 USDG", next: "Shadow quote preview", status: "Shadow", spent: "0 USDG", health: 100, budget: "20 USDG", expires: "Device preview" },
  { id: 2, name: "Weekly Apple", kind: "DCA", asset: "AAPL", rule: "20 USDG · weekly · 12 buys", next: "Engine deploy pending", status: "Shadow", spent: "0 USDG", health: 96, budget: "240 USDG", expires: "Device preview" },
  { id: 3, name: "NVDA trim", kind: "Take profit", asset: "NVDA", rule: "Sell 25% at +15%", next: "Shadow condition preview", status: "Shadow", spent: "0 USDG", health: 91, budget: "25% position", expires: "Device preview" },
];

const marketplace = [
  { name: "Steady Tech", author: "0x71...93F2", desc: "Weekly equal-weight DCA across AAPL, NVDA and GOOGL.", assets: ["AAPL", "NVDA", "GOOGL"], users: 428, volume: "$184k", fee: "0.05%", risk: "Measured", drawdown: "-5.8%", age: "184 days" },
  { name: "Three Kings", author: "0xA4...10BD", desc: "Momentum rotation with a strict 35% cap per position.", assets: ["NVDA", "AAPL", "GOOGL"], users: 216, volume: "$96k", fee: "0.08%", risk: "Active", drawdown: "-11.2%", age: "97 days" },
  { name: "Cash Cushion", author: "0x22...7AE1", desc: "Moves gains into USDG whenever portfolio drift exceeds 10%.", assets: ["AAPL", "NVDA", "USDG"], users: 139, volume: "$61k", fee: "0.04%", risk: "Defensive", drawdown: "-3.1%", age: "221 days" },
];

const activityEvents = [
  { ticker: "AAPL", event: "DCA simulation", strategy: "Monday Apple", detail: "20 USDG -> 0.0947 AAPL", time: "2 minutes ago", status: "Preview" },
  { ticker: "AAPL", event: "Oracle freshness checked", strategy: "Monday Apple", detail: "Age 34s · within registry heartbeat", time: "2 minutes ago", status: "Passed" },
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
  if (error && typeof error === "object") {
    const walletError = error as { code?: string | number; shortMessage?: string; reason?: string; message?: string };
    if (walletError.code === 4001 || walletError.code === "ACTION_REJECTED") return "Wallet request declined.";
    if (walletError.shortMessage) return walletError.shortMessage;
    if (walletError.reason) return walletError.reason;
    if (walletError.message) return walletError.message;
  }
  return error instanceof Error ? error.message : "The wallet request could not be completed.";
}

async function getBestV4Quote(provider: BrowserProvider, tokenOut: string, amountIn: bigint) {
  const quoter = new Contract(V4_QUOTER_ADDRESS, V4_QUOTER_ABI, provider);
  const attempts = await Promise.allSettled(V4_POOL_CANDIDATES.map(async (route) => {
    const result = await quoter.quoteExactInputSingle.staticCall(
      buildQuoteParams(tokenOut, amountIn, route),
    ) as readonly [bigint, bigint];
    const amountOut = BigInt(result[0]);
    if (amountOut <= 0n) throw new Error("Empty route");
    return { route, amountOut };
  }));
  const quotes = attempts.flatMap((attempt) => attempt.status === "fulfilled" ? [attempt.value] : []);
  if (quotes.length === 0) throw new Error("No live full-fill route is available for this amount.");
  return quotes.reduce((best, quote) => quote.amountOut > best.amountOut ? quote : best);
}

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatPrice(price: number | null | undefined) {
  return typeof price === "number" && Number.isFinite(price) ? usdFormatter.format(price) : "—";
}

function formatPriceAge(updatedAt: number | null) {
  if (!updatedAt) return "No valid round";
  const seconds = Math.max(0, Math.floor(Date.now() / 1_000) - updatedAt);
  if (seconds < 60) return "Updated now";
  if (seconds < 3_600) return `Updated ${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `Updated ${Math.floor(seconds / 3_600)}h ago`;
  return `Updated ${Math.floor(seconds / 86_400)}d ago`;
}

function PriceCell({ point, loading }: { point?: PricePoint; loading: boolean }) {
  if (loading && !point) {
    return <div className="price-cell loading"><strong>Syncing</strong><small>Chainlink feed</small></div>;
  }
  if (!point || point.price === null) {
    return <div className="price-cell unavailable"><strong>Unavailable</strong><small>No current feed</small></div>;
  }
  const detail = point.status === "paused"
    ? "Oracle paused"
    : point.status === "stale"
      ? "Stale — blocked"
      : point.status === "unavailable"
        ? "Oracle check failed"
      : formatPriceAge(point.updatedAt);
  return <div className={`price-cell ${point.status}`}><strong>{formatPrice(point.price)}</strong><small><i />{detail}</small></div>;
}

function isStoredStrategy(value: unknown): value is Strategy {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Strategy>;
  return typeof item.id === "number"
    && typeof item.name === "string"
    && ["Buy", "DCA", "Take profit", "Rebalance"].includes(item.kind ?? "")
    && typeof item.asset === "string"
    && typeof item.rule === "string"
    && typeof item.next === "string"
    && ["Prepared", "Paused", "Shadow", "Confirmed"].includes(item.status ?? "")
    && typeof item.spent === "string"
    && typeof item.health === "number"
    && typeof item.budget === "string"
    && typeof item.expires === "string";
}

export default function Home() {
  const [bootPhase, setBootPhase] = useState<BootPhase>("loading");
  const [bootProgress, setBootProgress] = useState(12);
  const [view, setView] = useState<View>("overview");
  const [walletAddress, setWalletAddress] = useState("");
  const [walletBalance, setWalletBalance] = useState("");
  const [walletUsdgBalance, setWalletUsdgBalance] = useState("");
  const [networkBlock, setNetworkBlock] = useState("Checking");
  const [contractStatus, setContractStatus] = useState(contractConfigured ? "Checking bytecode" : "Engine deploy pending");
  const [contractReady, setContractReady] = useState(false);
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
  const [draftFrequency, setDraftFrequency] = useState("Weekly");
  const [draftExecutions, setDraftExecutions] = useState("12");
  const [draftSlippage, setDraftSlippage] = useState("0.5");
  const [onchainBusy, setOnchainBusy] = useState(false);
  const [transactionStep, setTransactionStep] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const [assetSearch, setAssetSearch] = useState("");
  const [assetScope, setAssetScope] = useState<"all" | "routed" | "registry">("all");
  const [marketSearch, setMarketSearch] = useState("");
  const [marketSort, setMarketSort] = useState<MarketplaceSort>("featured");
  const [infoPanel, setInfoPanel] = useState<InfoPanel | null>(null);
  const [draftsHydrated, setDraftsHydrated] = useState(false);
  const [priceBook, setPriceBook] = useState<Record<string, PricePoint>>({});
  const [priceState, setPriceState] = useState<PriceState>("loading");
  const [priceUpdatedAt, setPriceUpdatedAt] = useState<number | null>(null);
  const [priceRefreshing, setPriceRefreshing] = useState(false);
  const [priceError, setPriceError] = useState("");

  const connected = Boolean(walletAddress);
  const preparedCount = useMemo(() => strategies.filter((item) => item.status === "Prepared").length, [strategies]);
  const shadowCount = useMemo(() => strategies.filter((item) => item.status === "Shadow").length, [strategies]);
  const confirmedCount = useMemo(() => strategies.filter((item) => item.status === "Confirmed").length, [strategies]);
  const draftTotalBudget = useMemo(() => {
    const amount = Number(draftAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    if (kind === "DCA") return amount * Math.max(1, Number.parseInt(draftExecutions, 10) || 0);
    return amount;
  }, [draftAmount, draftExecutions, kind]);
  const refreshPrices = useCallback(async (signal?: AbortSignal) => {
    setPriceRefreshing(true);
    try {
      let data: PriceResponse | null = null;
      try {
        const response = await fetch("/api/prices", {
          headers: { accept: "application/json" },
          cache: "no-store",
          signal,
        });
        if (response.ok) {
          const candidate = await response.json() as PriceResponse;
          if (candidate.prices && typeof candidate.prices === "object") data = candidate;
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
      }
      if (!data) {
        const rpcResponse = await fetch(PUBLIC_ROBINHOOD_PRICE_RPC_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(buildRobinhoodPriceRequests()),
          cache: "no-store",
          signal,
        });
        if (!rpcResponse.ok) throw new Error(`Price RPC returned ${rpcResponse.status}`);
        data = parseRobinhoodPriceResults(await rpcResponse.json());
      }
      setPriceBook(data.prices);
      setPriceUpdatedAt(Date.parse(data.fetchedAt));
      setPriceState(data.liveCount >= 24 ? "live" : "degraded");
      setPriceError("");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setPriceState((current) => current === "loading" ? "error" : "degraded");
      setPriceError("Live prices are temporarily unavailable. Existing values are not used for execution.");
    } finally {
      if (!signal?.aborted) setPriceRefreshing(false);
    }
  }, []);
  const estimatedUnits = useMemo(() => {
    const point = priceBook[draftAsset];
    if (!point?.price || point.status !== "live") return "—";
    return (Number(draftAmount || 0) / point.price).toFixed(4);
  }, [draftAmount, draftAsset, priceBook]);
  const priceCounts = useMemo(() => {
    const points = Object.values(priceBook);
    return {
      live: points.filter((point) => point.status === "live").length,
      guarded: points.filter((point) => point.status === "stale" || point.status === "paused").length,
      available: points.filter((point) => point.price !== null).length,
    };
  }, [priceBook]);
  const bootMessage = bootProgress < 32 ? "Loading official assets" : bootProgress < 60 ? "Syncing onchain prices" : bootProgress < 82 ? "Checking safety controls" : bootProgress < 100 ? "Preparing your workspace" : "Workspace ready";

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.body.classList.add("boot-locked");
    if (reducedMotion) {
      const finish = window.setTimeout(() => {
        setBootProgress(100);
        setBootPhase("done");
        document.body.classList.remove("boot-locked");
      }, 180);
      return () => {
        window.clearTimeout(finish);
        document.body.classList.remove("boot-locked");
      };
    }

    const timers = [
      window.setTimeout(() => setBootProgress(34), 220),
      window.setTimeout(() => setBootProgress(67), 560),
      window.setTimeout(() => setBootProgress(88), 920),
      window.setTimeout(() => setBootProgress(100), 1220),
      window.setTimeout(() => setBootPhase("leaving"), 1370),
      window.setTimeout(() => {
        setBootPhase("done");
        document.body.classList.remove("boot-locked");
      }, 1740),
    ];
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      document.body.classList.remove("boot-locked");
    };
  }, []);

  useEffect(() => {
    const hydrate = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(DRAFT_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as unknown;
          if (Array.isArray(parsed)) {
            const valid = parsed.filter(isStoredStrategy).slice(0, 50);
            if (valid.length > 0) setStrategies(valid);
          }
        }
      } catch {
        // Private browsing or a corrupted draft must never block the workspace.
      } finally {
        setDraftsHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(hydrate);
  }, []);

  useEffect(() => {
    if (!draftsHydrated) return;
    try {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(strategies.slice(0, 50)));
    } catch {
      // Device storage is optional; the in-memory workspace remains usable.
    }
  }, [draftsHydrated, strategies]);

  useEffect(() => {
    const controller = new AbortController();
    const initial = window.setTimeout(() => void refreshPrices(controller.signal), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshPrices(controller.signal);
    }, 30_000);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void refreshPrices(controller.signal);
    };
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      controller.abort();
      window.clearTimeout(initial);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refreshPrices]);

  useEffect(() => {
    async function readNetwork() {
      try {
        const provider = new JsonRpcProvider(
          ROBINHOOD_MAINNET.rpcUrls[0],
          ROBINHOOD_MAINNET.chainIdNumber,
          { staticNetwork: true },
        );
        setNetworkBlock((await provider.getBlockNumber()).toLocaleString("en-US"));
        if (contractConfigured) {
          const code = await provider.getCode(CONTRACT_ADDRESS);
          if (code === "0x") {
            setContractStatus("Engine address empty");
            setContractReady(false);
          } else {
            const engine = new Contract(CONTRACT_ADDRESS, HOODFLOW_ENGINE_ABI, provider);
            const paused = Boolean(await engine.paused());
            setContractStatus(paused ? "Engine deployed · paused" : "Engine live");
            setContractReady(!paused);
          }
        }
      } catch {
        setNetworkBlock("Online");
        if (contractConfigured) setContractStatus("RPC check failed");
        setContractReady(false);
      }
    }
    void readNetwork();
  }, []);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  async function refreshWalletBalances(address: string, provider: BrowserProvider) {
    const usdG = new Contract(USDG_ADDRESS, ERC20_ABI, provider);
    const [nativeBalance, usdGBalance] = await Promise.all([
      provider.getBalance(address),
      usdG.balanceOf(address) as Promise<bigint>,
    ]);
    setWalletBalance(Number(formatEther(nativeBalance)).toFixed(4));
    setWalletUsdgBalance(Number(formatUnits(usdGBalance, USDG_DECIMALS)).toFixed(2));
  }

  async function connectWallet() {
    if (connected) {
      setWalletAddress("");
      setWalletBalance("");
      setWalletUsdgBalance("");
      notify("Wallet disconnected from HoodFlow");
      return;
    }
    if (!window.ethereum) {
      notify("No browser wallet found. Install Robinhood Wallet or MetaMask.");
      return;
    }
    try {
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ROBINHOOD_MAINNET.chainId }] });
      } catch (switchError: unknown) {
        if ((switchError as { code?: number })?.code === 4902) {
          await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{
            chainId: ROBINHOOD_MAINNET.chainId,
            chainName: ROBINHOOD_MAINNET.chainName,
            rpcUrls: ROBINHOOD_MAINNET.rpcUrls,
            nativeCurrency: ROBINHOOD_MAINNET.nativeCurrency,
            blockExplorerUrls: ROBINHOOD_MAINNET.blockExplorerUrls,
          }] });
        } else {
          throw switchError;
        }
      }
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      const provider = new BrowserProvider(window.ethereum, "any");
      const network = await provider.getNetwork();
      if (network.chainId !== BigInt(ROBINHOOD_MAINNET.chainIdNumber)) {
        throw new Error("Wallet is not connected to Robinhood Chain mainnet.");
      }
      const address = accounts[0];
      setWalletAddress(address);
      await refreshWalletBalances(address, provider);
      notify("Wallet connected to Robinhood Chain mainnet");
    } catch (error) {
      notify(errorMessage(error));
    }
  }

  function openComposer(nextKind: StrategyKind = "Buy", nextAsset?: string) {
    setKind(nextKind);
    const asset = nextAsset ?? (nextKind === "Buy" ? "INTC" : nextKind === "Take profit" ? "NVDA" : "AAPL");
    setDraftName(nextKind === "Buy" ? `${asset} instant buy` : nextKind === "DCA" ? "Weekly Apple" : nextKind === "Take profit" ? "NVDA trim" : "Core balance");
    setDraftAsset(asset);
    setDraftAmount(nextKind === "Buy" || nextKind === "DCA" ? "20" : nextKind === "Take profit" ? "25" : "8");
    setDraftFrequency(nextKind === "DCA" ? "Weekly" : nextKind === "Take profit" ? "15" : "24");
    setDraftExecutions("12");
    setDraftSlippage("0.5");
    setTransactionStep("");
    setShadowMode(true);
    setComposerOpen(true);
  }

  async function toggleStrategy(id: number) {
    const strategy = strategies.find((item) => item.id === id);
    if (!strategy || strategy.status === "Confirmed") return;
    if (strategy.chainStrategyId) {
      if (!window.ethereum || !connected || !contractConfigured) {
        notify("Connect the strategy owner wallet to change this onchain strategy.");
        return;
      }
      try {
        const provider = new BrowserProvider(window.ethereum, "any");
        const network = await provider.getNetwork();
        if (network.chainId !== BigInt(ROBINHOOD_MAINNET.chainIdNumber)) throw new Error("Switch your wallet to Robinhood Chain mainnet.");
        const engine = new Contract(CONTRACT_ADDRESS, HOODFLOW_ENGINE_ABI, await provider.getSigner());
        const transaction = strategy.status === "Prepared"
          ? await engine.pauseStrategy(strategy.chainStrategyId)
          : await engine.resumeStrategy(strategy.chainStrategyId);
        notify(strategy.status === "Prepared" ? "Confirm pause in your wallet" : "Confirm resume in your wallet");
        const receipt = await transaction.wait();
        if (!receipt || receipt.status !== 1) throw new Error("Strategy status change was not confirmed.");
        setStrategies((current) => current.map((item) => item.id === id ? { ...item, status: item.status === "Prepared" ? "Paused" : "Prepared" } : item));
        notify(strategy.status === "Prepared" ? "Onchain strategy paused" : "Onchain strategy resumed");
      } catch (error) {
        notify(errorMessage(error));
      }
      return;
    }
    setStrategies((current) => current.map((item) => item.id === id ? { ...item, status: item.status === "Prepared" ? "Paused" : "Prepared" } : item));
  }

  function saveShadowStrategy() {
    const rule = kind === "Buy" ? `Buy once with ${draftAmount} USDG` : kind === "DCA" ? `${draftAmount} USDG · ${draftFrequency.toLowerCase()} · ${draftExecutions} buys` : kind === "Take profit" ? `Sell ${draftAmount}% at +${draftFrequency}%` : `Rebalance at ${draftAmount}% drift`;
    setStrategies((current) => [{
      id: Date.now(), name: draftName, kind, asset: kind === "Rebalance" ? "4 assets" : draftAsset,
      rule, next: "Simulating next execution", status: "Shadow",
      spent: "0 USDG", health: 100, budget: kind === "Buy" || kind === "DCA" ? `${draftTotalBudget.toFixed(2)} USDG` : `${draftAmount}% position`, expires: "Device preview",
    }, ...current]);
    setComposerOpen(false);
    setView("strategies");
    notify("Shadow strategy saved on this device without moving funds");
  }

  async function executeDirectBuy(provider: BrowserProvider, address: string) {
    if (!isRoutedAsset(draftAsset)) throw new Error(`${draftAsset} is watch-only until a full-fill route passes.`);
    if (priceBook[draftAsset]?.status !== "live") throw new Error(`${draftAsset} oracle is not live. The buy is blocked.`);
    const amountIn = parseUnits(draftAmount, USDG_DECIMALS);
    if (amountIn <= 0n || amountIn > MAX_UINT128) throw new Error("Enter a valid USDG amount.");
    const slippageBps = Math.round(Number(draftSlippage) * 100);
    if (!Number.isInteger(slippageBps) || slippageBps < 10 || slippageBps > 500) {
      throw new Error("Slippage must be between 0.10% and 5.00%.");
    }

    const signer = await provider.getSigner();
    const usdG = new Contract(USDG_ADDRESS, ERC20_ABI, signer);
    const tokenOutAddress = ROBINHOOD_TOKENS[draftAsset];
    const outputToken = new Contract(tokenOutAddress, ERC20_ABI, provider);
    const [usdGBalance, gasBalance, outputBefore] = await Promise.all([
      usdG.balanceOf(address) as Promise<bigint>,
      provider.getBalance(address),
      outputToken.balanceOf(address) as Promise<bigint>,
    ]);
    if (usdGBalance < amountIn) throw new Error(`You need ${draftAmount} USDG; wallet balance is ${formatUnits(usdGBalance, USDG_DECIMALS)} USDG.`);
    if (gasBalance === 0n) throw new Error("A small ETH balance is required for Robinhood Chain gas.");

    setTransactionStep("Finding the best live V4 quote…");
    const quote = await getBestV4Quote(provider, tokenOutAddress, amountIn);
    const minAmountOut = quote.amountOut * BigInt(10_000 - slippageBps) / 10_000n;
    if (minAmountOut <= 0n) throw new Error("The protected output is zero.");

    const currentAllowance = BigInt(await usdG.allowance(address, PERMIT2_ADDRESS));
    if (currentAllowance < amountIn) {
      setTransactionStep(`Confirm an exact ${draftAmount} USDG Permit2 approval…`);
      const approval = await usdG.approve(PERMIT2_ADDRESS, amountIn);
      setTransactionStep("Waiting for USDG approval confirmation…");
      const approvalReceipt = await approval.wait();
      if (!approvalReceipt || approvalReceipt.status !== 1) throw new Error("USDG approval was not confirmed.");
    }

    const permit2 = new Contract(PERMIT2_ADDRESS, PERMIT2_ABI, provider);
    const permitAllowance = await permit2.allowance(address, USDG_ADDRESS, UNIVERSAL_ROUTER_ADDRESS) as { nonce?: bigint; 2?: bigint };
    const nonce = BigInt(permitAllowance.nonce ?? permitAllowance[2] ?? 0n);
    const now = Math.floor(Date.now() / 1_000);
    const permit: PermitSingle = {
      details: { token: USDG_ADDRESS, amount: amountIn, expiration: now + 600, nonce },
      spender: UNIVERSAL_ROUTER_ADDRESS,
      sigDeadline: now + 600,
    };
    setTransactionStep("Sign the exact USDG order permission…");
    const signature = await signer.signTypedData(
      { name: "Permit2", chainId: ROBINHOOD_MAINNET.chainIdNumber, verifyingContract: PERMIT2_ADDRESS },
      PERMIT2_TYPES,
      permit,
    );
    const calldata = buildDirectBuyCalldata({
      tokenOut: tokenOutAddress,
      amountIn,
      minAmountOut,
      route: quote.route as PoolCandidate,
      permit,
      signature,
    });

    setTransactionStep(`Confirm the ${draftAsset} buy in your wallet…`);
    const router = new Contract(UNIVERSAL_ROUTER_ADDRESS, UNIVERSAL_ROUTER_ABI, signer);
    const transaction = await router.execute(calldata.commands, calldata.inputs, now + 300);
    setTransactionStep("Waiting for mainnet confirmation…");
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1) throw new Error("The buy was not confirmed.");
    const outputAfter = BigInt(await outputToken.balanceOf(address));
    const received = outputAfter - outputBefore;
    if (received <= 0n) throw new Error("Transaction confirmed but no output token was received.");

    setStrategies((current) => [{
      id: Date.now(), name: draftName, kind: "Buy", asset: draftAsset,
      rule: `Buy once with ${draftAmount} USDG`, next: `${Number(formatUnits(received, STOCK_TOKEN_DECIMALS)).toFixed(6)} ${draftAsset} received`, status: "Confirmed",
      spent: `${Number(draftAmount).toFixed(2)} USDG`, health: 100, budget: `${Number(draftAmount).toFixed(2)} USDG`, expires: "Completed", txHash: receipt.hash,
    }, ...current]);
    await refreshWalletBalances(address, provider);
    setComposerOpen(false);
    setView("strategies");
    notify(`${draftAsset} buy confirmed on Robinhood Chain`);
  }

  async function createOnchainDca(provider: BrowserProvider, address: string) {
    if (!contractConfigured || !contractReady) throw new Error(`Recurring engine is not live yet (${contractStatus}).`);
    if (!isRoutedAsset(draftAsset)) throw new Error(`${draftAsset} is not enabled for recurring execution.`);
    if (priceBook[draftAsset]?.status !== "live") throw new Error(`${draftAsset} oracle is not live. The strategy is blocked.`);
    const executions = Number.parseInt(draftExecutions, 10);
    if (!Number.isInteger(executions) || executions < 2 || executions > 52) throw new Error("Choose between 2 and 52 executions.");
    const amountPerExecution = parseUnits(draftAmount, USDG_DECIMALS);
    const totalBudget = amountPerExecution * BigInt(executions);
    const slippageBps = Math.round(Number(draftSlippage) * 100);
    if (amountPerExecution <= 0n || totalBudget > MAX_UINT128) throw new Error("Enter a valid DCA budget.");
    if (slippageBps < 10 || slippageBps > 500) throw new Error("Slippage must be between 0.10% and 5.00%.");
    const interval = draftFrequency === "Daily" ? 86_400 : draftFrequency === "Monthly" ? 2_592_000 : 604_800;
    if (interval * executions > 365 * 86_400) throw new Error("This schedule exceeds the one-year strategy limit.");

    const signer = await provider.getSigner();
    const engine = new Contract(CONTRACT_ADDRESS, HOODFLOW_ENGINE_ABI, signer);
    const usdG = new Contract(USDG_ADDRESS, ERC20_ABI, signer);
    const [paused, inputConfig, outputConfig, balance] = await Promise.all([
      engine.paused() as Promise<boolean>,
      engine.tokenConfigs(USDG_ADDRESS),
      engine.tokenConfigs(ROBINHOOD_TOKENS[draftAsset]),
      usdG.balanceOf(address) as Promise<bigint>,
    ]);
    if (paused) throw new Error("The recurring engine is paused.");
    if (!inputConfig.allowed || !outputConfig.allowed) throw new Error(`${draftAsset}/USDG is not allowlisted by the engine.`);
    if (balance < totalBudget) throw new Error(`This strategy needs ${formatUnits(totalBudget, USDG_DECIMALS)} USDG.`);

    const currentAllowance = BigInt(await usdG.allowance(address, CONTRACT_ADDRESS));
    const combinedAllowance = currentAllowance + totalBudget;
    setTransactionStep(`Confirm the ${formatUnits(totalBudget, USDG_DECIMALS)} USDG strategy cap…`);
    const approval = await usdG.approve(CONTRACT_ADDRESS, combinedAllowance);
    const approvalReceipt = await approval.wait();
    if (!approvalReceipt || approvalReceipt.status !== 1) throw new Error("Strategy cap was not confirmed.");
    const now = Math.floor(Date.now() / 1_000);
    const expiresAt = now + interval * executions + 3_600;
    setTransactionStep("Confirm the recurring strategy…");
    const transaction = await engine.createStrategy(
      USDG_ADDRESS,
      ROBINHOOD_TOKENS[draftAsset],
      amountPerExecution,
      totalBudget,
      interval,
      0,
      expiresAt,
      slippageBps,
    );
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1) throw new Error("Strategy creation was not confirmed.");
    let chainStrategyId = "";
    for (const log of receipt.logs) {
      try {
        const parsed = engine.interface.parseLog(log);
        if (parsed?.name === "StrategyCreated") {
          chainStrategyId = BigInt(parsed.args.strategyId).toString();
          break;
        }
      } catch {
        // Ignore unrelated logs from token and engine internals.
      }
    }
    if (!chainStrategyId) throw new Error("Strategy transaction confirmed but its onchain ID was not found.");
    setStrategies((current) => [{
      id: Date.now(), name: draftName, kind: "DCA", asset: draftAsset,
      rule: `${draftAmount} USDG · ${draftFrequency.toLowerCase()} · ${executions} buys`, next: "Keeper awaiting first execution", status: "Prepared",
      spent: "0 USDG", health: 100, budget: `${formatUnits(totalBudget, USDG_DECIMALS)} USDG`, expires: new Date(expiresAt * 1_000).toLocaleDateString("en-GB"), txHash: receipt.hash, chainStrategyId,
    }, ...current]);
    await refreshWalletBalances(address, provider);
    setComposerOpen(false);
    setView("strategies");
    notify("Recurring strategy confirmed on Robinhood Chain");
  }

  async function createStrategy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftName.trim()) return;
    if (shadowMode || kind === "Take profit" || kind === "Rebalance") {
      saveShadowStrategy();
      return;
    }
    if (!window.ethereum || !connected) {
      notify("Connect a Robinhood Chain mainnet wallet first.");
      return;
    }
    setOnchainBusy(true);
    try {
      const provider = new BrowserProvider(window.ethereum, "any");
      const network = await provider.getNetwork();
      if (network.chainId !== BigInt(ROBINHOOD_MAINNET.chainIdNumber)) throw new Error("Switch your wallet to Robinhood Chain mainnet.");
      if (kind === "Buy") await executeDirectBuy(provider, walletAddress);
      else await createOnchainDca(provider, walletAddress);
    } catch (error) {
      notify(errorMessage(error));
      setTransactionStep("");
    } finally {
      setOnchainBusy(false);
    }
  }

  function copyStrategy(name: string) {
    setCopied(name);
    notify(`${name} copied as a safe, editable draft`);
  }

  function stopAllStrategies() {
    setStrategies((current) => current.map((item) => item.status === "Confirmed" || item.chainStrategyId ? item : { ...item, status: "Paused" as const }));
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
      {bootPhase !== "done" && <div className={`launch-screen ${bootPhase === "leaving" ? "is-leaving" : ""}`} role="status" aria-live="polite" aria-label="HoodFlow workspace loading">
        <div className="launch-grid" aria-hidden="true" />
        <div className="launch-top"><div className="launch-brand"><span className="brand-mark"><i /><i /><i /></span><strong>hoodflow</strong></div><span>SECURE AUTOMATION LAYER / 08</span></div>
        <div className="launch-center">
          <div className="launch-orbit" aria-hidden="true"><div className="launch-core"><span className="brand-mark"><i /><i /><i /></span></div>{["AAPL", "NVDA", "TSLA", "GOOGL", "MSFT"].map((ticker, index) => <span className={`launch-logo launch-logo-${index + 1}`} key={ticker}><Mark ticker={ticker} /></span>)}</div>
          <p>ROBINHOOD CHAIN / MAINNET</p>
          <h1>Preparing your<br /><span>safe workspace.</span></h1>
          <div className="launch-progress"><i style={{ "--progress": `${bootProgress}%` } as React.CSSProperties} /></div>
          <div className="launch-status"><span><i />{bootMessage}</span><strong>{bootProgress.toString().padStart(3, "0")}%</strong></div>
        </div>
        <div className="launch-bottom"><span>NON-CUSTODIAL</span><span>13 ROUTES OPEN</span><span>25 OFFICIAL ASSETS</span></div>
      </div>}
      <header className="topbar">
        <button className="brand" onClick={() => setView("overview")} aria-label="HoodFlow home">
          <span className="brand-mark"><i /><i /><i /></span><span>hoodflow</span><b className="version-badge">V12</b>
        </button>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}</button>)}
        </nav>
        <div className="top-actions">
          <span className="network"><i /> Mainnet <b>#{networkBlock}</b></span>
          <button className={connected ? "wallet connected" : "wallet"} onClick={() => void connectWallet()}>{connected ? compactAddress(walletAddress) : "Connect wallet"}</button>
        </div>
      </header>

      <div className="mobile-nav">
        {navigation.map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}</button>)}
      </div>

      {view === "overview" && (
        <section className="page overview-page">
          <div className="market-state"><span><i /> MAINNET RPC ONLINE</span><span>Block #{networkBlock}</span><span className={`price-state ${priceState}`}>{priceState === "loading" ? "SYNCING PRICES" : `${priceCounts.live} ONCHAIN PRICES LIVE`}</span><span>13 direct-buy routes · recurring: {contractStatus}</span></div>
          <div className="page-heading">
            <div><p className="eyebrow">AUTOMATION WITHOUT CUSTODY</p><h1>Set it. Cap it.<br /><span>Let it run.</span></h1><p className="lede">Build self-running stock-token strategies with hard spending limits, live health checks and a kill switch you control.</p></div>
            <div className="hero-command"><button className="primary-action" onClick={() => openComposer("Buy", "INTC")}><span>+</span> Buy INTC with USDG</button><div className="hero-proof"><span>V12 MAINNET ROUTING</span><strong>13 full-fill assets open</strong><small>Live quote · exact Permit2 order · slippage protected</small></div></div>
          </div>

          <div className="feature-dock">
            <button onClick={() => openComposer("Buy")}><span>01</span><div><strong>USDG Buy</strong><small>Direct mainnet swap with live quote</small></div><b>&rarr;</b></button>
            <button onClick={() => setView("controls")}><span>02</span><div><strong>Permission Center</strong><small>Inspect every spending cap</small></div><b>&rarr;</b></button>
            <button onClick={() => setView("assets")}><span>03</span><div><strong>Asset Matrix</strong><small>{priceState === "loading" ? "Syncing onchain prices" : `${priceCounts.available}/25 token prices available`}</small></div><b>&rarr;</b></button>
          </div>

          <div className="preview-callout mainnet-callout"><div><strong>Mainnet direct buy is ready</strong><span>Buy INTC or 12 other verified assets with USDG. Recurring DCA stays locked until the HoodFlow engine is live.</span></div><b>13 ROUTES OPEN</b></div>

          <div className="price-tape-head"><span>LIVE TOKEN PRICES</span><button onClick={() => setView("assets")}>Open all 25 <b>&rarr;</b></button></div>
          <div className="price-tape">
            {priceSpotlight.map((ticker) => <button key={ticker} onClick={() => setView("assets")}><Mark ticker={ticker} small /><p><span>{ticker}</span><strong>{formatPrice(priceBook[ticker]?.price)}</strong></p><small className={priceBook[ticker]?.status ?? "loading"}><i />{priceBook[ticker]?.status === "live" ? formatPriceAge(priceBook[ticker].updatedAt) : priceBook[ticker]?.status ?? "Syncing"}</small></button>)}
          </div>

          <div className="overview-grid">
            <article className="balance-card dark-card">
              <div className="card-label"><span>{connected ? "CONNECTED WALLET" : "SAMPLE PORTFOLIO"}</span><span className="live-label"><i /> {connected ? "MAINNET" : "PREVIEW"}</span></div>
              <div className="balance-line"><strong>{connected ? `${walletUsdgBalance} USDG` : "$12,804.62"}</strong><span>{connected ? `${walletBalance} ETH gas · ${compactAddress(walletAddress)}` : "+$284.17 today"}</span></div>
              <div className="chart" aria-label="Portfolio performance chart"><div className="chart-area" /><div className="chart-line" /><div className="chart-dot" /><div className="chart-labels"><span>09 JUL</span><span>11 JUL</span><span>13 JUL</span><span>TODAY</span></div></div>
              <div className="balance-foot"><span>30D return <b>+7.42%</b></span><span>Automated volume <b>$2,480</b></span><span>Avg. slippage <b>0.08%</b></span></div>
            </article>
            <article className="stats-stack">
              <div className="stat-card"><span>ONCHAIN / PREPARED</span><strong>{confirmedCount + preparedCount}</strong><small>{confirmedCount} confirmed · {shadowCount} shadow</small><div className="mini-bars"><i /><i /><i /><i /><i /><i /></div></div>
              <div className="stat-card fee-card"><span>STRATEGY HEALTH</span><strong>94</strong><small>All systems normal</small><b className="delta">HEALTHY</b></div>
            </article>
          </div>

          <div className="section-title how-title"><div><p className="eyebrow">HOW HOODFLOW WORKS</p><h2>Three steps. You stay in control.</h2></div><button onClick={() => setView("assets")}>See ready assets <span>&rarr;</span></button></div>
          <div className="how-grid">
            <article><span>01</span><div><strong>Choose an asset</strong><p>Pick from 13 full-fill verified assets. Watch-only assets stay visible but cannot prepare an order.</p></div></article>
            <article><span>02</span><div><strong>Review the live quote</strong><p>HoodFlow checks all three reviewed V4 pools, then protects the order with your slippage limit.</p></div></article>
            <article><span>03</span><div><strong>Approve only the order</strong><p>Permit2 signs the exact USDG amount. The Universal Router sends the stock token straight to your wallet.</p></div></article>
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
          <div className="inner-heading"><div><p className="eyebrow">AUTOMATION DESK</p><h1>Orders & strategies</h1><p>Every direct buy, rule, limit and execution state in one place.</p></div><button className="primary-action" onClick={() => openComposer()}><span>+</span> New order</button></div>
          <div className="device-save-note"><span><i /> SAVED ON THIS DEVICE</span><p>Your strategy drafts survive refreshes on this browser. Wallet keys and account data are never stored.</p></div>
          <div className="summary-row"><div><span>Confirmed buys</span><strong>{confirmedCount}</strong></div><div><span>Prepared DCA</span><strong>{preparedCount}</strong></div><div><span>Shadow mode</span><strong>{shadowCount}</strong></div><div><span>Engine</span><strong>{contractReady ? "Live" : "Pending"}</strong></div></div>
          <div className="table-card">
            <div className="table-head upgraded"><span>STRATEGY</span><span>RULE</span><span>NEXT ACTION</span><span>HEALTH</span><span>STATUS</span><span /></div>
            {strategies.map((item) => <StrategyRow key={item.id} item={item} detailed onToggle={() => toggleStrategy(item.id)} onInspect={() => setSelectedStrategy(item)} />)}
          </div>
        </section>
      )}

      {view === "assets" && (
        <section className="page inner-page assets-page">
          <div className="asset-hero">
            <div><p className="eyebrow">ROBINHOOD ASSET MATRIX</p><h1>Twenty-five assets.<br /><span>Priced onchain.</span></h1><p>Every canonical Robinhood stock token and ETF is indexed with its real brand mark and multiplier-adjusted Chainlink token price. HoodFlow only enables assets that completed a full-input fork swap; everything else stays safely watch-only.</p></div>
            <div className="asset-totals"><div><strong>25</strong><span>OFFICIAL ASSETS</span></div><div><strong>13</strong><span>FULL-FILL READY</span></div><div><strong>12</strong><span>WATCH-ONLY</span></div></div>
          </div>
          <div className="asset-logo-cloud" aria-label="All supported brands">{assetRegistry.map((asset) => <Mark key={asset.ticker} ticker={asset.ticker} small />)}<span>20 stocks + 5 ETFs</span></div>
          <div className={`price-source-bar ${priceState}`}>
            <div><span><i /> CHAINLINK / ROBINHOOD MAINNET</span><strong>{priceState === "loading" ? "Syncing price feeds" : `${priceCounts.live} live · ${priceCounts.guarded} guarded · ${25 - priceCounts.available} unavailable`}</strong></div>
            <p><strong>Onchain token price</strong><span>Includes Robinhood&apos;s corporate-action multiplier, so it can differ from the headline share price.</span>{priceError && <small>{priceError}</small>}</p>
            <div className="price-refresh"><span>{priceUpdatedAt ? `Synced ${new Date(priceUpdatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}` : "Waiting for first sync"}</span><button onClick={() => void refreshPrices()} disabled={priceRefreshing}>{priceRefreshing ? "Syncing" : "Refresh"}</button></div>
          </div>
          <div className="route-explainer"><div><b className="route-ready"><i />READY</b><p><strong>Can be bought with USDG</strong><span>A full-input fork swap passed. All reviewed pools are quoted again before every mainnet order.</span></p></div><div><b className="route-watch"><i />WATCH</b><p><strong>Visible, never forced</strong><span>No order is enabled until a full-fill route passes. MSFT stays blocked after a deterministic-fork partial fill, even when a live quote appears.</span></p></div></div>
          <div className="asset-toolbar">
            <div>{(["all", "routed", "registry"] as const).map((scope) => <button key={scope} className={assetScope === scope ? "selected" : ""} onClick={() => setAssetScope(scope)}>{scope === "all" ? "All 25" : scope === "routed" ? "Full-fill ready" : "Watch-only"}</button>)}</div>
            <label><span>Q</span><input aria-label="Search assets" placeholder="Ticker or company" value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} /></label>
          </div>
          <p className="result-count">Showing {visibleAssets.length} of 25 assets</p>
          <div className="asset-table">
            <div className="asset-table-head"><span>ASSET</span><span>ONCHAIN PRICE</span><span>TYPE</span><span>STATUS</span><span>WHAT HOODFLOW WILL DO</span></div>
            {visibleAssets.map(({ ticker, name, type, fullFill }) => <article className="asset-catalog-row" key={ticker}><div><Mark ticker={ticker} /><p><strong>{ticker}</strong><small>{name}</small></p></div><PriceCell point={priceBook[ticker]} loading={priceState === "loading"} /><span className="asset-type">{type}</span><b className={fullFill ? "route-ready" : "route-watch"}><i />{fullFill ? "Ready" : "Watch-only"}</b>{fullFill ? <button className="asset-buy" onClick={() => openComposer("Buy", ticker)}>Buy with USDG</button> : <p className="asset-policy">{ticker === "MSFT" ? "Partial fill detected — order blocked" : "No full-fill route — order blocked"}</p>}</article>)}
            {visibleAssets.length === 0 && <div className="empty-state"><strong>No matching asset</strong><span>Try another ticker or clear the current filter.</span></div>}
          </div>
          <p className="asset-footnote">Prices are informational Chainlink token prices, not execution quotes or investment recommendations. A stale or paused feed is visibly guarded and cannot be used by the execution engine.</p>
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
          <div className="inner-heading"><div><p className="eyebrow">PERMISSION CENTER</p><h1>You hold the keys.</h1><p>Review direct-buy receipts, local previews and recurring-engine status in one place.</p></div><button className="danger-action" onClick={() => setConfirmStop(true)}>Pause local drafts</button></div>
          <div className="control-grid">
            <article className="control-card control-score"><span>PRODUCT READINESS</span><strong>13<span>/13 buy routes</span></strong><p>Direct USDG buys are fork-verified. The recurring engine remains a separate gated release.</p><div className="score-line"><i /></div></article>
            <article className="control-card"><span>ROUTE INFRA</span><strong>13 full-fill</strong><p>13 quote-ready now · 34 bytecode checks · local fork swaps</p><b className="control-ok">VERIFIED</b></article>
            <article className="control-card"><span>RECURRING ENGINE</span><strong>{contractStatus}</strong><p>{contractConfigured ? compactAddress(CONTRACT_ADDRESS) : "Direct buys work without a HoodFlow engine."}</p><b className={`control-ok ${contractReady ? "" : "warning"}`}>{contractReady ? "ONCHAIN" : "GATED"}</b></article>
          </div>
          <div className="readiness-board">
            <div className="readiness-head"><div><p className="eyebrow">RECURRING ENGINE GATE</p><h2>DCA unlocks only when every gate is green.</h2></div><span>7 of 11 complete</span></div>
            {[
              ["01", "Protocol core", "25/25 engine, oracle and adapter safety tests passing", "complete"],
              ["02", "Bounded V4 adapter", "Hookless direct pools, fixed actions, temporary approvals", "complete"],
              ["03", "Canonical asset registry", "20 stocks + 5 ETFs and 34 bytecode targets verified", "complete"],
              ["04", "Dynamic route engine", "Best quote across 3 reviewed V4 pool configurations", "complete"],
              ["05", "Oracle defense", "Sequencer grace period, staleness and token pause guards", "complete"],
              ["06", "Keeper + product", "Preflight simulation, spending limits and kill switch UX", "complete"],
              ["07", "Full-engine fork canary", "2/2 capped executions, replay blocked, zero custody and allowances", "complete"],
              ["08", "Production RPC + oracle map", "Two independent RPCs and current Chainlink feeds/heartbeats", "pending"],
              ["09", "Multisig + pause drill", "Timelocked owner, separate guardian and monitored response rehearsal", "pending"],
              ["10", "Funded network canary", "Run a 1 USDG tranche with a 2 USDG lifetime cap on public testnet", "pending"],
              ["11", "Independent audit", "Resolve findings and pin the final report hash to this release", "locked"],
            ].map((gate) => <div className="readiness-row" key={gate[0]}><span>{gate[0]}</span><p><strong>{gate[1]}</strong><small>{gate[2]}</small></p><b className={`gate-${gate[3]}`}>{gate[3]}</b></div>)}
          </div>
          <div className="permissions-card">
            <div className="permissions-head"><div><p className="eyebrow">LOCAL POLICY DRAFTS</p><h2>Strategy permissions</h2></div><span>{strategies.length} policies</span></div>
            {strategies.map((item) => <div className="permission-row" key={item.id}><div className="permission-name"><Mark ticker={item.asset === "4 assets" ? "4" : item.asset} /><p><strong>{item.name}</strong><small>{item.asset} only</small></p></div><div><span>SPENDING CAP</span><strong>{item.budget}</strong></div><div><span>EXPIRES</span><strong>{item.expires}</strong></div><div><span>HEALTH</span><strong>{item.health}/100</strong></div><button onClick={() => toggleStrategy(item.id)} disabled={item.status === "Confirmed"}>{item.status === "Confirmed" ? "Settled" : item.status === "Prepared" ? "Pause" : "Prepare"}</button></div>)}
          </div>
          <div className="safety-notes"><article><span>01</span><div><strong>Asset allowlist</strong><p>A strategy cannot swap into a token that was not approved when it was created.</p></div></article><article><span>02</span><div><strong>Hard budget caps</strong><p>Keepers cannot execute above the per-trade or lifetime spending limit.</p></div></article><article><span>03</span><div><strong>Automatic circuit breaker</strong><p>Stale prices, excess slippage or low liquidity stop execution before a swap.</p></div></article></div>
        </section>
      )}

      <footer><span>HoodFlow Labs · Robinhood Chain</span><div><button onClick={() => setView("controls")}>Security</button><button onClick={() => setInfoPanel("docs")}>Quick guide</button><button onClick={() => setInfoPanel("terms")}>Mainnet terms</button></div><span className="testnet-tag mainnet-tag"><i /> DIRECT BUY LIVE</span></footer>

      {composerOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setComposerOpen(false); }}>
          <section className="composer wide-composer" role="dialog" aria-modal="true" aria-labelledby="composer-title">
            <div className="composer-head"><div><p className="eyebrow">NEW ORDER</p><h2 id="composer-title">Buy with limits.</h2></div><button aria-label="Close strategy builder" onClick={() => setComposerOpen(false)} disabled={onchainBusy}>x</button></div>
            <div className="kind-grid">
              {(["Buy", "DCA", "Take profit", "Rebalance"] as StrategyKind[]).map((item, index) => <button type="button" key={item} className={kind === item ? "selected" : ""} onClick={() => openComposer(item)} disabled={onchainBusy}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item === "Buy" ? "Buy now" : item}</strong><small>{item === "Buy" ? "USDG → stock token" : item === "DCA" ? contractReady ? "Recurring onchain buys" : "Engine deploy pending" : item === "Take profit" ? "Shadow preview" : "Shadow preview"}</small></button>)}
            </div>
            <form onSubmit={createStrategy}>
              <label>ORDER NAME<input name="name" value={draftName} onChange={(event) => setDraftName(event.target.value)} required disabled={onchainBusy} /></label>
              {kind !== "Rebalance" && <div className="asset-choice"><Mark ticker={draftAsset} /><label>ASSET <small>13 full-fill verified assets</small><select name="asset" value={draftAsset} onChange={(event) => setDraftAsset(event.target.value)}>{assetRegistry.filter((asset) => asset.fullFill).map((asset) => <option key={asset.ticker} value={asset.ticker}>{asset.ticker} · {asset.name} · {formatPrice(priceBook[asset.ticker]?.price)}</option>)}</select></label></div>}
              <div className="form-pair">
                <label>{kind === "Buy" ? "TOTAL TO SPEND" : kind === "DCA" ? "EACH BUY" : kind === "Take profit" ? "POSITION TO SELL" : "DRIFT LIMIT"}<span className="input-unit"><input name="amount" type="number" min={kind === "Buy" || kind === "DCA" ? "0.01" : "1"} step={kind === "Buy" || kind === "DCA" ? "0.01" : "1"} value={draftAmount} onChange={(event) => setDraftAmount(event.target.value)} required disabled={onchainBusy} /><b>{kind === "Buy" || kind === "DCA" ? "USDG" : "%"}</b></span></label>
                {kind === "Buy" || kind === "DCA" ? <label>MAX SLIPPAGE<span className="input-unit"><input name="slippage" type="number" min="0.1" max="5" step="0.1" value={draftSlippage} onChange={(event) => setDraftSlippage(event.target.value)} required disabled={onchainBusy} /><b>%</b></span></label> : <label>{kind === "Take profit" ? "PROFIT TARGET" : "CHECK"}<span className="input-unit"><input name="frequency" type="number" min="1" value={draftFrequency} onChange={(event) => setDraftFrequency(event.target.value)} disabled={onchainBusy} /><b>{kind === "Take profit" ? "%" : "HR"}</b></span></label>}
              </div>
              {kind === "DCA" && <div className="form-pair"><label>SCHEDULE<select name="frequency" value={draftFrequency} onChange={(event) => setDraftFrequency(event.target.value)} disabled={onchainBusy}><option>Daily</option><option>Weekly</option><option>Monthly</option></select></label><label>NUMBER OF BUYS<span className="input-unit"><input name="executions" type="number" min="2" max={draftFrequency === "Daily" ? "52" : draftFrequency === "Weekly" ? "52" : "12"} value={draftExecutions} onChange={(event) => setDraftExecutions(event.target.value)} disabled={onchainBusy} /><b>×</b></span></label></div>}
              <button type="button" className={`shadow-toggle ${shadowMode ? "on" : ""}`} onClick={() => { if (kind === "Take profit" || kind === "Rebalance") notify("This strategy type is Shadow-only for now."); else setShadowMode((current) => !current); }} disabled={onchainBusy}><i /><span><strong>{shadowMode ? "Shadow Mode is on" : kind === "Buy" ? "Mainnet buy is on" : "Onchain DCA is on"}</strong><small>{shadowMode ? "Simulate without moving funds." : kind === "Buy" ? "USDG swaps through the official Universal Router." : `Recurring engine: ${contractStatus}.`}</small></span><b>{shadowMode ? "SAFE" : "LIVE"}</b></button>
              <div className="execution-preview"><div className="preview-head"><span>EXECUTION PREVIEW</span><b>{shadowMode ? "NO FUNDS AT RISK" : kind === "Buy" ? "MAINNET · WALLET CONFIRMATION" : contractReady ? "MAINNET DCA" : "ENGINE PENDING"}</b></div><div className="preview-grid"><p><span>Estimated receive</span><strong>{kind === "Buy" || kind === "DCA" ? `${estimatedUnits} ${draftAsset}${kind === "DCA" ? " each" : ""}` : "Condition based"}</strong></p><p><span>Total USDG cap</span><strong>{kind === "Buy" || kind === "DCA" ? `${draftTotalBudget.toFixed(2)} USDG` : "Shadow only"}</strong></p><p><span>Execution protection</span><strong>{kind === "Buy" ? `Best of 3 pools · ${draftSlippage}% max` : kind === "DCA" ? `${draftSlippage}% max · engine cap` : "No broadcast"}</strong></p><p><span>Oracle status</span><strong>{priceBook[draftAsset]?.status === "live" ? formatPriceAge(priceBook[draftAsset].updatedAt) : priceBook[draftAsset]?.status ?? "Syncing"}</strong></p></div></div>
              <div className="limit-note"><span>✓</span><p><strong>{kind === "Buy" ? "The order permission is exact and short-lived." : "Spending limits stay enforced onchain."}</strong><small>{kind === "Buy" ? "HoodFlow signs only this USDG amount for the router. Any existing wallet-level Permit2 token approval is never increased when it is already sufficient." : "The recurring engine cannot execute outside the selected asset, total budget, schedule and expiry."}</small></p></div>
              {transactionStep && <div className="transaction-step"><i /><span>{transactionStep}</span></div>}
              <div className="composer-actions"><button type="button" onClick={() => setComposerOpen(false)} disabled={onchainBusy}>Cancel</button><button type="submit" className="primary-action" disabled={onchainBusy || (!shadowMode && kind === "DCA" && !contractReady)}>{onchainBusy ? "Working…" : shadowMode ? "Start simulation" : kind === "Buy" ? connected ? `Buy ${draftAsset} with USDG` : "Connect wallet first" : contractReady ? "Create onchain DCA" : "Engine deploy pending"} <span>&rarr;</span></button></div>
            </form>
          </section>
        </div>
      )}

      {selectedStrategy && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedStrategy(null); }}><section className="detail-drawer" role="dialog" aria-modal="true" aria-label={`${selectedStrategy.name} details`}><div className="composer-head"><div><p className="eyebrow">ORDER HEALTH</p><h2>{selectedStrategy.name}</h2></div><button onClick={() => setSelectedStrategy(null)}>x</button></div><div className="health-hero"><strong>{selectedStrategy.health}</strong><span>/100</span><p>{selectedStrategy.status}</p></div><div className="health-checks"><div><span>Oracle rule</span><strong>Feed + token pause <b>PASS</b></strong></div><div><span>Budget rule</span><strong>Bounded <b>PASS</b></strong></div><div><span>Route rule</span><strong>Full-fill verified <b>PASS</b></strong></div><div><span>Slippage rule</span><strong>Bounded <b>PASS</b></strong></div></div><div className="permission-summary"><p><span>Asset access</span><strong>{selectedStrategy.asset} only</strong></p><p><span>Spending cap</span><strong>{selectedStrategy.budget}</strong></p><p><span>Permission expires</span><strong>{selectedStrategy.expires}</strong></p></div>{selectedStrategy.txHash ? <a className="drawer-action receipt-link" href={`${ROBINHOOD_MAINNET.blockExplorerUrls[0]}/tx/${selectedStrategy.txHash}`} target="_blank" rel="noreferrer">View mainnet receipt ↗</a> : <button className="drawer-action" onClick={() => { toggleStrategy(selectedStrategy.id); setSelectedStrategy(null); }}>{selectedStrategy.status === "Prepared" ? "Pause strategy" : "Prepare strategy"}</button>}</section></div>}

      {infoPanel && <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setInfoPanel(null); }}><section className="info-card" role="dialog" aria-modal="true" aria-labelledby="info-title"><div className="composer-head"><div><p className="eyebrow">{infoPanel === "docs" ? "QUICK GUIDE" : "MAINNET TERMS"}</p><h2 id="info-title">{infoPanel === "docs" ? "Know every status." : "Clear before you sign."}</h2></div><button aria-label="Close information" onClick={() => setInfoPanel(null)}>x</button></div>{infoPanel === "docs" ? <div className="info-list"><article><span>01</span><p><strong>Buy now</strong><small>Quotes reviewed V4 pools and swaps USDG through the official Universal Router.</small></p></article><article><span>02</span><p><strong>Exact order permission</strong><small>Permit2 signs the selected USDG amount for ten minutes; the router consumes it in this order.</small></p></article><article><span>03</span><p><strong>Full-fill ready</strong><small>The complete input passed the official-router fork test. A fresh quote is still required.</small></p></article><article><span>04</span><p><strong>Watch-only</strong><small>The asset is visible, but HoodFlow blocks its order button.</small></p></article><article><span>05</span><p><strong>Recurring DCA</strong><small>Only activates when the HoodFlow engine address, bytecode and unpaused state are verified.</small></p></article></div> : <div className="info-copy"><p>Direct buys are user-signed Robinhood Chain mainnet transactions. Your wallet remains the sender and receiver.</p><p>Before signing, verify the USDG amount, Universal Router address and minimum output shown by your wallet. Network gas is paid in ETH.</p><p>Prices can move between quote and confirmation. The transaction reverts when output falls below your selected slippage limit.</p><p>Watch-only assets and stale or paused oracle states are blocked. Recurring automation remains unavailable until its engine is deployed and verified.</p></div>}<button className="drawer-action" onClick={() => setInfoPanel(null)}>Got it</button></section></div>}

      {confirmStop && <div className="confirm-backdrop"><section className="confirm-card" role="alertdialog" aria-modal="true"><p className="eyebrow">LOCAL CONTROL</p><h2>Pause every local draft?</h2><p>This changes Shadow and prepared rows saved in this browser. Settled mainnet buys are final and remain visible in history.</p><div><button onClick={() => setConfirmStop(false)}>Cancel</button><button onClick={stopAllStrategies}>Pause local drafts</button></div></section></div>}
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}

function StrategyRow({ item, detailed = false, onToggle, onInspect }: { item: Strategy; detailed?: boolean; onToggle: () => void; onInspect: () => void }) {
  return <article className={`strategy-row ${detailed ? "detailed upgraded" : ""}`}><div className="strategy-name"><Mark ticker={item.asset === "4 assets" ? "4" : item.asset} /><p><strong>{item.name}</strong><small>{item.kind} · {item.asset}</small></p></div><div className="rule-cell"><span>{detailed ? "" : "RULE"}</span><strong>{item.rule}</strong></div><div className="next-cell"><span>{detailed ? "" : "NEXT"}</span><strong>{item.next}</strong></div>{detailed && <div className="health-cell"><strong>{item.health}</strong><span>/100</span></div>}<button className={`status-button ${item.status.toLowerCase()}`} onClick={onToggle} disabled={item.status === "Confirmed"}><i />{item.status}</button><button className="row-more" onClick={onInspect} aria-label={`Inspect ${item.name}`}>DETAILS</button></article>;
}
