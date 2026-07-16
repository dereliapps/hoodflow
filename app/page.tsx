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
  HOODFLOW_DCA_ADDRESS,
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
  V3_QUOTER_ABI,
  V3_QUOTER_ADDRESS,
  V3_ROUTE_FEES,
  buildDirectBuyCalldata,
  buildV4ExactInputCalldata,
  buildV3DirectBuyCalldata,
  buildV3ExactInputCalldata,
  buildExactInputQuoteParams,
  isRoutedAsset,
  isV3RoutedAsset,
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
import { ROBINHOOD_PRICE_FEEDS } from "@/config/robinhood-price-feeds";

type View = "overview" | "strategies" | "assets" | "asset" | "marketplace" | "activity" | "controls";
type StrategyKind = "Buy" | "Sell" | "DCA";
type StrategyStatus = "Prepared" | "Paused" | "Confirmed";
type MarketplaceSort = "featured" | "cadence" | "risk";
type InfoPanel = "docs" | "terms";
type BootPhase = "loading" | "leaving" | "done";
type PriceState = "loading" | "live" | "degraded" | "error";
type WalletConnectionKind = "browser" | "walletconnect";
type HoodFlowWalletProvider = Eip1193Provider & { disconnect?: () => Promise<void> };
type WalletConnectConfig = { enabled: boolean; projectId: string | null };

type Strategy = {
  id: number;
  name: string;
  kind: StrategyKind;
  asset: string;
  rule: string;
  detail: string;
  status: StrategyStatus;
  budget: string;
  expires: string;
  createdAt: number;
  txHash?: string;
  chainStrategyId?: string;
};

type HistoryPoint = {
  roundId: string;
  price: number;
  updatedAt: number;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_HOODFLOW_CONTRACT_ADDRESS?.trim() || HOODFLOW_DCA_ADDRESS;
const contractConfigured = /^0x[a-fA-F0-9]{40}$/.test(CONTRACT_ADDRESS);
const ORDER_STORAGE_KEY = "hoodflow-mainnet-orders-v3";
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
  { ticker: "SGOV", name: "iShares 0-3 Month Treasury", type: "ETF", fullFill: true, logo: "/logos/SGOV.png" },
  { ticker: "SLV", name: "iShares Silver Trust", type: "ETF", fullFill: true, logo: "/logos/SLV.png" },
  { ticker: "SPY", name: "SPDR S&P 500", type: "ETF", fullFill: true, logo: "/logos/SPY.png" },
  { ticker: "CUSO", name: "United States Oil Fund", type: "ETF", fullFill: false, logo: "/logos/CUSO.png" },
] as const;

const assetByTicker = Object.fromEntries(assetRegistry.map((asset) => [asset.ticker, asset])) as Record<string, (typeof assetRegistry)[number]>;
const priceSpotlight = ["AAPL", "NVDA", "TSLA", "GOOGL", "SPY"] as const;

const marketplace = [
  { name: "Steady Tech", desc: "Start with a weekly AAPL DCA, then add NVDA and GOOGL as separate capped strategies.", assets: ["AAPL", "NVDA", "GOOGL"], cadence: "Weekly", risk: "Measured" },
  { name: "Chip Basket", desc: "Build a capped semiconductor schedule across NVDA, AMD, MU and INTC.", assets: ["NVDA", "AMD", "MU", "INTC"], cadence: "Weekly", risk: "Active" },
  { name: "Index Core", desc: "Use SPY or QQQ as a simple recurring core position with a fixed lifetime budget.", assets: ["SPY", "QQQ"], cadence: "Monthly", risk: "Core" },
];

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

async function getBestV4Quote(provider: BrowserProvider, tokenIn: string, tokenOut: string, amountIn: bigint) {
  const quoter = new Contract(V4_QUOTER_ADDRESS, V4_QUOTER_ABI, provider);
  const attempts = await Promise.allSettled(V4_POOL_CANDIDATES.map(async (route) => {
    const result = await quoter.quoteExactInputSingle.staticCall(
      buildExactInputQuoteParams(tokenIn, tokenOut, amountIn, route),
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

function PriceHistoryChart({ points, loading }: { points: HistoryPoint[]; loading: boolean }) {
  if (loading) {
    return <div className="history-chart empty"><span>Loading verified Chainlink rounds…</span></div>;
  }
  if (points.length < 2) {
    return <div className="history-chart empty"><span>No historical rounds are available for this asset.</span></div>;
  }
  const prices = points.map((point) => point.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const spread = Math.max(high - low, high * 0.0025);
  const coordinates = points.map((point, index) => {
    const x = points.length === 1 ? 0 : index / (points.length - 1) * 100;
    const y = 88 - (point.price - low) / spread * 76;
    return `${x.toFixed(2)}% ${Math.max(8, Math.min(92, y)).toFixed(2)}%`;
  });
  const area = `polygon(${coordinates.join(",")}, 100% 100%, 0 100%)`;
  const first = new Date(points[0].updatedAt * 1_000);
  const last = new Date(points.at(-1)!.updatedAt * 1_000);
  return <div className="history-chart" aria-label={`Onchain price history from ${first.toLocaleDateString()} to ${last.toLocaleDateString()}`}>
    <div className="history-grid" />
    <div className="history-area" style={{ clipPath: area }} />
    {points.filter((_, index) => index % Math.max(1, Math.floor(points.length / 8)) === 0 || index === points.length - 1).map((point, index, visible) => {
      const sourceIndex = points.indexOf(point);
      const x = sourceIndex / (points.length - 1) * 100;
      const y = 88 - (point.price - low) / spread * 76;
      return <i key={point.roundId} className={index === visible.length - 1 ? "latest" : ""} style={{ left: `${x}%`, top: `${Math.max(8, Math.min(92, y))}%` }} />;
    })}
    <div className="history-axis"><span>{first.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span><span>{last.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></div>
  </div>;
}

function isStoredStrategy(value: unknown): value is Strategy {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Strategy>;
  return typeof item.id === "number"
    && typeof item.name === "string"
    && ["Buy", "DCA"].includes(item.kind ?? "")
    && typeof item.asset === "string"
    && typeof item.rule === "string"
    && typeof item.detail === "string"
    && ["Prepared", "Paused", "Confirmed"].includes(item.status ?? "")
    && typeof item.budget === "string"
    && typeof item.expires === "string"
    && typeof item.createdAt === "number";
}

export default function Home() {
  const [bootPhase, setBootPhase] = useState<BootPhase>("loading");
  const [bootProgress, setBootProgress] = useState(12);
  const [view, setView] = useState<View>("overview");
  const [walletAddress, setWalletAddress] = useState("");
  const [walletBalance, setWalletBalance] = useState("");
  const [walletUsdgBalance, setWalletUsdgBalance] = useState("");
  const [walletProvider, setWalletProvider] = useState<HoodFlowWalletProvider | null>(null);
  const [walletKind, setWalletKind] = useState<WalletConnectionKind | null>(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [walletConnecting, setWalletConnecting] = useState(false);
  const [walletConnectReady, setWalletConnectReady] = useState<boolean | null>(null);
  const [networkBlock, setNetworkBlock] = useState("Checking");
  const [contractStatus, setContractStatus] = useState(contractConfigured ? "Checking DCA engine" : "Engine address missing");
  const [contractReady, setContractReady] = useState(false);
  const [enginePaused, setEnginePaused] = useState(false);
  const [engineOwner, setEngineOwner] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [kind, setKind] = useState<StrategyKind>("DCA");
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [toast, setToast] = useState("");
  const [draftName, setDraftName] = useState("Monday Apple");
  const [draftAsset, setDraftAsset] = useState("AAPL");
  const [draftAmount, setDraftAmount] = useState("20");
  const [draftFrequency, setDraftFrequency] = useState("Weekly");
  const [draftExecutions, setDraftExecutions] = useState("12");
  const [draftSlippage, setDraftSlippage] = useState("0.5");
  const [onchainBusy, setOnchainBusy] = useState(false);
  const [transactionStep, setTransactionStep] = useState("");
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
  const [selectedAssetTicker, setSelectedAssetTicker] = useState("AAPL");
  const [priceHistory, setPriceHistory] = useState<HistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const connected = Boolean(walletAddress);
  const preparedCount = useMemo(() => strategies.filter((item) => item.status === "Prepared").length, [strategies]);
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

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/walletconnect", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<WalletConnectConfig> : null)
      .then((config) => setWalletConnectReady(Boolean(config?.enabled)))
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setWalletConnectReady(false);
      });
    return () => controller.abort();
  }, []);
  const estimatedUnits = useMemo(() => {
    const point = priceBook[draftAsset];
    if (!point?.price || point.status !== "live") return "—";
    return kind === "Sell"
      ? (Number(draftAmount || 0) * point.price).toFixed(2)
      : (Number(draftAmount || 0) / point.price).toFixed(4);
  }, [draftAmount, draftAsset, kind, priceBook]);
  const priceCounts = useMemo(() => {
    const points = Object.values(priceBook);
    return {
      live: points.filter((point) => point.status === "live").length,
      guarded: points.filter((point) => point.status === "stale" || point.status === "paused").length,
      available: points.filter((point) => point.price !== null).length,
    };
  }, [priceBook]);
  const selectedAsset = assetByTicker[selectedAssetTicker] ?? assetRegistry[0];
  const historyStats = useMemo(() => {
    if (priceHistory.length < 2) return null;
    const prices = priceHistory.map((point) => point.price);
    const first = prices[0];
    const last = prices.at(-1)!;
    return {
      high: Math.max(...prices),
      low: Math.min(...prices),
      change: first > 0 ? (last - first) / first * 100 : 0,
    };
  }, [priceHistory]);
  const activityRows = useMemo(() => strategies
    .filter((item) => item.txHash)
    .sort((left, right) => right.createdAt - left.createdAt), [strategies]);
  const bootMessage = bootProgress < 32 ? "Loading token registry" : bootProgress < 60 ? "Verifying onchain prices" : bootProgress < 82 ? "Checking trade routes" : bootProgress < 100 ? "Preparing your workspace" : "Workspace ready";

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
        const saved = window.localStorage.getItem(ORDER_STORAGE_KEY);
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
      window.localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(strategies.slice(0, 50)));
    } catch {
      // Device storage is optional; the in-memory workspace remains usable.
    }
  }, [draftsHydrated, strategies]);

  useEffect(() => {
    const syncAssetFromUrl = () => {
      const ticker = new URL(window.location.href).searchParams.get("asset")?.toUpperCase();
      if (ticker && assetByTicker[ticker]) {
        setSelectedAssetTicker(ticker);
        setView("asset");
      } else if (view === "asset") {
        setView("assets");
      }
    };
    syncAssetFromUrl();
    window.addEventListener("popstate", syncAssetFromUrl);
    return () => window.removeEventListener("popstate", syncAssetFromUrl);
  // URL state is initialized once and then updated through openAsset.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (view !== "asset") return;
    const controller = new AbortController();
    const start = window.setTimeout(() => {
      setHistoryLoading(true);
      setHistoryError("");
      fetch(`/api/history?ticker=${encodeURIComponent(selectedAssetTicker)}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      }).then(async (response) => {
        const payload = await response.json() as { points?: HistoryPoint[]; error?: string };
        if (!response.ok && !payload.points) throw new Error(payload.error || "History request failed");
        setPriceHistory(Array.isArray(payload.points) ? payload.points : []);
        setHistoryError(payload.error ?? "");
      }).catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPriceHistory([]);
        setHistoryError("Historical Chainlink rounds are temporarily unavailable.");
      }).finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    }, 0);
    return () => {
      window.clearTimeout(start);
      controller.abort();
    };
  }, [selectedAssetTicker, view]);

  useEffect(() => {
    const controller = new AbortController();
    const initial = window.setTimeout(() => void refreshPrices(controller.signal), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshPrices(controller.signal);
    }, 10_000);
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
    if (priceState !== "loading") return;
    const timeout = window.setTimeout(() => {
      setPriceState("error");
      setPriceError("Price feed temporarily unavailable. Trading is disabled until verification completes.");
    }, 7_000);
    return () => window.clearTimeout(timeout);
  }, [priceState]);

  useEffect(() => {
    if (networkBlock !== "Checking") return;
    const timeout = window.setTimeout(() => setNetworkBlock("Unavailable"), 7_000);
    return () => window.clearTimeout(timeout);
  }, [networkBlock]);

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
            const [owner, paused, settlementToken, swapAdapter, keeperCount, allowedTokenCount, maxTranche, maxBudget, inputConfig] = await Promise.all([
              engine.owner() as Promise<string>,
              engine.paused() as Promise<boolean>,
              engine.settlementToken() as Promise<string>,
              engine.swapAdapter() as Promise<string>,
              engine.keeperCount() as Promise<bigint>,
              engine.allowedTokenCount() as Promise<bigint>,
              engine.maxTrancheAmount() as Promise<bigint>,
              engine.maxStrategyBudget() as Promise<bigint>,
              engine.tokenConfigs(USDG_ADDRESS),
            ]);
            setEngineOwner(owner);
            setEnginePaused(paused);
            const configured = settlementToken.toLowerCase() === USDG_ADDRESS.toLowerCase()
              && swapAdapter !== "0x0000000000000000000000000000000000000000"
              && keeperCount > 0n
              && allowedTokenCount >= 2n
              && maxTranche > 0n
              && maxBudget >= maxTranche
              && Boolean(inputConfig.allowed);
            setContractStatus(paused ? "Engine deployed · owner activation required" : configured ? "Engine live" : "Engine config invalid");
            setContractReady(!paused && configured);
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

  async function activateDcaEngine() {
    if (!walletProvider || !connected) {
      setWalletModalOpen(true);
      throw new Error("Connect the engine owner wallet to activate recurring DCA.");
    }
    if (!engineOwner || walletAddress.toLowerCase() !== engineOwner.toLowerCase()) {
      throw new Error(`Engine activation requires the owner wallet ${compactAddress(engineOwner || "0x0000000000000000000000000000000000000000")}.`);
    }
    const provider = new BrowserProvider(walletProvider, "any");
    const network = await provider.getNetwork();
    if (network.chainId !== BigInt(ROBINHOOD_MAINNET.chainIdNumber)) await switchToRobinhoodChain(walletProvider);
    const engine = new Contract(CONTRACT_ADDRESS, HOODFLOW_ENGINE_ABI, await provider.getSigner());
    const liveOwner = String(await engine.owner());
    if (liveOwner.toLowerCase() !== walletAddress.toLowerCase()) throw new Error("The connected wallet is not the live engine owner.");
    setTransactionStep("Confirm DCA engine activation in your wallet…");
    const transaction = await engine.unpauseEverything();
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1) throw new Error("Engine activation was not confirmed.");
    setEnginePaused(false);
    setContractReady(true);
    setContractStatus("Engine live");
    setTransactionStep("");
    notify("DCA engine is live on Robinhood mainnet");
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

  async function switchToRobinhoodChain(provider: HoodFlowWalletProvider) {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ROBINHOOD_MAINNET.chainId }] });
    } catch (switchError: unknown) {
      if ((switchError as { code?: number })?.code !== 4902) throw switchError;
      await provider.request({ method: "wallet_addEthereumChain", params: [{
        chainId: ROBINHOOD_MAINNET.chainId,
        chainName: ROBINHOOD_MAINNET.chainName,
        rpcUrls: [...ROBINHOOD_MAINNET.rpcUrls],
        nativeCurrency: ROBINHOOD_MAINNET.nativeCurrency,
        blockExplorerUrls: [...ROBINHOOD_MAINNET.blockExplorerUrls],
      }] });
    }
  }

  async function activateWallet(provider: HoodFlowWalletProvider, kind: WalletConnectionKind) {
    await switchToRobinhoodChain(provider);
    const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
    const browserProvider = new BrowserProvider(provider, "any");
    const network = await browserProvider.getNetwork();
    if (network.chainId !== BigInt(ROBINHOOD_MAINNET.chainIdNumber)) {
      throw new Error("Wallet is not connected to Robinhood Chain mainnet.");
    }
    const address = accounts[0];
    if (!address) throw new Error("The wallet did not return an account.");
    setWalletProvider(provider);
    setWalletKind(kind);
    setWalletAddress(address);
    await refreshWalletBalances(address, browserProvider);
    setWalletModalOpen(false);
    notify(kind === "walletconnect" ? "WalletConnect session ready on Robinhood Chain" : "Browser wallet connected to Robinhood Chain");
  }

  async function connectBrowserWallet() {
    if (!window.ethereum) {
      notify("No browser wallet found. Use WalletConnect or install Robinhood Wallet / MetaMask.");
      return;
    }
    setWalletConnecting(true);
    try {
      await activateWallet(window.ethereum, "browser");
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setWalletConnecting(false);
    }
  }

  async function connectWalletConnect() {
    setWalletConnecting(true);
    try {
      const configResponse = await fetch("/api/walletconnect", { cache: "no-store" });
      const config = configResponse.ok ? await configResponse.json() as WalletConnectConfig : null;
      if (!config?.enabled || !config.projectId) throw new Error("WalletConnect activation is pending its Reown project ID.");
      const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
      const provider = await EthereumProvider.init({
        projectId: config.projectId,
        showQrModal: true,
        optionalChains: [ROBINHOOD_MAINNET.chainIdNumber],
        rpcMap: { [ROBINHOOD_MAINNET.chainIdNumber]: ROBINHOOD_MAINNET.rpcUrls[0] },
        metadata: {
          name: "HoodFlow",
          description: "Protected stock-token routes on Robinhood Chain",
          url: window.location.origin,
          icons: [`${window.location.origin}/favicon.svg`],
        },
      });
      await provider.connect();
      await activateWallet(provider as unknown as HoodFlowWalletProvider, "walletconnect");
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setWalletConnecting(false);
    }
  }

  async function disconnectWallet() {
    try {
      if (walletKind === "walletconnect") await walletProvider?.disconnect?.();
    } catch {
      // The local session is still cleared if the remote wallet already disconnected.
    } finally {
      setWalletProvider(null);
      setWalletKind(null);
      setWalletAddress("");
      setWalletBalance("");
      setWalletUsdgBalance("");
      notify("Wallet disconnected from HoodFlow");
    }
  }

  function handleWalletButton() {
    if (connected) void disconnectWallet();
    else setWalletModalOpen(true);
  }

  function openAsset(ticker: string) {
    if (!assetByTicker[ticker]) return;
    setSelectedAssetTicker(ticker);
    setView("asset");
    const url = new URL(window.location.href);
    url.searchParams.set("asset", ticker);
    window.history.pushState({}, "", `${url.pathname}${url.search}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function navigate(nextView: View) {
    setView(nextView);
    if (nextView !== "asset") {
      const url = new URL(window.location.href);
      url.searchParams.delete("asset");
      window.history.pushState({}, "", `${url.pathname}${url.search}`);
    }
  }

  function openComposer(nextKind: StrategyKind = "Buy", nextAsset?: string) {
    setKind(nextKind);
    const asset = nextAsset && (nextKind !== "DCA" || !isV3RoutedAsset(nextAsset))
      ? nextAsset
      : nextKind === "DCA" ? "AAPL" : "INTC";
    setDraftName(nextKind === "Buy" ? `${asset} instant buy` : nextKind === "Sell" ? `${asset} instant sell` : `Weekly ${asset}`);
    setDraftAsset(asset);
    setDraftAmount(nextKind === "Sell" ? "0.01" : "20");
    setDraftFrequency("Weekly");
    setDraftExecutions("12");
    setDraftSlippage("0.5");
    setTransactionStep("");
    setComposerOpen(true);
  }

  async function toggleStrategy(id: number) {
    const strategy = strategies.find((item) => item.id === id);
    if (!strategy || strategy.status === "Confirmed") return;
    if (strategy.chainStrategyId) {
      if (!walletProvider || !connected || !contractConfigured) {
        notify("Connect the strategy owner wallet to change this onchain strategy.");
        return;
      }
      try {
        const provider = new BrowserProvider(walletProvider, "any");
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
    notify("Only onchain recurring strategies can be paused or resumed.");
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

    setTransactionStep("Finding the best live verified quote…");
    const quote = isV3RoutedAsset(draftAsset)
      ? await (async () => {
          const quoter = new Contract(V3_QUOTER_ADDRESS, V3_QUOTER_ABI, provider);
          const fee = V3_ROUTE_FEES[draftAsset];
          const result = await quoter.quoteExactInputSingle.staticCall({
            tokenIn: USDG_ADDRESS,
            tokenOut: tokenOutAddress,
            amountIn,
            fee,
            sqrtPriceLimitX96: 0,
          }) as readonly [bigint, bigint, bigint, bigint];
          const amountOut = BigInt(result[0]);
          if (amountOut <= 0n) throw new Error("No live full-fill V3 quote is available for this amount.");
          return { protocol: "V3" as const, fee, amountOut };
        })()
      : await getBestV4Quote(provider, USDG_ADDRESS, tokenOutAddress, amountIn).then((result) => ({ protocol: "V4" as const, ...result }));
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
    const calldata = quote.protocol === "V3"
      ? buildV3DirectBuyCalldata({
          tokenOut: tokenOutAddress,
          recipient: address,
          amountIn,
          minAmountOut,
          fee: quote.fee,
          permit,
          signature,
        })
      : buildDirectBuyCalldata({
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
      rule: `Buy once with ${draftAmount} USDG`, detail: `${Number(formatUnits(received, STOCK_TOKEN_DECIMALS)).toFixed(6)} ${draftAsset} received`, status: "Confirmed",
      budget: `${Number(draftAmount).toFixed(2)} USDG`, expires: "Completed", createdAt: Date.now(), txHash: receipt.hash,
    }, ...current]);
    await refreshWalletBalances(address, provider);
    setComposerOpen(false);
    navigate("strategies");
    notify(`${draftAsset} buy confirmed on Robinhood Chain`);
  }

  async function executeDirectSell(provider: BrowserProvider, address: string) {
    if (!isRoutedAsset(draftAsset)) throw new Error(`${draftAsset} is watch-only until a full-fill route passes.`);
    if (priceBook[draftAsset]?.status !== "live") throw new Error(`${draftAsset} oracle is not live. The sell is blocked.`);
    const amountIn = parseUnits(draftAmount, STOCK_TOKEN_DECIMALS);
    if (amountIn <= 0n || amountIn > MAX_UINT128) throw new Error(`Enter a valid ${draftAsset} amount.`);
    const slippageBps = Math.round(Number(draftSlippage) * 100);
    if (!Number.isInteger(slippageBps) || slippageBps < 10 || slippageBps > 500) throw new Error("Slippage must be between 0.10% and 5.00%.");

    const signer = await provider.getSigner();
    const tokenInAddress = ROBINHOOD_TOKENS[draftAsset];
    const inputToken = new Contract(tokenInAddress, ERC20_ABI, signer);
    const usdG = new Contract(USDG_ADDRESS, ERC20_ABI, provider);
    const [tokenBalance, gasBalance, usdGBefore] = await Promise.all([
      inputToken.balanceOf(address) as Promise<bigint>,
      provider.getBalance(address),
      usdG.balanceOf(address) as Promise<bigint>,
    ]);
    if (tokenBalance < amountIn) throw new Error(`Wallet balance is ${formatUnits(tokenBalance, STOCK_TOKEN_DECIMALS)} ${draftAsset}.`);
    if (gasBalance === 0n) throw new Error("A small ETH balance is required for Robinhood Chain gas.");

    setTransactionStep("Finding the best live verified sell quote…");
    const quote = isV3RoutedAsset(draftAsset)
      ? await (async () => {
          const quoter = new Contract(V3_QUOTER_ADDRESS, V3_QUOTER_ABI, provider);
          const fee = V3_ROUTE_FEES[draftAsset];
          const result = await quoter.quoteExactInputSingle.staticCall({
            tokenIn: tokenInAddress,
            tokenOut: USDG_ADDRESS,
            amountIn,
            fee,
            sqrtPriceLimitX96: 0,
          }) as readonly [bigint, bigint, bigint, bigint];
          const amountOut = BigInt(result[0]);
          if (amountOut <= 0n) throw new Error("No live full-fill V3 sell quote is available for this amount.");
          return { protocol: "V3" as const, fee, amountOut };
        })()
      : await getBestV4Quote(provider, tokenInAddress, USDG_ADDRESS, amountIn).then((result) => ({ protocol: "V4" as const, ...result }));
    const minAmountOut = quote.amountOut * BigInt(10_000 - slippageBps) / 10_000n;
    if (minAmountOut <= 0n) throw new Error("The protected USDG output is zero.");

    const currentAllowance = BigInt(await inputToken.allowance(address, PERMIT2_ADDRESS));
    if (currentAllowance < amountIn) {
      setTransactionStep(`Confirm an exact ${draftAmount} ${draftAsset} Permit2 approval…`);
      const approval = await inputToken.approve(PERMIT2_ADDRESS, amountIn);
      const approvalReceipt = await approval.wait();
      if (!approvalReceipt || approvalReceipt.status !== 1) throw new Error(`${draftAsset} approval was not confirmed.`);
    }

    const permit2 = new Contract(PERMIT2_ADDRESS, PERMIT2_ABI, provider);
    const permitAllowance = await permit2.allowance(address, tokenInAddress, UNIVERSAL_ROUTER_ADDRESS) as { nonce?: bigint; 2?: bigint };
    const now = Math.floor(Date.now() / 1_000);
    const permit: PermitSingle = {
      details: { token: tokenInAddress, amount: amountIn, expiration: now + 600, nonce: BigInt(permitAllowance.nonce ?? permitAllowance[2] ?? 0n) },
      spender: UNIVERSAL_ROUTER_ADDRESS,
      sigDeadline: now + 600,
    };
    setTransactionStep(`Sign the exact ${draftAsset} sell permission…`);
    const signature = await signer.signTypedData(
      { name: "Permit2", chainId: ROBINHOOD_MAINNET.chainIdNumber, verifyingContract: PERMIT2_ADDRESS },
      PERMIT2_TYPES,
      permit,
    );
    const calldata = quote.protocol === "V3"
      ? buildV3ExactInputCalldata({ tokenIn: tokenInAddress, tokenOut: USDG_ADDRESS, recipient: address, amountIn, minAmountOut, fee: quote.fee, permit, signature })
      : buildV4ExactInputCalldata({ tokenIn: tokenInAddress, tokenOut: USDG_ADDRESS, amountIn, minAmountOut, route: quote.route as PoolCandidate, permit, signature });

    setTransactionStep(`Confirm the ${draftAsset} sell in your wallet…`);
    const router = new Contract(UNIVERSAL_ROUTER_ADDRESS, UNIVERSAL_ROUTER_ABI, signer);
    const transaction = await router.execute(calldata.commands, calldata.inputs, now + 300);
    setTransactionStep("Waiting for mainnet confirmation…");
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1) throw new Error("The sell was not confirmed.");
    const received = BigInt(await usdG.balanceOf(address)) - usdGBefore;
    if (received <= 0n) throw new Error("Transaction confirmed but no USDG was received.");

    setStrategies((current) => [{
      id: Date.now(), name: draftName, kind: "Sell", asset: draftAsset,
      rule: `Sell ${draftAmount} ${draftAsset}`, detail: `${Number(formatUnits(received, USDG_DECIMALS)).toFixed(2)} USDG received`, status: "Confirmed",
      budget: `${draftAmount} ${draftAsset}`, expires: "Completed", createdAt: Date.now(), txHash: receipt.hash,
    }, ...current]);
    await refreshWalletBalances(address, provider);
    setComposerOpen(false);
    navigate("strategies");
    notify(`${draftAsset} sell confirmed on Robinhood Chain`);
  }

  async function createOnchainDca(provider: BrowserProvider, address: string) {
    if (!contractConfigured || !contractReady) throw new Error(`Recurring engine is not live yet (${contractStatus}).`);
    if (!isRoutedAsset(draftAsset)) throw new Error(`${draftAsset} is not enabled for recurring execution.`);
    if (isV3RoutedAsset(draftAsset)) throw new Error(`${draftAsset} is enabled for Buy Now, but not for recurring V4 execution.`);
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
    const [paused, settlementToken, maxTranche, maxBudget, inputConfig, outputConfig, balance] = await Promise.all([
      engine.paused() as Promise<boolean>,
      engine.settlementToken() as Promise<string>,
      engine.maxTrancheAmount() as Promise<bigint>,
      engine.maxStrategyBudget() as Promise<bigint>,
      engine.tokenConfigs(USDG_ADDRESS),
      engine.tokenConfigs(ROBINHOOD_TOKENS[draftAsset]),
      usdG.balanceOf(address) as Promise<bigint>,
    ]);
    if (paused) throw new Error("The recurring engine is paused.");
    if (settlementToken.toLowerCase() !== USDG_ADDRESS.toLowerCase()) throw new Error("The recurring engine settlement token is invalid.");
    if (!inputConfig.allowed || !outputConfig.allowed) throw new Error(`${draftAsset}/USDG is not allowlisted by the engine.`);
    if (amountPerExecution > maxTranche) throw new Error(`Each execution is capped at ${formatUnits(maxTranche, USDG_DECIMALS)} USDG.`);
    if (totalBudget > maxBudget) throw new Error(`This engine caps a strategy at ${formatUnits(maxBudget, USDG_DECIMALS)} USDG.`);
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
      rule: `${draftAmount} USDG · ${draftFrequency.toLowerCase()} · ${executions} buys`, detail: "Keeper awaiting first execution", status: "Prepared",
      budget: `${formatUnits(totalBudget, USDG_DECIMALS)} USDG`, expires: new Date(expiresAt * 1_000).toLocaleDateString("en-GB"), createdAt: Date.now(), txHash: receipt.hash, chainStrategyId,
    }, ...current]);
    await refreshWalletBalances(address, provider);
    setComposerOpen(false);
    navigate("strategies");
    notify("Recurring strategy confirmed on Robinhood Chain");
  }

  async function createStrategy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftName.trim()) return;
    if (!walletProvider || !connected) {
      if (kind === "DCA" && enginePaused) setWalletModalOpen(true);
      notify(kind === "DCA" && enginePaused ? "Connect the engine owner wallet to activate DCA." : "Connect a Robinhood Chain mainnet wallet first.");
      return;
    }
    setOnchainBusy(true);
    try {
      if (kind === "DCA" && enginePaused) {
        await activateDcaEngine();
        return;
      }
      const provider = new BrowserProvider(walletProvider, "any");
      const network = await provider.getNetwork();
      if (network.chainId !== BigInt(ROBINHOOD_MAINNET.chainIdNumber)) throw new Error("Switch your wallet to Robinhood Chain mainnet.");
      if (kind === "Buy") await executeDirectBuy(provider, walletAddress);
      else if (kind === "Sell") await executeDirectSell(provider, walletAddress);
      else await createOnchainDca(provider, walletAddress);
    } catch (error) {
      notify(errorMessage(error));
      setTransactionStep("");
    } finally {
      setOnchainBusy(false);
    }
  }

  function applyTemplate(asset: string, cadence: string, name: string) {
    openComposer("DCA", asset);
    setDraftFrequency(cadence);
    setDraftName(name);
  }

  function exportActivity() {
    if (activityRows.length === 0) {
      notify("No mainnet activity to export yet.");
      return;
    }
    const escapeCell = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = [
      ["Asset", "Order", "Rule", "Result", "Time", "Status", "Mainnet receipt"],
      ...activityRows.map((item) => [item.asset, item.name, item.rule, item.detail, new Date(item.createdAt).toISOString(), item.status, `${ROBINHOOD_MAINNET.blockExplorerUrls[0]}/tx/${item.txHash}`]),
    ];
    const csv = rows.map((row) => row.map(escapeCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "hoodflow-mainnet-activity.csv";
    link.click();
    URL.revokeObjectURL(url);
    notify("Mainnet activity CSV downloaded");
  }

  const visibleAssets = assetRegistry.filter(({ ticker, name, fullFill }) => {
    const matchesScope = assetScope === "all" || (assetScope === "routed" ? fullFill : !fullFill);
    const query = assetSearch.trim().toLowerCase();
    return matchesScope && (!query || ticker.toLowerCase().includes(query) || name.toLowerCase().includes(query));
  });
  const visibleMarketplace = useMemo(() => {
    const query = marketSearch.trim().toLowerCase();
    const filtered = marketplace.filter((item) => !query || [item.name, item.desc, ...item.assets].some((value) => value.toLowerCase().includes(query)));
    if (marketSort === "cadence") return [...filtered].sort((left, right) => left.cadence.localeCompare(right.cadence));
    if (marketSort === "risk") return [...filtered].sort((left, right) => left.risk.localeCompare(right.risk));
    return filtered;
  }, [marketSearch, marketSort]);
  const navigation: View[] = ["overview", "assets", "strategies", "activity", "marketplace", "controls"];

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
        <div className="launch-bottom"><span>NON-CUSTODIAL</span><span>PROTECTED QUOTES</span><span>25 INDEXED TOKENS</span></div>
      </div>}
      <header className="topbar">
        <button className="brand" onClick={() => navigate("overview")} aria-label="HoodFlow home">
          <span className="brand-mark"><i /><i /><i /></span><span>hoodflow</span><b className="version-badge">MAINNET BETA</b>
        </button>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map((item) => <button key={item} className={view === item || (item === "assets" && view === "asset") ? "active" : ""} onClick={() => navigate(item)}>{item}</button>)}
        </nav>
        <div className="top-actions">
          <span className="network"><i /> Mainnet <b>#{networkBlock}</b></span>
          <button className={connected ? "wallet connected" : "wallet"} onClick={handleWalletButton}>{connected ? `${compactAddress(walletAddress)} · ${walletKind === "walletconnect" ? "WC" : "WEB"}` : "Connect wallet"}</button>
        </div>
      </header>

      <div className="mobile-nav">
        {navigation.map((item) => <button key={item} className={view === item || (item === "assets" && view === "asset") ? "active" : ""} onClick={() => navigate(item)}>{item}</button>)}
      </div>

      {view === "overview" && (
        <section className="page overview-page">
          <div className="independence-notice"><strong>Independent interface built on Robinhood Chain.</strong><span>Not affiliated with or endorsed by Robinhood Markets, Inc.</span></div>
          <div className="market-state"><span><i /> CHAIN 4663 CONNECTED</span><span>Block #{networkBlock}</span><span className={`price-state ${priceState}`}>{priceState === "loading" ? "VERIFYING PRICES" : priceState === "error" ? "PRICE VERIFICATION UNAVAILABLE" : `${priceCounts.live} ONCHAIN PRICES VERIFIED`}</span><span>Direct Buy + Sell enabled only for verified routes</span></div>
          <div className="page-heading">
            <div><p className="eyebrow">SELF-CUSTODY STOCK TOKEN TRADING</p><h1>Buy Stock Tokens<br /><span>directly from your wallet.</span></h1><p className="lede">Compare live Robinhood Chain liquidity, receive a protected USDG quote and keep every purchased token in self-custody.</p></div>
            <div className="hero-command"><button className="primary-action" onClick={() => navigate("assets")}><span>+</span> Explore Stock Tokens</button><p className="hero-risk">Stock Tokens are not shares and may be restricted in your jurisdiction. Review eligibility and product risks before transacting. <a href="https://robinhood.com/eu/en/support/articles/about-stock-tokens/" target="_blank" rel="noreferrer">Learn about Stock Token risks ↗</a></p><div className="hero-proof"><span>SELF-CUSTODY ROUTING</span><strong>Desktop, QR and mobile wallets</strong><small>Live quote · exact Permit2 order · slippage protected</small></div></div>
          </div>

          <div className="feature-dock">
            <button onClick={() => openComposer("Buy")}><span>01</span><div><strong>USDG Buy</strong><small>Direct mainnet swap with live quote</small></div><b>&rarr;</b></button>
            <button onClick={() => openComposer("Sell")}><span>02</span><div><strong>Sell to USDG</strong><small>Protected mainnet exit with live quote</small></div><b>&rarr;</b></button>
            <button onClick={() => navigate("assets")}><span>03</span><div><strong>Asset Explorer</strong><small>{priceState === "loading" ? "Syncing onchain prices" : `${priceCounts.available}/25 token prices available`}</small></div><b>&rarr;</b></button>
          </div>

          <div className="preview-callout mainnet-callout"><div><strong>Direct Stock Token Buy and Sell is live</strong><span>All 15 full-fill V3/V4 routes receive a fresh quote before every order. Tokens without verified liquidity remain visible and blocked.</span></div><b>MAINNET BETA</b></div>

          <div className="price-tape-head"><span>ONCHAIN ORACLE PRICES</span><button onClick={() => navigate("assets")}>Open all 25 <b>&rarr;</b></button></div>
          <div className="price-tape">
            {priceSpotlight.map((ticker) => <button key={ticker} onClick={() => openAsset(ticker)}><Mark ticker={ticker} small /><p><span>{ticker}</span><strong>{formatPrice(priceBook[ticker]?.price)}</strong></p><small className={priceBook[ticker]?.status ?? "loading"}><i />{priceBook[ticker]?.status === "live" ? formatPriceAge(priceBook[ticker].updatedAt) : priceBook[ticker]?.status ?? "Syncing"}</small></button>)}
          </div>

          <div className="overview-grid">
            <article className="balance-card dark-card">
              <div className="card-label"><span>{connected ? "CONNECTED WALLET" : "YOUR MAINNET WALLET"}</span><span className="live-label"><i /> MAINNET</span></div>
              <div className="balance-line"><strong>{connected ? `${walletUsdgBalance} USDG` : "— USDG"}</strong><span>{connected ? `${walletBalance} ETH gas · ${compactAddress(walletAddress)}` : "Connect to view real balances and sign orders"}</span></div>
              <div className="wallet-facts"><div><span>CHAIN</span><strong>Robinhood / 4663</strong></div><div><span>BUY ROUTER</span><strong>Universal Router</strong></div><div><span>ORDER PERMISSION</span><strong>Exact amount / 10 min</strong></div><div><span>CUSTODY</span><strong>Your wallet</strong></div></div>
              <button className="wallet-card-action" onClick={handleWalletButton}>{connected ? "Disconnect wallet" : "Connect mainnet wallet"}</button>
            </article>
            <article className="stats-stack">
              <div className="stat-card"><span>YOUR MAINNET ORDERS</span><strong>{confirmedCount + preparedCount}</strong><small>{confirmedCount} confirmed buys · {preparedCount} recurring</small><div className="mini-bars"><i /><i /><i /><i /><i /><i /></div></div>
              <div className="stat-card fee-card"><span>VERIFIED PRICE FEEDS</span><strong>{priceState === "loading" ? "—" : priceState === "error" ? "Unavailable" : priceCounts.live}</strong><small>{priceState === "error" ? "Trading disabled until verification completes" : "Oracle reference · execution quoted live"}</small><b className="delta">BLOCK #{networkBlock}</b></div>
            </article>
          </div>

          <div className="section-title how-title"><div><p className="eyebrow">HOW HOODFLOW WORKS</p><h2>Three steps. You stay in control.</h2></div><button onClick={() => navigate("assets")}>See every asset <span>&rarr;</span></button></div>
          <div className="how-grid">
            <article><span>01</span><div><strong>Choose an asset</strong><p>Pick from 15 full-fill verified assets across Uniswap V3 and V4. Watch-only assets stay visible without an unsafe order button.</p></div></article>
            <article><span>02</span><div><strong>Review the live quote</strong><p>HoodFlow checks all three reviewed V4 pools, then protects the order with your slippage limit.</p></div></article>
            <article><span>03</span><div><strong>Approve only the order</strong><p>Permit2 signs the exact USDG amount. The Universal Router sends the stock token straight to your wallet.</p></div></article>
          </div>

          <div className="section-title"><div><p className="eyebrow">MAINNET HISTORY</p><h2>Your orders</h2></div><button onClick={() => navigate("strategies")}>View all <span>&rarr;</span></button></div>
          <div className="strategy-list">
            {strategies.slice(0, 3).map((item) => <StrategyRow key={item.id} item={item} onToggle={() => toggleStrategy(item.id)} onInspect={() => setSelectedStrategy(item)} />)}
            {strategies.length === 0 && <div className="empty-state order-empty"><strong>No mainnet orders yet</strong><span>Connect a wallet and place your first protected USDG buy.</span><button onClick={() => openComposer("Buy", "INTC")}>Buy INTC</button></div>}
          </div>

          <div className="trust-strip">
            <div><span className="trust-icon">P</span><p><strong>Bounded permissions</strong><small>Every strategy has an asset allowlist, spending cap and expiry.</small></p></div>
            <div><span className="trust-icon">R</span><p><strong>Receipts, not promises</strong><small>Every completed buy links to its Robinhood Chain transaction.</small></p></div>
            <button onClick={() => navigate("controls")}>Open controls &rarr;</button>
          </div>
        </section>
      )}

      {view === "strategies" && (
        <section className="page inner-page">
          <div className="inner-heading"><div><p className="eyebrow">AUTOMATION DESK</p><h1>Orders & strategies</h1><p>Every direct buy, rule, limit and execution state in one place.</p></div><button className="primary-action" onClick={() => openComposer()}><span>+</span> New order</button></div>
          <div className="device-save-note"><span><i /> RECEIPTS SAVED ON THIS DEVICE</span><p>Only your confirmed transaction references and onchain strategy IDs are kept here. Wallet keys and account data are never stored.</p></div>
          <div className="summary-row"><div><span>Confirmed buys</span><strong>{confirmedCount}</strong></div><div><span>Prepared DCA</span><strong>{preparedCount}</strong></div><div><span>Mainnet records</span><strong>{activityRows.length}</strong></div><div><span>DCA engine</span><strong>{contractReady ? "Live" : "Pending"}</strong></div></div>
          <div className="table-card">
            <div className="table-head upgraded"><span>ORDER</span><span>RULE</span><span>RESULT / NEXT ACTION</span><span>CHAIN</span><span>STATUS</span><span /></div>
            {strategies.map((item) => <StrategyRow key={item.id} item={item} detailed onToggle={() => toggleStrategy(item.id)} onInspect={() => setSelectedStrategy(item)} />)}
            {strategies.length === 0 && <div className="empty-state order-empty"><strong>No onchain orders saved</strong><span>Place a mainnet buy and its receipt will appear here.</span><button onClick={() => openComposer("Buy")}>New mainnet order</button></div>}
          </div>
        </section>
      )}

      {view === "assets" && (
        <section className="page inner-page assets-page">
          <div className="asset-hero">
            <div><p className="eyebrow">ROBINHOOD ASSET MATRIX</p><h1>Twenty-five assets.<br /><span>Priced onchain.</span></h1><p>Every canonical Robinhood stock token and ETF is indexed with its real brand mark and multiplier-adjusted Chainlink token price. HoodFlow only enables assets that completed a full-input fork swap; everything else stays safely watch-only.</p></div>
            <div className="asset-totals"><div><strong>25</strong><span>INDEXED TOKENS</span></div><div><strong>15</strong><span>FULL-FILL READY</span></div><div><strong>10</strong><span>WATCH-ONLY</span></div></div>
          </div>
          <div className="asset-logo-cloud" aria-label="All supported brands">{assetRegistry.map((asset) => <Mark key={asset.ticker} ticker={asset.ticker} small />)}<span>20 stocks + 5 ETFs</span></div>
          <div className={`price-source-bar ${priceState}`}>
            <div><span><i /> CHAINLINK ORACLE / ROBINHOOD MAINNET</span><strong>{priceState === "loading" ? "Syncing price feeds" : `${priceCounts.live} current · ${priceCounts.guarded} guarded · ${25 - priceCounts.available} unavailable`}</strong></div>
            <p><strong>Onchain token price</strong><span>Includes Robinhood&apos;s corporate-action multiplier, so it can differ from the headline share price.</span>{priceError && <small>{priceError}</small>}</p>
            <div className="price-refresh"><span>{priceUpdatedAt ? `Checked ${new Date(priceUpdatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · every 10s` : "Waiting for first check"}</span><button onClick={() => void refreshPrices()} disabled={priceRefreshing}>{priceRefreshing ? "Checking" : "Check now"}</button></div>
          </div>
          <div className="route-explainer"><div><b className="route-ready"><i />READY</b><p><strong>Can be bought with USDG</strong><span>A full-input fork swap passed. All reviewed pools are quoted again before every mainnet order.</span></p></div><div><b className="route-watch"><i />WATCH</b><p><strong>Visible, never forced</strong><span>No order is enabled until a full-fill route passes. MSFT stays blocked after a deterministic-fork partial fill, even when a live quote appears.</span></p></div></div>
          <div className="asset-toolbar">
            <div>{(["all", "routed", "registry"] as const).map((scope) => <button key={scope} className={assetScope === scope ? "selected" : ""} onClick={() => setAssetScope(scope)}>{scope === "all" ? "All 25" : scope === "routed" ? "Full-fill ready" : "Watch-only"}</button>)}</div>
            <label><span>Q</span><input aria-label="Search assets" placeholder="Ticker or company" value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} /></label>
          </div>
          <p className="result-count">Showing {visibleAssets.length} of 25 assets</p>
          <div className="asset-table">
            <div className="asset-table-head"><span>ASSET</span><span>ONCHAIN PRICE</span><span>TYPE</span><span>STATUS</span><span>WHAT HOODFLOW WILL DO</span></div>
            {visibleAssets.map(({ ticker, name, type, fullFill }) => <article className="asset-catalog-row" key={ticker}><button className="asset-identity" onClick={() => openAsset(ticker)}><Mark ticker={ticker} /><p><strong>{ticker}</strong><small>{name}</small></p><span>Open →</span></button><PriceCell point={priceBook[ticker]} loading={priceState === "loading"} /><span className="asset-type">{type}</span><b className={fullFill ? "route-ready" : "route-watch"}><i />{fullFill ? "Ready" : "Watch-only"}</b>{fullFill ? <div className="asset-row-actions"><button onClick={() => openAsset(ticker)}>Details</button><button className="asset-buy" onClick={() => openComposer("Buy", ticker)}>Buy with USDG</button></div> : <button className="asset-details-only" onClick={() => openAsset(ticker)}>{ticker === "MSFT" ? "Partial fill · details" : "No route · details"}</button>}</article>)}
            {visibleAssets.length === 0 && <div className="empty-state"><strong>No matching asset</strong><span>Try another ticker or clear the current filter.</span></div>}
          </div>
          <p className="asset-footnote">Oracle prices are checked every 10 seconds but update only when Chainlink publishes a new round. They are informational references, not execution quotes. Every Buy or Sell receives a fresh DEX quote before wallet confirmation.</p>
        </section>
      )}

      {view === "asset" && (
        <section className="page inner-page asset-detail-page">
          <button className="asset-back" onClick={() => navigate("assets")}>← All assets</button>
          <div className="asset-detail-head">
            <div className="asset-detail-title"><Mark ticker={selectedAsset.ticker} /><div><p className="eyebrow">{selectedAsset.type.toUpperCase()} TOKEN / ROBINHOOD MAINNET</p><h1>{selectedAsset.name} <span>{selectedAsset.ticker}</span></h1></div></div>
            <div className={`asset-detail-status ${selectedAsset.fullFill ? "ready" : "watch"}`}><i /><span>{selectedAsset.fullFill ? "BUY + SELL READY" : "WATCH-ONLY"}</span></div>
          </div>
          <div className="asset-detail-grid">
            <article className="asset-chart-card">
              <div className="asset-price-line"><div><span>ONCHAIN TOKEN PRICE</span><strong>{formatPrice(priceBook[selectedAsset.ticker]?.price)}</strong><small>{priceBook[selectedAsset.ticker]?.status === "live" ? formatPriceAge(priceBook[selectedAsset.ticker].updatedAt) : priceBook[selectedAsset.ticker]?.status ?? "Syncing"}</small></div>{historyStats && <div className={historyStats.change >= 0 ? "positive" : "negative"}><span>ROUND RANGE</span><strong>{historyStats.change >= 0 ? "+" : ""}{historyStats.change.toFixed(2)}%</strong><small>{priceHistory.length} verified rounds</small></div>}</div>
              <PriceHistoryChart points={priceHistory} loading={historyLoading} />
              <div className="asset-chart-foot"><div><span>RANGE LOW</span><strong>{historyStats ? formatPrice(historyStats.low) : "—"}</strong></div><div><span>RANGE HIGH</span><strong>{historyStats ? formatPrice(historyStats.high) : "—"}</strong></div><div><span>HEARTBEAT</span><strong>{Math.round((priceBook[selectedAsset.ticker]?.heartbeat ?? 86_400) / 3_600)}h</strong></div><div><span>ORACLE</span><strong>{priceBook[selectedAsset.ticker]?.oraclePaused === false ? "Active" : priceBook[selectedAsset.ticker]?.oraclePaused === true ? "Paused" : "Unavailable"}</strong></div></div>
              {historyError && <p className="history-error">{historyError}</p>}
            </article>
            <aside className="asset-trade-card">
              <p className="eyebrow">BUY WITH USDG</p>
              <h2>{selectedAsset.fullFill ? `Trade ${selectedAsset.ticker} on mainnet` : `${selectedAsset.ticker} is not tradable yet`}</h2>
              <p>{selectedAsset.fullFill ? `Buy with USDG or sell ${selectedAsset.ticker} back to USDG through ${isV3RoutedAsset(selectedAsset.ticker) ? "the verified Uniswap V3 pool" : "the best reviewed Uniswap V4 pool"}. Every order uses an exact short-lived permission.` : selectedAsset.ticker === "MSFT" ? "A quote exists, but the full router fork test detected a partial fill. HoodFlow blocks the order until complete-input execution is verified." : "No reviewed USDG pool can currently fill the complete input. The asset remains indexed and monitored without exposing your wallet to a forced route."}</p>
              <div className="trade-route-facts"><div><span>NETWORK</span><strong>Robinhood Chain / 4663</strong></div><div><span>PAY</span><strong>USDG</strong></div><div><span>RECEIVE</span><strong>{selectedAsset.ticker} token</strong></div><div><span>ROUTE</span><strong>{selectedAsset.fullFill ? `${isV3RoutedAsset(selectedAsset.ticker) ? "V3" : "V4"} full-fill verified` : "Blocked"}</strong></div></div>
              <div className="asset-trade-actions"><button className="primary-action asset-trade-action" onClick={() => openComposer("Buy", selectedAsset.ticker)} disabled={!selectedAsset.fullFill || priceBook[selectedAsset.ticker]?.status !== "live"}>{selectedAsset.fullFill ? priceBook[selectedAsset.ticker]?.status === "live" ? `Buy ${selectedAsset.ticker}` : "Waiting for oracle" : "No safe route"}</button><button className="asset-sell-action" onClick={() => openComposer("Sell", selectedAsset.ticker)} disabled={!selectedAsset.fullFill || priceBook[selectedAsset.ticker]?.status !== "live"}>Sell to USDG</button></div>
              {!connected && selectedAsset.fullFill && <button className="connect-inline" onClick={handleWalletButton}>Connect wallet first</button>}
            </aside>
          </div>
          <div className="asset-contract-card">
            <div><span>TOKEN CONTRACT</span><a href={`${ROBINHOOD_MAINNET.blockExplorerUrls[0]}/address/${ROBINHOOD_TOKENS[selectedAsset.ticker]}`} target="_blank" rel="noreferrer">{compactAddress(ROBINHOOD_TOKENS[selectedAsset.ticker])} ↗</a></div>
            <div><span>CHAINLINK FEED</span><strong>{ROBINHOOD_PRICE_FEEDS[selectedAsset.ticker as keyof typeof ROBINHOOD_PRICE_FEEDS].feed ? compactAddress(ROBINHOOD_PRICE_FEEDS[selectedAsset.ticker as keyof typeof ROBINHOOD_PRICE_FEEDS].feed!) : "Not listed"}</strong></div>
            <div><span>EXECUTION POLICY</span><strong>{selectedAsset.fullFill ? "Fresh quote + slippage floor" : "Order disabled"}</strong></div>
            <div><span>CUSTODY</span><strong>Self-custody</strong></div>
          </div>
          <p className="asset-footnote">The chart contains real Chainlink rounds read from Robinhood Chain. It is not fabricated market data, an execution quote, or a promise of return.</p>
        </section>
      )}

      {view === "marketplace" && (
        <section className="page inner-page">
          <div className="market-hero"><p className="eyebrow">STRATEGY TEMPLATES</p><h1>Start with a rule.<br />Set your own cap.</h1><p>Plain-language DCA templates with no invented performance, copy counts or return claims. Each template opens an editable order; nothing moves before your wallet confirms.</p></div>
          <div className="market-toolbar"><div>{(["featured", "cadence", "risk"] as MarketplaceSort[]).map((sort) => <button key={sort} className={marketSort === sort ? "selected" : ""} onClick={() => setMarketSort(sort)}>{sort === "featured" ? "Featured" : sort === "cadence" ? "By cadence" : "By style"}</button>)}</div><label><span>Q</span><input aria-label="Search strategies" placeholder="Template or ticker" value={marketSearch} onChange={(event) => setMarketSearch(event.target.value)} /></label></div>
          <div className="market-grid">
            {visibleMarketplace.map((item, index) => (
              <article className="market-card" key={item.name}>
                <div className="market-number">0{index + 1}</div><div className="market-top"><span className={`risk risk-${index}`}>{item.risk}</span><span>{item.cadence} cadence</span></div>
                <h2>{item.name}</h2><p>{item.desc}</p><div className="asset-pile">{item.assets.map((asset) => <Mark key={asset} ticker={asset} small />)}</div>
                <div className="market-metrics triple"><div><span>FIRST ASSET</span><strong>{item.assets[0]}</strong></div><div><span>SCHEDULE</span><strong>{item.cadence}</strong></div><div><span>ENGINE</span><strong>{contractReady ? "Live" : "Pending"}</strong></div></div>
                <div className="creator"><span>You choose the amount, cap and slippage</span><button onClick={() => applyTemplate(item.assets[0], item.cadence, item.name)}>Use template</button></div>
              </article>
            ))}
            {visibleMarketplace.length === 0 && <div className="empty-state market-empty"><strong>No strategy found</strong><span>Try another name or asset ticker.</span></div>}
          </div>
          <p className="market-note">Recurring templates remain disabled until the HoodFlow engine is deployed, verified and unpaused on mainnet.</p>
        </section>
      )}

      {view === "activity" && (
        <section className="page inner-page">
          <div className="inner-heading"><div><p className="eyebrow">MAINNET RECEIPTS</p><h1>Activity</h1><p>Only wallet-confirmed transactions saved by this browser appear here.</p></div><button className="secondary-action" onClick={exportActivity} disabled={activityRows.length === 0}>Export CSV</button></div>
          <div className="activity-card">
            {activityRows.map((item) => <div className="activity-row" key={item.id}><Mark ticker={item.asset} /><div><strong>{item.kind === "Buy" ? "Mainnet buy" : "Recurring strategy created"}</strong><small>{item.name}</small></div><p>{item.detail}</p><time>{new Date(item.createdAt).toLocaleString()}</time><a className="activity-status" href={`${ROBINHOOD_MAINNET.blockExplorerUrls[0]}/tx/${item.txHash}`} target="_blank" rel="noreferrer">Receipt ↗</a></div>)}
            {activityRows.length === 0 && <div className="empty-state order-empty"><strong>No mainnet activity yet</strong><span>Completed buys and confirmed DCA strategies will appear here with explorer receipts.</span><button onClick={() => openComposer("Buy")}>Place an order</button></div>}
          </div>
        </section>
      )}

      {view === "controls" && (
        <section className="page inner-page controls-page">
          <div className="inner-heading"><div><p className="eyebrow">SECURITY & PERMISSIONS</p><h1>Your wallet stays in control.</h1><p>See what HoodFlow can do, what it cannot do, and every permission you have approved.</p></div></div>
          <div className="control-grid">
            <article className="control-card"><span>CUSTODY</span><strong>Funds stay in your wallet</strong><p>HoodFlow cannot withdraw assets by itself. Every Buy and Sell order requires your wallet confirmation.</p><b className="control-ok">YOU CONTROL</b></article>
            <article className="control-card"><span>BUY & SELL</span><strong>15 verified routes</strong><p>Fresh quotes, maximum slippage protection, and exact short-lived order permissions.</p><b className="control-ok">LIVE</b></article>
            <article className="control-card"><span>RECURRING DCA</span><strong>{contractReady ? "Active" : enginePaused ? "Ready to activate" : "Checking"}</strong><p>{contractReady ? "Your capped recurring strategies can run onchain." : enginePaused ? "Only the owner wallet can switch the DCA engine on." : contractStatus}</p><b className={`control-ok ${contractReady ? "" : "warning"}`}>{contractReady ? "LIVE" : "OWNER ACTION"}</b></article>
          </div>
          <div className="permissions-card">
            <div className="permissions-head"><div><p className="eyebrow">ONCHAIN ORDERS</p><h2>Strategy permissions</h2></div><span>{strategies.length} records</span></div>
            {strategies.map((item) => <div className="permission-row" key={item.id}><div className="permission-name"><Mark ticker={item.asset} /><p><strong>{item.name}</strong><small>{item.asset} only</small></p></div><div><span>SPENDING CAP</span><strong>{item.budget}</strong></div><div><span>EXPIRES</span><strong>{item.expires}</strong></div><div><span>CHAIN</span><strong>Mainnet</strong></div><button onClick={() => toggleStrategy(item.id)} disabled={item.status === "Confirmed"}>{item.status === "Confirmed" ? "Settled" : item.status === "Prepared" ? "Pause" : "Resume"}</button></div>)}
            {strategies.length === 0 && <div className="empty-state"><strong>No active permissions</strong><span>No HoodFlow strategy currently has a saved onchain permission.</span></div>}
          </div>
          <div className="safety-notes"><article><span>01</span><div><strong>Asset allowlist</strong><p>A strategy cannot swap into a token that was not approved when it was created.</p></div></article><article><span>02</span><div><strong>Hard budget caps</strong><p>Keepers cannot execute above the per-trade or lifetime spending limit.</p></div></article><article><span>03</span><div><strong>Automatic circuit breaker</strong><p>Stale prices, excess slippage or low liquidity stop execution before a swap.</p></div></article></div>
        </section>
      )}

      <footer><span>HoodFlow Labs · Independent interface · Build 22</span><div><button onClick={() => navigate("controls")}>Security</button><button onClick={() => setInfoPanel("docs")}>Quick guide</button><button onClick={() => setInfoPanel("terms")}>Product risks</button></div><span className="chain-tag mainnet-tag"><i /> MAINNET BETA</span></footer>

      {composerOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setComposerOpen(false); }}>
          <section className="composer wide-composer" role="dialog" aria-modal="true" aria-labelledby="composer-title">
            <div className="composer-head"><div><p className="eyebrow">NEW ORDER</p><h2 id="composer-title">{kind === "Buy" ? "Buy with limits." : kind === "Sell" ? "Sell to USDG." : "Automate with limits."}</h2></div><button aria-label="Close strategy builder" onClick={() => setComposerOpen(false)} disabled={onchainBusy}>x</button></div>
            <div className="kind-grid">
              {(["Buy", "Sell", "DCA"] as StrategyKind[]).map((item, index) => <button type="button" key={item} className={kind === item ? "selected" : ""} onClick={() => openComposer(item, draftAsset)} disabled={onchainBusy}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item === "Buy" ? "Buy now" : item === "Sell" ? "Sell now" : "Recurring DCA"}</strong><small>{item === "Buy" ? "USDG to stock token" : item === "Sell" ? "Stock token to USDG" : contractReady ? "Recurring mainnet buys" : enginePaused ? "Owner activation required" : "Checking engine"}</small></button>)}
            </div>
            <form onSubmit={createStrategy}>
              <label>ORDER NAME<input name="name" value={draftName} onChange={(event) => setDraftName(event.target.value)} required disabled={onchainBusy} /></label>
              <div className="asset-choice"><Mark ticker={draftAsset} /><label>ASSET <small>{kind === "DCA" ? "13 recurring V4 routes" : "15 verified swap routes"}</small><select name="asset" value={draftAsset} onChange={(event) => setDraftAsset(event.target.value)}>{assetRegistry.filter((asset) => asset.fullFill && (kind !== "DCA" || !isV3RoutedAsset(asset.ticker))).map((asset) => <option key={asset.ticker} value={asset.ticker}>{asset.ticker} · {asset.name} · {formatPrice(priceBook[asset.ticker]?.price)}</option>)}</select></label></div>
              <div className="form-pair">
                <label>{kind === "Buy" ? "TOTAL TO SPEND" : kind === "Sell" ? "AMOUNT TO SELL" : "EACH BUY"}<span className="input-unit"><input name="amount" type="number" min="0.000001" step="0.000001" value={draftAmount} onChange={(event) => setDraftAmount(event.target.value)} required disabled={onchainBusy} /><b>{kind === "Sell" ? draftAsset : "USDG"}</b></span></label>
                <label>MAX SLIPPAGE<span className="input-unit"><input name="slippage" type="number" min="0.1" max="5" step="0.1" value={draftSlippage} onChange={(event) => setDraftSlippage(event.target.value)} required disabled={onchainBusy} /><b>%</b></span></label>
              </div>
              {kind === "DCA" && <div className="form-pair"><label>SCHEDULE<select name="frequency" value={draftFrequency} onChange={(event) => setDraftFrequency(event.target.value)} disabled={onchainBusy}><option>Daily</option><option>Weekly</option><option>Monthly</option></select></label><label>NUMBER OF BUYS<span className="input-unit"><input name="executions" type="number" min="2" max={draftFrequency === "Daily" ? "52" : draftFrequency === "Weekly" ? "52" : "12"} value={draftExecutions} onChange={(event) => setDraftExecutions(event.target.value)} disabled={onchainBusy} /><b>×</b></span></label></div>}
              <div className="live-order-banner"><i /><span><strong>{kind === "Buy" ? "Buy stock tokens with USDG" : kind === "Sell" ? `Sell ${draftAsset} back to USDG` : contractReady ? "Mainnet recurring strategy" : enginePaused ? "DCA engine awaits owner activation" : "Checking recurring engine"}</strong><small>{kind === "Buy" ? "Your wallet confirms a protected mainnet buy." : kind === "Sell" ? "Your wallet confirms an exact-token sell; USDG returns directly to you." : contractReady ? "The onchain engine enforces your schedule and lifetime cap." : enginePaused ? "Connect the owner wallet and confirm one activation transaction." : "Buy and Sell remain available while the engine check completes."}</small></span><b>{kind !== "DCA" || contractReady ? "LIVE" : enginePaused ? "READY" : "CHECKING"}</b></div>
              <div className="execution-preview"><div className="preview-head"><span>ORDER REVIEW</span><b>{kind === "DCA" ? contractReady ? "MAINNET DCA" : enginePaused ? "OWNER ACTIVATION REQUIRED" : "ENGINE CHECK" : "MAINNET · WALLET CONFIRMATION"}</b></div><div className="preview-grid"><p><span>Estimated receive</span><strong>{kind === "Sell" ? `${estimatedUnits} USDG` : `${estimatedUnits} ${draftAsset}${kind === "DCA" ? " each" : ""}`}</strong></p><p><span>{kind === "Sell" ? "Sell amount" : "Total USDG cap"}</span><strong>{kind === "Sell" ? `${draftAmount || "0"} ${draftAsset}` : `${draftTotalBudget.toFixed(2)} USDG`}</strong></p><p><span>Execution protection</span><strong>{kind === "DCA" ? `${draftSlippage}% max · engine cap` : `${isV3RoutedAsset(draftAsset) ? "Verified V3 pool" : "Best reviewed V4 pool"} · ${draftSlippage}% max`}</strong></p><p><span>Oracle status</span><strong>{priceBook[draftAsset]?.status === "live" ? formatPriceAge(priceBook[draftAsset].updatedAt) : priceBook[draftAsset]?.status ?? "Syncing"}</strong></p></div></div>
              <div className="limit-note"><span>✓</span><p><strong>{kind === "DCA" ? "Spending limits stay enforced onchain." : "The order permission is exact and short-lived."}</strong><small>{kind === "Buy" ? "HoodFlow signs only this USDG amount for the router." : kind === "Sell" ? `HoodFlow signs only the selected ${draftAsset} amount; sale proceeds return as USDG.` : "The recurring engine cannot execute outside the selected asset, total budget, schedule and expiry."}</small></p></div>
              {transactionStep && <div className="transaction-step"><i /><span>{transactionStep}</span></div>}
              <div className="composer-actions"><button type="button" onClick={() => setComposerOpen(false)} disabled={onchainBusy}>Cancel</button><button type="submit" className="primary-action" disabled={onchainBusy || (kind === "DCA" && !contractReady && !enginePaused)}>{onchainBusy ? "Working…" : kind === "Buy" ? connected ? `Buy ${draftAsset} with USDG` : "Connect wallet first" : kind === "Sell" ? connected ? `Sell ${draftAsset} for USDG` : "Connect wallet first" : contractReady ? "Create onchain DCA" : enginePaused ? connected ? "Activate DCA engine" : "Connect owner wallet to activate" : "Checking engine"} <span>&rarr;</span></button></div>
            </form>
          </section>
        </div>
      )}

      {selectedStrategy && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedStrategy(null); }}><section className="detail-drawer" role="dialog" aria-modal="true" aria-label={`${selectedStrategy.name} details`}><div className="composer-head"><div><p className="eyebrow">MAINNET ORDER</p><h2>{selectedStrategy.name}</h2></div><button onClick={() => setSelectedStrategy(null)}>x</button></div><div className="order-status-hero"><Mark ticker={selectedStrategy.asset} /><div><strong>{selectedStrategy.status}</strong><span>{selectedStrategy.detail}</span></div></div><div className="health-checks"><div><span>Network</span><strong>Robinhood Chain <b>4663</b></strong></div><div><span>Order type</span><strong>{selectedStrategy.kind} <b>ONCHAIN</b></strong></div><div><span>Asset</span><strong>{selectedStrategy.asset} <b>ONLY</b></strong></div><div><span>Created</span><strong>{new Date(selectedStrategy.createdAt).toLocaleString()}</strong></div></div><div className="permission-summary"><p><span>Rule</span><strong>{selectedStrategy.rule}</strong></p><p><span>Spending cap</span><strong>{selectedStrategy.budget}</strong></p><p><span>Permission expires</span><strong>{selectedStrategy.expires}</strong></p></div>{selectedStrategy.txHash ? <a className="drawer-action receipt-link" href={`${ROBINHOOD_MAINNET.blockExplorerUrls[0]}/tx/${selectedStrategy.txHash}`} target="_blank" rel="noreferrer">View mainnet receipt ↗</a> : null}</section></div>}

      {walletModalOpen && !connected && <div className="confirm-backdrop wallet-connect-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !walletConnecting) setWalletModalOpen(false); }}><section className="wallet-connect-card" role="dialog" aria-modal="true" aria-labelledby="wallet-connect-title"><div className="composer-head"><div><p className="eyebrow">NON-CUSTODIAL CONNECTION</p><h2 id="wallet-connect-title">Choose your wallet.</h2></div><button aria-label="Close wallet options" onClick={() => setWalletModalOpen(false)} disabled={walletConnecting}>x</button></div><p className="wallet-connect-intro">HoodFlow never receives your private key. Your wallet signs every mainnet permission and transaction.</p><div className="wallet-connect-options"><button type="button" className="wallet-option wallet-option-wc" onClick={() => void connectWalletConnect()} disabled={walletConnecting || walletConnectReady !== true}><span className="wallet-option-icon">W</span><span><strong>WalletConnect</strong><small>{walletConnectReady === null ? "Checking availability…" : walletConnectReady ? "QR code · mobile deep link · 500+ wallets" : "Activation pending"}</small></span><b>{walletConnectReady ? "RECOMMENDED" : "NEEDS ID"}</b></button><button type="button" className="wallet-option" onClick={() => void connectBrowserWallet()} disabled={walletConnecting}><span className="wallet-option-icon browser">↗</span><span><strong>Browser wallet</strong><small>Robinhood Wallet · MetaMask · injected wallets</small></span><b>DESKTOP</b></button></div><div className="wallet-connect-foot"><span><i /> Robinhood Chain</span><strong>CHAIN ID 4663</strong></div></section></div>}

      {infoPanel && <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setInfoPanel(null); }}><section className="info-card" role="dialog" aria-modal="true" aria-labelledby="info-title"><div className="composer-head"><div><p className="eyebrow">{infoPanel === "docs" ? "QUICK GUIDE" : "PRODUCT RISKS"}</p><h2 id="info-title">{infoPanel === "docs" ? "Know every status." : "Understand before you trade."}</h2></div><button aria-label="Close information" onClick={() => setInfoPanel(null)}>x</button></div>{infoPanel === "docs" ? <div className="info-list"><article><span>01</span><p><strong>Buy or sell</strong><small>HoodFlow compares reviewed liquidity routes and returns a protected quote.</small></p></article><article><span>02</span><p><strong>Exact order permission</strong><small>Permit2 signs only the selected token amount for ten minutes.</small></p></article><article><span>03</span><p><strong>Full-fill ready</strong><small>The complete input passed a router fork test. A fresh quote is still required.</small></p></article><article><span>04</span><p><strong>Watch-only</strong><small>The token remains visible, but HoodFlow blocks trading until a route is verified.</small></p></article><article><span>05</span><p><strong>Recurring DCA</strong><small>A separate optional automation layer; direct Buy and Sell remain the primary product.</small></p></article></div> : <div className="info-copy"><p><strong>Stock Tokens are not shares.</strong> Robinhood describes them as derivative contracts that track an underlying security without granting shareholder rights.</p><p>Stock Tokens carry a high level of risk, may not be appropriate for every investor, and eligibility or jurisdictional restrictions can apply.</p><p>HoodFlow is an independent interface built on Robinhood Chain. It is not affiliated with or endorsed by Robinhood Markets, Inc.</p><p>Verify the token amount, minimum output and router address in your wallet before signing. Network gas is paid in ETH.</p><p><a href="https://robinhood.com/eu/en/support/articles/about-stock-tokens/" target="_blank" rel="noreferrer">Review Robinhood&apos;s Stock Token explanation and risks ↗</a></p></div>}<button className="drawer-action" onClick={() => setInfoPanel(null)}>Got it</button></section></div>}

      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}

function StrategyRow({ item, detailed = false, onToggle, onInspect }: { item: Strategy; detailed?: boolean; onToggle: () => void; onInspect: () => void }) {
  return <article className={`strategy-row ${detailed ? "detailed upgraded" : ""}`}><div className="strategy-name"><Mark ticker={item.asset} /><p><strong>{item.name}</strong><small>{item.kind} · {item.asset}</small></p></div><div className="rule-cell"><span>{detailed ? "" : "RULE"}</span><strong>{item.rule}</strong></div><div className="next-cell"><span>{detailed ? "" : "RESULT"}</span><strong>{item.detail}</strong></div>{detailed && <div className="health-cell"><strong>4663</strong><span>MAINNET</span></div>}<button className={`status-button ${item.status.toLowerCase()}`} onClick={onToggle} disabled={item.status === "Confirmed"}><i />{item.status}</button><button className="row-more" onClick={onInspect} aria-label={`Inspect ${item.name}`}>DETAILS</button></article>;
}
