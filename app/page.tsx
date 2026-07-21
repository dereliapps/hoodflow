/* eslint-disable @next/next/no-img-element -- local brand marks are intentionally served as original logo assets. */
"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
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
  friendlyExecutionError,
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
import { track } from "@/lib/analytics-client";
import MarketStatus from "./market-status";
import type { PrivyWalletController } from "./privy-wallet-bridge";
import { PRIVY_CONFIGURED } from "./privy-config";
import RobinHoodIntro from "./robin-hood-intro";

function WorkspaceLoader({ label }: { label: string }) {
  return <section className="workspace-loader" role="status" aria-live="polite"><i /><strong>{label}</strong><span>Preparing the latest onchain view.</span></section>;
}

const CommunityTokens = dynamic(() => import("./community-tokens"), { ssr: false, loading: () => <WorkspaceLoader label="Loading crypto markets" /> });
const AgentsWorkspace = dynamic(() => import("./agents-workspace"), { ssr: false, loading: () => <WorkspaceLoader label="Loading agent execution" /> });
const AssetRequestBoard = dynamic(() => import("./asset-request-board"), { ssr: false, loading: () => <WorkspaceLoader label="Loading asset requests" /> });
const ReferralRewards = dynamic(() => import("./referral-rewards"), { ssr: false, loading: () => <WorkspaceLoader label="Loading rewards" /> });
const PrivyWalletRuntime = dynamic(() => import("./privy-wallet-runtime"), { ssr: false });

type View = "overview" | "strategies" | "assets" | "asset" | "community" | "agents" | "portfolio" | "rewards" | "marketplace" | "activity" | "controls";
type StrategyKind = "Buy" | "Sell" | "DCA";
type StrategyStatus = "Prepared" | "Paused" | "Confirmed" | "Cancelled";
type MarketplaceSort = "featured" | "cadence" | "risk";
type ActivityFilter = "all" | "trades" | "dca";
type InfoPanel = "docs" | "terms";
type PriceState = "loading" | "live" | "degraded" | "error";
type WalletConnectionKind = "browser" | "walletconnect" | "privy";
type WalletProviderEventHandler = (...args: unknown[]) => void;
type HoodFlowWalletProvider = Eip1193Provider & {
  disconnect?: () => Promise<void>;
  on?: (event: "accountsChanged" | "chainChanged" | "disconnect", listener: WalletProviderEventHandler) => void;
  removeListener?: (event: "accountsChanged" | "chainChanged" | "disconnect", listener: WalletProviderEventHandler) => void;
};
type InjectedWalletProvider = HoodFlowWalletProvider & {
  providers?: InjectedWalletProvider[];
  isMetaMask?: boolean;
  isRabby?: boolean;
  isOkxWallet?: boolean;
  isOKExWallet?: boolean;
};
type InjectedWalletPreference = "rabby" | "metamask" | "okx" | "browser";
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
  walletAddress: string;
  txHash?: string;
  chainStrategyId?: string;
  inputAmount?: number;
  outputAmount?: number;
};

type DirectQuotePreview = {
  protocol: "V3" | "V4";
  feeBps: number;
  amountOut: string;
  minimumOut: string;
  updatedAt: number;
};

type HistoryPoint = {
  roundId: string;
  price: number;
  updatedAt: number;
};

declare global {
  interface Window {
    okxwallet?: InjectedWalletProvider;
  }
}

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_HOODFLOW_CONTRACT_ADDRESS?.trim() || HOODFLOW_DCA_ADDRESS;
const contractConfigured = /^0x[a-fA-F0-9]{40}$/.test(CONTRACT_ADDRESS);
const ORDER_STORAGE_PREFIX = "hoodflow-mainnet-orders-v4";
const PRICE_CACHE_KEY = "hoodflow-live-prices-v1";
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
  { ticker: "SLV", name: "iShares Silver Trust", type: "ETF", fullFill: true, logo: "/logos/SLV.png" },
  { ticker: "SPY", name: "SPDR S&P 500", type: "ETF", fullFill: true, logo: "/logos/SPY.png" },
  { ticker: "CUSO", name: "United States Oil Fund", type: "ETF", fullFill: false, logo: "/logos/CUSO.png" },
] as const;

const assetByTicker = Object.fromEntries(assetRegistry.map((asset) => [asset.ticker, asset])) as Record<string, (typeof assetRegistry)[number]>;
const executionReadyAssetCount = assetRegistry.filter((asset) => asset.fullFill).length;
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
  return friendlyExecutionError(error);
}

async function getVerifiedSigner(provider: BrowserProvider, expectedAddress: string) {
  const signer = await provider.getSigner();
  const signerAddress = await signer.getAddress();
  if (signerAddress.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error("The active wallet account changed. Reconnect before signing this order.");
  }
  return signer;
}

async function getBestV4Quote(provider: BrowserProvider | JsonRpcProvider, tokenIn: string, tokenOut: string, amountIn: bigint) {
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
    return <div className="price-cell loading" aria-label="Connecting to the live Chainlink feed"><strong><span className="price-skeleton" /></strong><small><i />Connecting live feed</small></div>;
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

function PriceHistoryChart({ points, loading, livePoint }: { points: HistoryPoint[]; loading: boolean; livePoint?: PricePoint }) {
  if (loading) {
    return <div className="history-chart history-loading" aria-label="Loading verified Chainlink rounds"><div className="history-grid" /><div className="history-loading-line" /><i className="history-loading-dot" /><span>Loading verified rounds…</span></div>;
  }
  const livePrice = livePoint?.price;
  if (points.length < 2) {
    if (livePrice) {
      return <div className="history-chart history-live-point" aria-label={`Current verified oracle price ${formatPrice(livePrice)}`}><div className="history-grid" /><div className="history-reference-line" /><i className="latest" /><span><strong>{formatPrice(livePrice)}</strong>Current verified oracle point</span></div>;
    }
    return <div className="history-chart empty"><span>Price history is reconnecting.</span></div>;
  }
  const latestHistoryPoint = points.at(-1);
  const chartPoints = livePrice && livePoint?.updatedAt && (!latestHistoryPoint || livePoint.updatedAt > latestHistoryPoint.updatedAt)
    ? [...points, { roundId: `live:${livePoint.updatedAt}`, price: livePrice, updatedAt: livePoint.updatedAt }]
    : points;
  const prices = chartPoints.map((point) => point.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const spread = Math.max(high - low, high * 0.0025);
  const coordinates = chartPoints.map((point, index) => {
    const x = chartPoints.length === 1 ? 0 : index / (chartPoints.length - 1) * 100;
    const y = 88 - (point.price - low) / spread * 76;
    return `${x.toFixed(2)}% ${Math.max(8, Math.min(92, y)).toFixed(2)}%`;
  });
  const area = `polygon(${coordinates.join(",")}, 100% 100%, 0 100%)`;
  const first = new Date(chartPoints[0].updatedAt * 1_000);
  const last = new Date(chartPoints.at(-1)!.updatedAt * 1_000);
  return <div className="history-chart" aria-label={`Onchain price history from ${first.toLocaleDateString()} to ${last.toLocaleDateString()}`}>
    <div className="history-grid" />
    <div className="history-area" style={{ clipPath: area }} />
    {chartPoints.filter((_, index) => index % Math.max(1, Math.floor(chartPoints.length / 8)) === 0 || index === chartPoints.length - 1).map((point, index, visible) => {
      const sourceIndex = chartPoints.indexOf(point);
      const x = sourceIndex / (chartPoints.length - 1) * 100;
      const y = 88 - (point.price - low) / spread * 76;
      return <i key={point.roundId} className={index === visible.length - 1 ? "latest" : ""} style={{ left: `${x}%`, top: `${Math.max(8, Math.min(92, y))}%` }} />;
    })}
    <div className="history-axis"><span>{first.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span><span>{last.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></div>
  </div>;
}

async function readPriceHistoryApi(ticker: string, signal: AbortSignal) {
  const response = await fetch(`/api/history?ticker=${encodeURIComponent(ticker)}`, {
    headers: { accept: "application/json" },
    cache: "default",
    signal,
  });
  const payload = await response.json() as { points?: HistoryPoint[]; error?: string };
  if (!response.ok || !Array.isArray(payload.points) || payload.points.length < 2) {
    throw new Error(payload.error || "History request failed");
  }
  return payload.points;
}

function Hint({ label, children }: { label: string; children: React.ReactNode }) {
  return <span className="term-hint" tabIndex={0}><span>{label}</span><b aria-hidden="true">?</b><span className="term-tooltip" role="tooltip">{children}</span></span>;
}

function isStoredStrategy(value: unknown): value is Strategy {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Strategy>;
  return typeof item.id === "number"
    && typeof item.name === "string"
    && ["Buy", "Sell", "DCA"].includes(item.kind ?? "")
    && typeof item.asset === "string"
    && typeof item.rule === "string"
    && typeof item.detail === "string"
    && ["Prepared", "Paused", "Confirmed", "Cancelled"].includes(item.status ?? "")
    && typeof item.budget === "string"
    && typeof item.expires === "string"
    && typeof item.createdAt === "number"
    && typeof item.walletAddress === "string"
    && /^0x[a-fA-F0-9]{40}$/.test(item.walletAddress);
}

function orderStorageKey(walletAddress: string) {
  return `${ORDER_STORAGE_PREFIX}:${walletAddress.toLowerCase()}`;
}

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [walletAddress, setWalletAddress] = useState("");
  const [walletBalance, setWalletBalance] = useState("");
  const [walletUsdgBalance, setWalletUsdgBalance] = useState("");
  const [walletProvider, setWalletProvider] = useState<HoodFlowWalletProvider | null>(null);
  const [walletKind, setWalletKind] = useState<WalletConnectionKind | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const privyControllerRef = useRef<PrivyWalletController | null>(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [privyRuntimeEnabled, setPrivyRuntimeEnabled] = useState(false);
  const [privyRuntimeReady, setPrivyRuntimeReady] = useState(false);
  const [walletConnecting, setWalletConnecting] = useState(false);
  const [walletConnectReady, setWalletConnectReady] = useState<boolean | null>(null);
  const [networkBlock, setNetworkBlock] = useState("Checking");
  const [contractStatus, setContractStatus] = useState(contractConfigured ? "Checking DCA engine" : "Engine address missing");
  const [contractReady, setContractReady] = useState(false);
  const [engineChecking, setEngineChecking] = useState(contractConfigured);
  const [enginePaused, setEnginePaused] = useState(false);
  const [engineOwner, setEngineOwner] = useState("");
  const [engineOwnerType, setEngineOwnerType] = useState<"EOA" | "Contract" | "Unknown">("Unknown");
  const [engineFeeBps, setEngineFeeBps] = useState<number | null>(null);
  const [rpcHealth, setRpcHealth] = useState<{ endpoint: string; configuredEndpoints: number; latencyMs: number } | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [kind, setKind] = useState<StrategyKind>("DCA");
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const hydratedWalletRef = useRef("");
  const priceHistoryCacheRef = useRef<Record<string, { points: HistoryPoint[]; error: string }>>({});
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
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [infoPanel, setInfoPanel] = useState<InfoPanel | null>(null);
  const [priceBook, setPriceBook] = useState<Record<string, PricePoint>>({});
  const [priceState, setPriceState] = useState<PriceState>("loading");
  const [priceUpdatedAt, setPriceUpdatedAt] = useState<number | null>(null);
  const [priceRefreshing, setPriceRefreshing] = useState(false);
  const [priceError, setPriceError] = useState("");
  const [selectedAssetTicker, setSelectedAssetTicker] = useState("AAPL");
  const [priceHistory, setPriceHistory] = useState<HistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [portfolioBalances, setPortfolioBalances] = useState<Record<string, number>>({});
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [composerQuote, setComposerQuote] = useState<DirectQuotePreview | null>(null);
  const [composerQuoteBusy, setComposerQuoteBusy] = useState(false);
  const [composerQuoteError, setComposerQuoteError] = useState("");
  const composerQuoteRequestRef = useRef(0);
  const composerQuoteKeyRef = useRef("");
  const walletBalanceRequestRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast("");
      toastTimerRef.current = null;
    }, 3200);
  }, []);

  const openWalletModal = useCallback(() => {
    if (PRIVY_CONFIGURED) setPrivyRuntimeEnabled(true);
    setWalletModalOpen(true);
  }, []);

  const clearWalletScopedState = useCallback(() => {
    hydratedWalletRef.current = "";
    walletBalanceRequestRef.current += 1;
    composerQuoteRequestRef.current += 1;
    composerQuoteKeyRef.current = "";
    setStrategies([]);
    setWalletBalance("");
    setWalletUsdgBalance("");
    setPortfolioBalances({});
    setPortfolioLoading(false);
    setSelectedStrategy(null);
    setComposerQuote(null);
    setComposerQuoteBusy(false);
    setComposerQuoteError("");
    setTransactionStep("");
  }, []);

  const clearWalletConnection = useCallback(() => {
    clearWalletScopedState();
    setWalletProvider(null);
    setWalletKind(null);
    setWalletChainId(null);
    setWalletAddress("");
    setWalletModalOpen(false);
  }, [clearWalletScopedState]);

  const handlePrivyController = useCallback((controller: PrivyWalletController | null) => {
    privyControllerRef.current = controller;
    setPrivyRuntimeReady(Boolean(controller));
  }, []);

  const connected = Boolean(walletAddress);
  useEffect(() => () => {
    composerQuoteRequestRef.current += 1;
    walletBalanceRequestRef.current += 1;
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  const draftTotalBudget = useMemo(() => {
    const amount = Number(draftAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    if (kind === "DCA") return amount * Math.max(1, Number.parseInt(draftExecutions, 10) || 0);
    return amount;
  }, [draftAmount, draftExecutions, kind]);
  const refreshPrices = useCallback(async (signal?: AbortSignal) => {
    setPriceRefreshing(true);
    const requestController = new AbortController();
    const abortRequest = () => requestController.abort();
    signal?.addEventListener("abort", abortRequest, { once: true });
    const requestTimeout = window.setTimeout(() => requestController.abort(), 6_500);
    try {
      let data: PriceResponse | null = null;
      try {
        const response = await fetch("/api/prices", {
          headers: { accept: "application/json" },
          cache: "no-store",
          signal: requestController.signal,
        });
        if (response.ok) {
          const candidate = await response.json() as PriceResponse;
          // Edge RPC requests can be regionally throttled. An incomplete server
          // response is never treated as verified; the browser retries the same
          // read directly against Robinhood Chain before showing an error.
          if (candidate.prices && typeof candidate.prices === "object" && candidate.liveCount > 0) data = candidate;
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
          signal: requestController.signal,
        });
        if (!rpcResponse.ok) throw new Error(`Price RPC returned ${rpcResponse.status}`);
        data = parseRobinhoodPriceResults(await rpcResponse.json());
      }
      setPriceBook(data.prices);
      setPriceUpdatedAt(Date.parse(data.fetchedAt));
      setPriceState(data.liveCount >= executionReadyAssetCount ? "live" : data.liveCount > 0 ? "degraded" : "error");
      setPriceError(data.liveCount > 0 ? "" : "Live feed is delayed. HoodFlow is retrying automatically; trading remains locked until a verified price arrives.");
      if (data.liveCount > 0) {
        try { window.sessionStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(data)); } catch { /* Optional fast-return cache. */ }
      }
    } catch {
      if (signal?.aborted) return;
      setPriceState((current) => current === "loading" ? "error" : "degraded");
      setPriceError("Live feed is delayed. HoodFlow is retrying automatically; no order can use an unverified price.");
    } finally {
      window.clearTimeout(requestTimeout);
      signal?.removeEventListener("abort", abortRequest);
      if (!signal?.aborted) setPriceRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const hydrate = window.setTimeout(() => {
      try {
        const cached = window.sessionStorage.getItem(PRICE_CACHE_KEY);
        if (!cached) return;
        const data = JSON.parse(cached) as PriceResponse;
        const fetchedAt = Date.parse(data.fetchedAt);
        if (!data.prices || !Number.isFinite(fetchedAt) || Date.now() - fetchedAt > 5 * 60_000) return;
        setPriceBook(Object.fromEntries(Object.entries(data.prices).map(([ticker, point]) => [ticker, {
          ...point,
          status: point.status === "live" ? "stale" : point.status,
        }])));
        setPriceUpdatedAt(fetchedAt);
        setPriceState("degraded");
        setPriceError("Showing the last verified snapshot while a fresh onchain check completes.");
      } catch {
        // A damaged optional cache is ignored and replaced by the next live response.
      }
    }, 0);
    return () => window.clearTimeout(hydrate);
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
  const visibleActivityRows = useMemo(() => activityRows.filter((item) => activityFilter === "all"
    || (activityFilter === "dca" ? item.kind === "DCA" : item.kind === "Buy" || item.kind === "Sell")), [activityFilter, activityRows]);
  const dcaRows = useMemo(() => strategies.filter((item) => item.kind === "DCA"), [strategies]);
  const activeDcaCount = useMemo(() => dcaRows.filter((item) => item.status === "Prepared").length, [dcaRows]);
  const scheduledDcaBudget = useMemo(() => dcaRows.reduce((sum, item) => sum + (Number.parseFloat(item.budget) || 0), 0), [dcaRows]);
  const trackedTradeVolume = useMemo(() => activityRows.reduce((sum, item) => {
    if (item.kind === "Buy") return sum + (item.inputAmount ?? 0);
    if (item.kind === "Sell") return sum + (item.outputAmount ?? 0);
    return sum;
  }, 0), [activityRows]);
  const portfolioRows = useMemo(() => {
    const ledger = new Map<string, { quantity: number; cost: number; realized: number }>();
    [...strategies].sort((left, right) => left.createdAt - right.createdAt).forEach((item) => {
      if (item.status !== "Confirmed" || !item.inputAmount || !item.outputAmount || !assetByTicker[item.asset]) return;
      const current = ledger.get(item.asset) ?? { quantity: 0, cost: 0, realized: 0 };
      if (item.kind === "Buy") {
        current.quantity += item.outputAmount;
        current.cost += item.inputAmount;
      } else if (item.kind === "Sell" && current.quantity > 0) {
        const sold = Math.min(current.quantity, item.inputAmount);
        const removedCost = current.cost * sold / current.quantity;
        current.quantity -= sold;
        current.cost = Math.max(0, current.cost - removedCost);
        current.realized += item.outputAmount - removedCost;
      }
      ledger.set(item.asset, current);
    });
    return assetRegistry.flatMap((asset) => {
      const balance = portfolioBalances[asset.ticker] ?? 0;
      if (balance <= 0.00000001) return [];
      const price = priceBook[asset.ticker]?.price ?? null;
      const tracked = ledger.get(asset.ticker);
      const trackedQuantity = tracked ? Math.min(balance, tracked.quantity) : 0;
      const trackedCost = tracked && tracked.quantity > 0 ? tracked.cost * trackedQuantity / tracked.quantity : 0;
      const currentValue = price ? balance * price : null;
      const trackedValue = price ? trackedQuantity * price : null;
      return [{
        ...asset,
        balance,
        price,
        currentValue,
        trackedQuantity,
        averageEntry: trackedQuantity > 0 ? trackedCost / trackedQuantity : null,
        unrealizedPnl: trackedValue !== null && trackedQuantity > 0 ? trackedValue - trackedCost : null,
        realizedPnl: tracked?.realized ?? 0,
        importedQuantity: Math.max(0, balance - trackedQuantity),
      }];
    });
  }, [portfolioBalances, priceBook, strategies]);
  const portfolioTotals = useMemo(() => portfolioRows.reduce((total, row) => ({
    value: total.value + (row.currentValue ?? 0),
    unrealized: total.unrealized + (row.unrealizedPnl ?? 0),
    realized: total.realized + row.realizedPnl,
  }), { value: 0, unrealized: 0, realized: 0 }), [portfolioRows]);
  useEffect(() => {
    const activeWallet = walletAddress.toLowerCase();
    hydratedWalletRef.current = "";
    const hydrate = window.setTimeout(() => {
      if (!activeWallet) {
        setStrategies([]);
        return;
      }
      try {
        const saved = window.localStorage.getItem(orderStorageKey(activeWallet));
        if (saved) {
          const parsed = JSON.parse(saved) as unknown;
          if (Array.isArray(parsed)) {
            const valid = parsed
              .filter(isStoredStrategy)
              .filter((item) => item.walletAddress.toLowerCase() === activeWallet)
              .slice(0, 50);
            setStrategies(valid);
          } else {
            setStrategies([]);
          }
        } else {
          setStrategies([]);
        }
      } catch {
        setStrategies([]);
        // Private browsing or a corrupted wallet index must never block the workspace.
      } finally {
        hydratedWalletRef.current = activeWallet;
      }
    }, 0);
    return () => window.clearTimeout(hydrate);
  }, [walletAddress]);

  useEffect(() => {
    const activeWallet = walletAddress.toLowerCase();
    if (!activeWallet || hydratedWalletRef.current !== activeWallet) return;
    try {
      const walletStrategies = strategies
        .filter((item) => item.walletAddress.toLowerCase() === activeWallet)
        .slice(0, 50);
      window.localStorage.setItem(orderStorageKey(activeWallet), JSON.stringify(walletStrategies));
    } catch {
      // Device storage is optional; the in-memory workspace remains usable.
    }
  }, [strategies, walletAddress]);

  useEffect(() => {
    const syncAssetFromUrl = () => {
      const currentUrl = new URL(window.location.href);
      const params = currentUrl.searchParams;
      const ticker = params.get("asset")?.toUpperCase();
      const requestedView = params.get("view") as View | null;
      if (ticker && assetByTicker[ticker]) {
        setSelectedAssetTicker(ticker);
        setView("asset");
        const agentSide = params.get("agentSide");
        const agentAmount = params.get("agentAmount") ?? "";
        const agentSlippageBps = Number(params.get("agentSlippageBps"));
        const amountNumber = Number(agentAmount);
        const amountDecimals = agentAmount.split(".")[1]?.length ?? 0;
        const amountLimit = agentSide === "buy" ? 100_000 : 1_000_000;
        const decimalLimit = agentSide === "buy" ? USDG_DECIMALS : STOCK_TOKEN_DECIMALS;
        const validAgentIntent = isRoutedAsset(ticker)
          && (agentSide === "buy" || agentSide === "sell")
          && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(agentAmount)
          && Number.isFinite(amountNumber)
          && amountNumber > 0
          && amountNumber <= amountLimit
          && amountDecimals <= decimalLimit
          && Number.isInteger(agentSlippageBps)
          && agentSlippageBps >= 1
          && agentSlippageBps <= 500;
        if (validAgentIntent) {
          const nextKind = agentSide === "buy" ? "Buy" : "Sell";
          setKind(nextKind);
          setDraftName(`${ticker} instant ${agentSide}`);
          setDraftAsset(ticker);
          setDraftAmount(agentAmount);
          setDraftSlippage(String(agentSlippageBps / 100));
          setTransactionStep("");
          composerQuoteRequestRef.current += 1;
          composerQuoteKeyRef.current = "";
          setComposerQuote(null);
          setComposerQuoteError("");
          setComposerOpen(true);
        }
      } else if (/^\/crypto\/0x[a-fA-F0-9]{40}\/?$/.test(currentUrl.pathname)) {
        setView("community");
      } else if (params.get("ref")) {
        setView("rewards");
      } else if (requestedView && ["overview", "strategies", "assets", "community", "agents", "portfolio", "rewards", "marketplace", "activity", "controls"].includes(requestedView)) {
        setView(requestedView);
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
    const cached = priceHistoryCacheRef.current[selectedAssetTicker];
    const start = window.setTimeout(async () => {
      if (cached) {
        setPriceHistory(cached.points);
        setHistoryError(cached.error);
        setHistoryLoading(false);
      } else {
        setPriceHistory([]);
        setHistoryError("");
        setHistoryLoading(true);
      }
      try {
        const points = await readPriceHistoryApi(selectedAssetTicker, controller.signal);
        const error = "";
        priceHistoryCacheRef.current[selectedAssetTicker] = { points, error };
        setPriceHistory(points);
        setHistoryError(error);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!cached) {
          setPriceHistory([]);
          setHistoryError("Historical rounds are reconnecting. The current oracle price remains verified.");
        }
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
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
      setPriceError("The live feed is taking longer than expected. Automatic retries are active and trading stays locked until verification completes.");
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
        const startedAt = Date.now();
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
            const [owner, paused, settlementToken, swapAdapter, keeperCount, allowedTokenCount, maxTranche, maxBudget, protocolFeeBps, inputConfig] = await Promise.all([
              engine.owner() as Promise<string>,
              engine.paused() as Promise<boolean>,
              engine.settlementToken() as Promise<string>,
              engine.swapAdapter() as Promise<string>,
              engine.keeperCount() as Promise<bigint>,
              engine.allowedTokenCount() as Promise<bigint>,
              engine.maxTrancheAmount() as Promise<bigint>,
              engine.maxStrategyBudget() as Promise<bigint>,
              engine.protocolFeeBps() as Promise<bigint>,
              engine.tokenConfigs(USDG_ADDRESS),
            ]);
            setEngineOwner(owner);
            setEnginePaused(paused);
            setEngineFeeBps(Number(protocolFeeBps));
            const ownerCode = await provider.getCode(owner);
            setEngineOwnerType(ownerCode === "0x" ? "EOA" : "Contract");
            setRpcHealth({ endpoint: "Browser fallback", configuredEndpoints: 1, latencyMs: Date.now() - startedAt });
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
        if (contractConfigured) setContractStatus("Verification temporarily unavailable · retrying automatically");
      }
    }
    void readNetwork();
  }, []);

  const refreshEngineStatus = useCallback(async () => {
    if (!contractConfigured) return;
    setEngineChecking(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch("/api/engine-status", { cache: "no-store", signal: controller.signal });
      const status = await response.json() as {
        blockNumber?: number;
        owner?: string;
        paused?: boolean;
        configured?: boolean;
        protocolFeeBps?: number;
        ownerType?: "EOA" | "Contract";
        rpc?: { endpoint: string; configuredEndpoints: number; latencyMs: number };
        error?: string;
      };
      if (!response.ok || typeof status.blockNumber !== "number" || !status.owner) {
        throw new Error(status.error || "Engine verification is temporarily unavailable.");
      }
      setNetworkBlock(status.blockNumber.toLocaleString("en-US"));
      setEngineOwner(status.owner);
      setEnginePaused(Boolean(status.paused));
      setEngineOwnerType(status.ownerType ?? "Unknown");
      setEngineFeeBps(typeof status.protocolFeeBps === "number" ? status.protocolFeeBps : null);
      setRpcHealth(status.rpc ?? null);
      setContractReady(!status.paused && Boolean(status.configured));
      setContractStatus(status.paused
        ? "Engine deployed · owner activation required"
        : status.configured ? "Engine live · verified onchain" : "Engine configuration needs review");
    } catch {
      setContractStatus((current) => current.startsWith("Engine live") || current.startsWith("Engine deployed")
        ? current
        : "Verification temporarily unavailable · retrying automatically");
    } finally {
      window.clearTimeout(timeout);
      setEngineChecking(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshEngineStatus(), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshEngineStatus();
    }, 30_000);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void refreshEngineStatus();
    };
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refreshEngineStatus]);

  const refreshComposerQuote = useCallback(async () => {
    const requestId = ++composerQuoteRequestRef.current;
    const requestKey = `${kind}:${draftAsset}:${draftAmount}:${draftSlippage}`;
    if (!composerOpen || (kind !== "Buy" && kind !== "Sell") || !isRoutedAsset(draftAsset)) {
      composerQuoteKeyRef.current = "";
      setComposerQuote(null);
      setComposerQuoteBusy(false);
      setComposerQuoteError("");
      return;
    }
    if (priceBook[draftAsset]?.status !== "live") {
      composerQuoteKeyRef.current = "";
      setComposerQuote(null);
      setComposerQuoteBusy(false);
      setComposerQuoteError(`${draftAsset} oracle is not live. HoodFlow will retry automatically.`);
      return;
    }
    if (connected && walletChainId !== ROBINHOOD_MAINNET.chainIdNumber) {
      composerQuoteKeyRef.current = "";
      setComposerQuote(null);
      setComposerQuoteBusy(false);
      setComposerQuoteError("Switch the connected wallet back to Robinhood Chain mainnet.");
      return;
    }
    let amountIn: bigint;
    try {
      amountIn = parseUnits(draftAmount || "0", kind === "Buy" ? USDG_DECIMALS : STOCK_TOKEN_DECIMALS);
      if (amountIn <= 0n) throw new Error("Enter an amount to request a quote.");
    } catch {
      composerQuoteKeyRef.current = "";
      setComposerQuote(null);
      setComposerQuoteBusy(false);
      setComposerQuoteError("Enter a valid amount.");
      return;
    }
    if (composerQuoteKeyRef.current !== requestKey) {
      composerQuoteKeyRef.current = "";
      setComposerQuote(null);
    }
    setComposerQuoteBusy(true);
    try {
      const provider = new JsonRpcProvider(ROBINHOOD_MAINNET.rpcUrls[0], ROBINHOOD_MAINNET.chainIdNumber, { staticNetwork: true });
      const tokenAddress = ROBINHOOD_TOKENS[draftAsset];
      const tokenIn = kind === "Buy" ? USDG_ADDRESS : tokenAddress;
      const tokenOut = kind === "Buy" ? tokenAddress : USDG_ADDRESS;
      const route = isV3RoutedAsset(draftAsset)
        ? await (async () => {
            const fee = V3_ROUTE_FEES[draftAsset];
            const quoter = new Contract(V3_QUOTER_ADDRESS, V3_QUOTER_ABI, provider);
            const result = await quoter.quoteExactInputSingle.staticCall({ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0 }) as readonly [bigint, bigint, bigint, bigint];
            return { protocol: "V3" as const, amountOut: BigInt(result[0]), feeBps: fee / 100 };
          })()
        : await getBestV4Quote(provider, tokenIn, tokenOut, amountIn).then((result) => ({ protocol: "V4" as const, amountOut: result.amountOut, feeBps: result.route.fee / 100 }));
      if (route.amountOut <= 0n) throw new Error("No live route is available for this amount.");
      const slippageBps = Math.max(10, Math.min(500, Math.round(Number(draftSlippage || 0.5) * 100)));
      const minimum = route.amountOut * BigInt(10_000 - slippageBps) / 10_000n;
      const decimals = kind === "Buy" ? STOCK_TOKEN_DECIMALS : USDG_DECIMALS;
      if (requestId !== composerQuoteRequestRef.current) return;
      composerQuoteKeyRef.current = requestKey;
      setComposerQuote({
        protocol: route.protocol,
        feeBps: route.feeBps,
        amountOut: formatUnits(route.amountOut, decimals),
        minimumOut: formatUnits(minimum, decimals),
        updatedAt: Date.now(),
      });
      setComposerQuoteError("");
    } catch (error) {
      if (requestId !== composerQuoteRequestRef.current) return;
      setComposerQuote((current) => composerQuoteKeyRef.current === requestKey ? current : null);
      setComposerQuoteError(errorMessage(error));
    } finally {
      if (requestId === composerQuoteRequestRef.current) setComposerQuoteBusy(false);
    }
  }, [composerOpen, connected, draftAmount, draftAsset, draftSlippage, kind, priceBook, walletChainId]);

  useEffect(() => {
    if (!composerOpen || (kind !== "Buy" && kind !== "Sell")) return;
    const start = window.setTimeout(() => void refreshComposerQuote(), 250);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshComposerQuote();
    }, 12_000);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(interval);
      composerQuoteRequestRef.current += 1;
    };
  }, [composerOpen, kind, refreshComposerQuote]);

  function qualifyReferral(txHash: string, wallet = walletAddress) {
    if (!wallet || !txHash) return;
    const submit = async (attempt: number) => {
      try {
        const response = await fetch("/api/referrals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "qualify", wallet, txHash }),
        });
        if (!response.ok) throw new Error("Qualification check unavailable");
        const payload = await response.json() as { qualified?: boolean };
        if (payload.qualified) track("referral_qualified");
      } catch {
        if (attempt < 2) window.setTimeout(() => void submit(attempt + 1), (attempt + 1) * 7_500);
      }
    };
    void submit(0);
  }

  async function activateDcaEngine() {
    if (!walletProvider || !connected) {
      openWalletModal();
      throw new Error("Connect the engine owner wallet to activate recurring DCA.");
    }
    if (!engineOwner || walletAddress.toLowerCase() !== engineOwner.toLowerCase()) {
      throw new Error(`Engine activation requires the owner wallet ${compactAddress(engineOwner || "0x0000000000000000000000000000000000000000")}.`);
    }
    const provider = new BrowserProvider(walletProvider, "any");
    const network = await provider.getNetwork();
    if (network.chainId !== BigInt(ROBINHOOD_MAINNET.chainIdNumber)) await switchToRobinhoodChain(walletProvider);
    const engine = new Contract(CONTRACT_ADDRESS, HOODFLOW_ENGINE_ABI, await getVerifiedSigner(provider, walletAddress));
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

  const refreshWalletBalances = useCallback(async (address: string, provider: BrowserProvider) => {
    const requestId = ++walletBalanceRequestRef.current;
    setPortfolioLoading(true);
    const usdG = new Contract(USDG_ADDRESS, ERC20_ABI, provider);
    try {
      const loadTokenBalances = async () => {
        const entries: Array<readonly [string, number]> = [];
        for (let index = 0; index < assetRegistry.length; index += 5) {
          const batch = await Promise.allSettled(assetRegistry.slice(index, index + 5).map(async (asset) => {
            const token = new Contract(ROBINHOOD_TOKENS[asset.ticker], ERC20_ABI, provider);
            const balance = await token.balanceOf(address) as bigint;
            return [asset.ticker, Number(formatUnits(balance, STOCK_TOKEN_DECIMALS))] as const;
          }));
          entries.push(...batch.flatMap((result) => result.status === "fulfilled" ? [result.value] : []));
        }
        return entries;
      };
      const [nativeBalance, usdGBalance, tokenBalances] = await Promise.all([
        provider.getBalance(address),
        usdG.balanceOf(address) as Promise<bigint>,
        loadTokenBalances(),
      ]);
      if (requestId !== walletBalanceRequestRef.current) return;
      setWalletBalance(Number(formatEther(nativeBalance)).toFixed(4));
      setWalletUsdgBalance(Number(formatUnits(usdGBalance, USDG_DECIMALS)).toFixed(2));
      setPortfolioBalances(Object.fromEntries(tokenBalances));
    } finally {
      if (requestId === walletBalanceRequestRef.current) setPortfolioLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!walletProvider) return;

    const handleAccountsChanged: WalletProviderEventHandler = (...args) => {
      const value = args[0];
      const accounts = Array.isArray(value) ? value.filter((account): account is string => typeof account === "string") : [];
      const nextAddress = accounts[0];
      if (!nextAddress) {
        clearWalletConnection();
        notify("The wallet session ended. Connect again to continue.");
        return;
      }
      if (nextAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        clearWalletScopedState();
        setWalletAddress(nextAddress);
        notify(`Active account changed to ${compactAddress(nextAddress)}`);
      }
      const provider = new BrowserProvider(walletProvider, "any");
      void refreshWalletBalances(nextAddress, provider).catch(() => {
        if (nextAddress.toLowerCase() === walletAddress.toLowerCase()) notify("Wallet balances are temporarily unavailable.");
      });
    };

    const handleChainChanged: WalletProviderEventHandler = (...args) => {
      const value = args[0];
      const chainId = typeof value === "string"
        ? Number.parseInt(value, value.startsWith("0x") ? 16 : 10)
        : typeof value === "number" ? value : Number.NaN;
      setWalletChainId(Number.isFinite(chainId) ? chainId : null);
      composerQuoteRequestRef.current += 1;
      composerQuoteKeyRef.current = "";
      setComposerQuote(null);
      setComposerQuoteBusy(false);
      setComposerQuoteError("");
      if (chainId !== ROBINHOOD_MAINNET.chainIdNumber) {
        walletBalanceRequestRef.current += 1;
        setWalletBalance("");
        setWalletUsdgBalance("");
        setPortfolioBalances({});
        setPortfolioLoading(false);
        notify("Wallet network changed. Switch back to Robinhood Chain mainnet to trade.");
        return;
      }
      void walletProvider.request({ method: "eth_accounts" })
        .then((accounts) => handleAccountsChanged(accounts))
        .catch(() => notify("Robinhood Chain is selected, but the wallet account could not be refreshed."));
    };

    const handleDisconnect: WalletProviderEventHandler = () => {
      clearWalletConnection();
      notify("The wallet disconnected from HoodFlow.");
    };

    walletProvider.on?.("accountsChanged", handleAccountsChanged);
    walletProvider.on?.("chainChanged", handleChainChanged);
    walletProvider.on?.("disconnect", handleDisconnect);
    return () => {
      walletProvider.removeListener?.("accountsChanged", handleAccountsChanged);
      walletProvider.removeListener?.("chainChanged", handleChainChanged);
      walletProvider.removeListener?.("disconnect", handleDisconnect);
    };
  }, [clearWalletConnection, clearWalletScopedState, notify, refreshWalletBalances, walletAddress, walletProvider]);

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
    clearWalletScopedState();
    setWalletProvider(provider);
    setWalletKind(kind);
    setWalletChainId(Number(network.chainId));
    setWalletAddress(address);
    await refreshWalletBalances(address, browserProvider);
    setWalletModalOpen(false);
    track("wallet_connected", { kind });
    notify(kind === "privy" ? "Privy wallet ready on Robinhood Chain" : kind === "walletconnect" ? "WalletConnect session ready on Robinhood Chain" : "Browser wallet connected to Robinhood Chain");
  }

  function selectInjectedWallet(preference: InjectedWalletPreference) {
    if (preference === "okx" && window.okxwallet) return window.okxwallet;
    const root = window.ethereum as InjectedWalletProvider | undefined;
    if (!root) return null;
    const providers = root.providers?.length ? root.providers : [root];
    if (preference === "rabby") return providers.find((provider) => provider.isRabby) ?? null;
    if (preference === "metamask") return providers.find((provider) => provider.isMetaMask && !provider.isOkxWallet && !provider.isOKExWallet) ?? null;
    if (preference === "okx") return providers.find((provider) => provider.isOkxWallet || provider.isOKExWallet) ?? null;
    return root;
  }

  async function connectBrowserWallet(preference: InjectedWalletPreference = "browser") {
    const provider = selectInjectedWallet(preference);
    if (!provider) {
      const walletName = preference === "rabby" ? "Rabby Wallet" : preference === "metamask" ? "MetaMask" : preference === "okx" ? "OKX Wallet" : "browser wallet";
      notify(`${walletName} was not found. Install it or use WalletConnect.`);
      return;
    }
    if (!window.ethereum && !window.okxwallet) {
      notify("No browser wallet found. Use WalletConnect or install Robinhood Wallet / MetaMask.");
      return;
    }
    setWalletConnecting(true);
    try {
      await activateWallet(provider, "browser");
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
      if (walletKind === "privy") await privyControllerRef.current?.logout();
    } catch {
      // The local session is still cleared if the remote wallet already disconnected.
    } finally {
      clearWalletConnection();
      notify("Wallet disconnected from HoodFlow");
    }
  }

  function handleWalletButton() {
    if (connected) void disconnectWallet();
    else {
      track("wallet_connect_started");
      if (PRIVY_CONFIGURED && privyControllerRef.current) {
        privyControllerRef.current.open();
        return;
      }
      openWalletModal();
    }
  }

  function openPrivy() {
    if (!privyControllerRef.current) {
      notify("Privy is still loading. Try again in a moment.");
      return;
    }
    setWalletModalOpen(false);
    privyControllerRef.current.open();
  }

  async function activatePrivyWallet(provider: unknown) {
    setWalletConnecting(true);
    try {
      await activateWallet(provider as HoodFlowWalletProvider, "privy");
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setWalletConnecting(false);
    }
  }

  function openAsset(ticker: string) {
    if (!assetByTicker[ticker]) return;
    track("asset_opened", { ticker });
    const cached = priceHistoryCacheRef.current[ticker];
    setPriceHistory(cached?.points ?? []);
    setHistoryError(cached?.error ?? "");
    setHistoryLoading(!cached);
    setSelectedAssetTicker(ticker);
    setView("asset");
    const url = new URL("/", window.location.origin);
    url.searchParams.set("asset", ticker);
    window.history.pushState({}, "", `${url.pathname}${url.search}`);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function navigate(nextView: View) {
    setView(nextView);
    if (nextView !== "asset") {
      const url = new URL("/", window.location.origin);
      url.searchParams.delete("asset");
      if (nextView === "overview") url.searchParams.delete("view");
      else url.searchParams.set("view", nextView);
      window.history.pushState({}, "", `${url.pathname}${url.search}`);
    }
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
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
    composerQuoteRequestRef.current += 1;
    composerQuoteKeyRef.current = "";
    setComposerQuote(null);
    setComposerQuoteError("");
    setComposerOpen(true);
  }

  function openAgentMarket(ticker: string, intent?: { side: "buy" | "sell"; amount: string; slippageBps: number }) {
    openAsset(ticker);
    if (!intent) return;
    openComposer(intent.side === "buy" ? "Buy" : "Sell", ticker);
    setDraftAmount(intent.amount);
    setDraftSlippage(String(intent.slippageBps / 100));
    const url = new URL(window.location.href);
    url.searchParams.set("asset", ticker);
    url.searchParams.set("agentSide", intent.side);
    url.searchParams.set("agentAmount", intent.amount);
    url.searchParams.set("agentSlippageBps", String(intent.slippageBps));
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  async function toggleStrategy(id: number) {
    const strategy = strategies.find((item) => item.id === id);
    if (!strategy || strategy.status === "Confirmed" || strategy.status === "Cancelled") return;
    if (strategy.chainStrategyId) {
      if (!walletProvider || !connected || !contractConfigured) {
        notify("Connect the strategy owner wallet to change this onchain strategy.");
        return;
      }
      try {
        const provider = new BrowserProvider(walletProvider, "any");
        const network = await provider.getNetwork();
        if (network.chainId !== BigInt(ROBINHOOD_MAINNET.chainIdNumber)) throw new Error("Switch your wallet to Robinhood Chain mainnet.");
        const engine = new Contract(CONTRACT_ADDRESS, HOODFLOW_ENGINE_ABI, await getVerifiedSigner(provider, walletAddress));
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

  async function cancelOnchainStrategy(id: number) {
    const strategy = strategies.find((item) => item.id === id);
    if (!strategy || strategy.kind !== "DCA" || !strategy.chainStrategyId || strategy.status === "Cancelled") return;
    if (!walletProvider || !connected || !contractConfigured) {
      openWalletModal();
      notify("Connect the strategy owner wallet to cancel this DCA.");
      return;
    }
    setOnchainBusy(true);
    try {
      const provider = new BrowserProvider(walletProvider, "any");
      const network = await provider.getNetwork();
      if (network.chainId !== BigInt(ROBINHOOD_MAINNET.chainIdNumber)) throw new Error("Switch your wallet to Robinhood Chain mainnet.");
      const signer = await getVerifiedSigner(provider, walletAddress);
      const engine = new Contract(CONTRACT_ADDRESS, HOODFLOW_ENGINE_ABI, signer);
      notify("Confirm DCA cancellation in your wallet");
      const transaction = await engine.cancelStrategy(strategy.chainStrategyId);
      const receipt = await transaction.wait();
      if (!receipt || receipt.status !== 1) throw new Error("Strategy cancellation was not confirmed.");
      setStrategies((current) => current.map((item) => item.id === id
        ? { ...item, status: "Cancelled", detail: "Strategy cancelled onchain" }
        : item));
      setSelectedStrategy(null);
      notify("Onchain DCA cancelled");
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setOnchainBusy(false);
    }
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

    const signer = await getVerifiedSigner(provider, address);
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

    track("quote_requested", { ticker: draftAsset, side: "buy", amount: draftAmount });
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
    track("quote_received", { ticker: draftAsset, side: "buy", protocol: quote.protocol });

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

    const router = new Contract(UNIVERSAL_ROUTER_ADDRESS, UNIVERSAL_ROUTER_ABI, signer);
    setTransactionStep("Simulating the protected buy…");
    await router.execute.staticCall(calldata.commands, calldata.inputs, now + 300);
    track("transaction_started", { ticker: draftAsset, side: "buy" });
    setTransactionStep(`Confirm the ${draftAsset} buy in your wallet…`);
    const transaction = await router.execute(calldata.commands, calldata.inputs, now + 300);
    setTransactionStep("Waiting for mainnet confirmation…");
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1) throw new Error("The buy was not confirmed.");
    const outputAfter = BigInt(await outputToken.balanceOf(address));
    const received = outputAfter - outputBefore;
    if (received <= 0n) throw new Error("Transaction confirmed but no output token was received.");
    track("transaction_confirmed", { ticker: draftAsset, side: "buy" });
    qualifyReferral(receipt.hash, address);

    setStrategies((current) => [{
      id: Date.now(), name: draftName, kind: "Buy", asset: draftAsset,
      rule: `Buy once with ${draftAmount} USDG`, detail: `${Number(formatUnits(received, STOCK_TOKEN_DECIMALS)).toFixed(6)} ${draftAsset} received`, status: "Confirmed",
      budget: `${Number(draftAmount).toFixed(2)} USDG`, expires: "Completed", createdAt: Date.now(), txHash: receipt.hash,
      walletAddress: address.toLowerCase(),
      inputAmount: Number(draftAmount), outputAmount: Number(formatUnits(received, STOCK_TOKEN_DECIMALS)),
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

    const signer = await getVerifiedSigner(provider, address);
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

    track("quote_requested", { ticker: draftAsset, side: "sell", amount: draftAmount });
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
    track("quote_received", { ticker: draftAsset, side: "sell", protocol: quote.protocol });

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

    const router = new Contract(UNIVERSAL_ROUTER_ADDRESS, UNIVERSAL_ROUTER_ABI, signer);
    setTransactionStep("Simulating the protected sell…");
    await router.execute.staticCall(calldata.commands, calldata.inputs, now + 300);
    track("transaction_started", { ticker: draftAsset, side: "sell" });
    setTransactionStep(`Confirm the ${draftAsset} sell in your wallet…`);
    const transaction = await router.execute(calldata.commands, calldata.inputs, now + 300);
    setTransactionStep("Waiting for mainnet confirmation…");
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1) throw new Error("The sell was not confirmed.");
    const received = BigInt(await usdG.balanceOf(address)) - usdGBefore;
    if (received <= 0n) throw new Error("Transaction confirmed but no USDG was received.");
    track("transaction_confirmed", { ticker: draftAsset, side: "sell" });
    qualifyReferral(receipt.hash, address);

    setStrategies((current) => [{
      id: Date.now(), name: draftName, kind: "Sell", asset: draftAsset,
      rule: `Sell ${draftAmount} ${draftAsset}`, detail: `${Number(formatUnits(received, USDG_DECIMALS)).toFixed(2)} USDG received`, status: "Confirmed",
      budget: `${draftAmount} ${draftAsset}`, expires: "Completed", createdAt: Date.now(), txHash: receipt.hash,
      walletAddress: address.toLowerCase(),
      inputAmount: Number(draftAmount), outputAmount: Number(formatUnits(received, USDG_DECIMALS)),
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

    const signer = await getVerifiedSigner(provider, address);
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
      walletAddress: address.toLowerCase(),
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
      openWalletModal();
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
      track("transaction_failed", { ticker: draftAsset, side: kind.toLowerCase(), reason: errorMessage(error).slice(0, 80) });
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
    if (!connected || activityRows.length === 0) {
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
  const navigation: Array<{ view: View; label: string }> = [
    { view: "overview", label: "Home" },
    { view: "assets", label: "Stock Tokens" },
    { view: "community", label: "Crypto" },
    { view: "agents", label: "Agents" },
    { view: "portfolio", label: "Portfolio" },
    { view: "strategies", label: "DCA" },
    { view: "rewards", label: "Rewards" },
    { view: "activity", label: "Activity" },
    { view: "controls", label: "Security" },
  ];

  return (
    <main className="app-shell">
      <RobinHoodIntro />
      {PRIVY_CONFIGURED && privyRuntimeEnabled && <PrivyWalletRuntime onController={handlePrivyController} onWallet={activatePrivyWallet} onError={notify} />}
      <header className="topbar">
        <button className="brand" onClick={() => navigate("overview")} aria-label="HoodFlow home">
          <span className="brand-mark"><i /><i /><i /></span><span>hoodflow</span><b className="version-badge">MAINNET BETA</b>
        </button>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map((item) => <button key={item.view} className={view === item.view || (item.view === "assets" && view === "asset") ? "active" : ""} onClick={() => navigate(item.view)}>{item.label}</button>)}
          <a href="/docs">Docs</a>
        </nav>
        <div className="top-actions">
          <span className="network"><i /> Mainnet <b>#{networkBlock}</b></span>
          <button className={connected ? "wallet connected" : "wallet"} onClick={handleWalletButton}>{connected ? `${compactAddress(walletAddress)} · ${walletKind === "privy" ? "PRIVY" : walletKind === "walletconnect" ? "WC" : "WEB"}` : "Connect wallet"}</button>
        </div>
      </header>

      <div className="mobile-nav">
        {navigation.map((item) => <button key={item.view} className={view === item.view || (item.view === "assets" && view === "asset") ? "active" : ""} onClick={() => navigate(item.view)}>{item.label}</button>)}
        <a href="/docs">Docs</a>
      </div>

      {view === "overview" && (
        <section className="page overview-page hf-home">
          <div className="hf-announcement"><span><i /> ROBINHOOD CHAIN MAINNET</span><strong>{executionReadyAssetCount} reviewed Stock Token routes are execution-enabled.</strong><button onClick={() => navigate("assets")}>See markets →</button></div>
          <MarketStatus />

          <section className="hf-hero">
            <div className="hf-hero-copy">
              <p className="eyebrow">THE EXECUTION LAYER FOR STOCK TOKENS</p>
              <h1>Find the route.<br /><em>Keep the upside.</em></h1>
              <p className="hf-hero-lede">HoodFlow finds a live route for your exact amount, blocks unsafe fills and sends the purchased Stock Token directly to your wallet.</p>
              <div className="hf-term-strip"><Hint label="Route">The path and liquidity pool used to exchange one token for another.</Hint><Hint label="Oracle">A reference price used as a safety check, not the price your swap is guaranteed to receive.</Hint><Hint label="Permit">A short-lived wallet signature allowing only the amount shown in your order.</Hint></div>
              <div className="hf-hero-actions"><button className="hf-primary" onClick={() => navigate("assets")}>Compare live routes <span>→</span></button><a href="/how-it-works">How execution works</a></div>
              <p className="hf-risk-line">Stock Tokens are not shares and may be restricted in your jurisdiction. <a href="https://robinhood.com/eu/en/support/articles/about-stock-tokens/" target="_blank" rel="noreferrer">Review product risks ↗</a></p>
            </div>
            <aside className="hf-execution-card">
              <div className="hf-window-head"><span><i /> LIVE ROUTE DESK</span><b>BLOCK #{networkBlock}</b></div>
              <div className="hf-window-title"><p>Reviewed execution markets</p><strong>{priceState === "loading" ? `${executionReadyAssetCount} routes ready · live feed connecting` : priceState === "error" ? "Routes ready · price check retrying" : `${priceCounts.live} oracle references ready`}</strong></div>
              <div className="hf-route-list">
                {["AAPL", "NVDA", "SPY"].map((ticker) => <button key={ticker} onClick={() => openAsset(ticker)}><Mark ticker={ticker} small /><span><strong>{ticker} / USDG</strong><small>{isV3RoutedAsset(ticker) ? "Uniswap V3" : "Uniswap V4"} · full-fill verified</small></span><b>{priceBook[ticker]?.price ? formatPrice(priceBook[ticker].price) : <span className="price-skeleton route" aria-label="Live price loading" />}</b><i>→</i></button>)}
              </div>
              <div className="hf-window-foot"><span><b>01</b> Fresh quote</span><span><b>02</b> Protected minimum</span><span><b>03</b> Direct settlement</span></div>
            </aside>
          </section>

          <div className="hf-proof-rail"><div><strong>25</strong><span>CANONICAL ASSETS INDEXED</span></div><div><strong>{executionReadyAssetCount}</strong><span>FULL-FILL ROUTES READY</span></div><div><strong>V3 + V4</strong><span>REVIEWED LIQUIDITY</span></div><div><strong>10 MIN</strong><span>EXACT PERMIT WINDOW</span></div></div>

          <section className="hf-thesis">
            <div><p className="eyebrow">WHY HOODFLOW</p><h2>A swap quote is easy.<br /><em>An executable route is harder.</em></h2></div>
            <p>Thin liquidity, partial fills and stale references can turn a clean interface into a bad order. HoodFlow makes the route, protection and permission visible before you sign.</p>
          </section>
          <div className="hf-value-grid">
            <article><span>01 / ROUTE</span><h3>Reviewed liquidity, not a mystery pool.</h3><p>HoodFlow requests a fresh executable quote from the configured V3 or V4 route for your exact input.</p></article>
            <article><span>02 / PROTECTION</span><h3>Less than the minimum means no trade.</h3><p>Your slippage choice becomes an onchain output floor. The order reverts instead of silently accepting less.</p></article>
            <article><span>03 / OWNERSHIP</span><h3>Tokens land in your wallet.</h3><p>Permit2 authorizes only the selected amount for a short window. HoodFlow never becomes your custodian.</p></article>
          </div>

          <section className="hf-compare">
            <div className="hf-compare-copy"><p className="eyebrow">BUILT FOR EXECUTION</p><h2>Know what the router will do.</h2><p>HoodFlow separates the onchain oracle reference from the actual DEX execution quote and shows the boundaries that protect the order.</p><a href="/security">Read Security & Transparency →</a></div>
            <div className="hf-compare-table"><div className="head"><span>ORDER CHECK</span><span>BASIC SWAP VIEW</span><span>HOODFLOW</span></div><div><strong>Route readiness</strong><span>Often implicit</span><b>Full-fill status</b></div><div><strong>Oracle vs execution</strong><span>Easy to confuse</span><b>Clearly separated</b></div><div><strong>Permission</strong><span>Varies by interface</span><b>Exact amount / 10 min</b></div><div><strong>Settlement</strong><span>Wallet</span><b>Wallet</b></div></div>
          </section>

          <div className="price-tape-head"><span>ONCHAIN ORACLE REFERENCES</span><button onClick={() => navigate("assets")}>Explore all 25 <b>→</b></button></div>
          <div className="price-tape">
            {priceSpotlight.map((ticker) => <button key={ticker} onClick={() => openAsset(ticker)}><Mark ticker={ticker} small /><p><span>{ticker}</span><strong>{priceBook[ticker]?.price ? formatPrice(priceBook[ticker].price) : <span className="price-skeleton compact" aria-label="Live price loading" />}</strong></p><small className={priceBook[ticker]?.status ?? "loading"}><i />{priceBook[ticker]?.status === "live" ? formatPriceAge(priceBook[ticker].updatedAt) : priceState === "error" ? "Auto-retrying" : "Connecting live feed"}</small></button>)}
          </div>
          <p className="hf-market-note">Oracle references can remain unchanged while underlying markets are closed. Every Buy or Sell requests a fresh DEX execution quote before your wallet signs.</p>

          <div className="overview-grid hf-wallet-grid">
            <article className="balance-card dark-card"><div className="card-label"><span>{connected ? "CONNECTED WALLET" : "YOUR EXECUTION WALLET"}</span><span className="live-label"><i /> MAINNET</span></div><div className="balance-line"><strong>{connected ? `${walletUsdgBalance} USDG` : "— USDG"}</strong><span>{connected ? `${walletBalance} ETH gas · ${compactAddress(walletAddress)}` : "Connect to view balances and sign protected orders"}</span></div><div className="wallet-facts"><div><span>CHAIN</span><strong>Robinhood / 4663</strong></div><div><span>ROUTER</span><strong>Universal Router</strong></div><div><span>PERMISSION</span><strong>Exact / 10 min</strong></div><div><span>CUSTODY</span><strong>Your wallet</strong></div></div><button className="wallet-card-action" onClick={handleWalletButton}>{connected ? "Disconnect wallet" : "Connect wallet to trade"}</button></article>
            <article className="hf-first-order"><span>YOUR FIRST ROUTE</span><h2>Start with a quote.<br />Signing comes later.</h2><p>Choose a market and amount. HoodFlow checks the executable route before asking for any token permission.</p><button onClick={() => openComposer("Buy", "AAPL")}>Quote an AAPL buy →</button><small>No custody · no account · wallet confirmation required</small></article>
          </div>

          <section className="hf-final-cta"><div><p className="eyebrow">ROBINHOOD CHAIN / MAINNET BETA</p><h2>Trade the route,<br /><em>not the promise.</em></h2></div><div><p>25 canonical markets are indexed. {executionReadyAssetCount} are execution-enabled. The rest stay visible and blocked until their routes pass.</p><button onClick={() => navigate("assets")}>Open the market directory →</button></div></section>

          <section className="hf-faq"><p className="eyebrow">QUESTIONS BEFORE YOU SIGN</p><details><summary>Does HoodFlow custody my assets?</summary><p>No. The connected wallet signs the router transaction and received tokens remain in that wallet.</p></details><details><summary>Are Stock Tokens actual shares?</summary><p>No. Stock Tokens provide economic exposure without shareholder rights and may be restricted in your jurisdiction.</p></details><details><summary>Why are only {executionReadyAssetCount} markets trade-enabled?</summary><p>HoodFlow keeps a token watch-only until a reviewed route completes a full-input fork execution and a fresh quote is available.</p></details><details><summary>Is HoodFlow independently audited?</summary><p>Not yet. Until a public final report exists, HoodFlow exposes its contract source, onchain addresses, automated checks, known limitations and a private responsible-disclosure channel on the <a href="/security">Security page</a>.</p></details></section>
        </section>
      )}

      {view === "strategies" && (
        <section className="page inner-page dca-page">
          <div className="inner-heading"><div><p className="eyebrow">RECURRING ORDERS</p><h1>DCA command center</h1><p>Choose an asset, set an exact USDG amount and lifetime cap, then let the onchain schedule enforce the rest.</p></div><button className="primary-action" onClick={() => openComposer("DCA")}><span>+</span> Create DCA</button></div>
          <div className={`dca-live-strip ${contractReady ? "ready" : "waiting"}`}><div><span><i /> MAINNET ENGINE</span><strong>{contractReady ? "Recurring execution is live" : enginePaused ? "Owner activation required" : "Engine verification retrying"}</strong></div><p>{contractReady ? "The keeper can execute only when the asset, schedule, remaining budget, oracle and slippage checks all pass." : contractStatus}</p><div><span>DCA FEE</span><strong>{engineFeeBps === null ? "Checking" : `${(engineFeeBps / 100).toFixed(2)}%`}</strong></div></div>
          <div className="dca-quick-grid"><article><span>01 · WEEKLY CORE</span><Mark ticker="AAPL" small /><h2>20 USDG into AAPL</h2><p>A simple weekly schedule with a 12-buy lifetime cap.</p><button onClick={() => applyTemplate("AAPL", "Weekly", "Weekly Apple")}>Build this plan →</button></article><article><span>02 · MONTHLY INDEX</span><Mark ticker="SPY" small /><h2>50 USDG into SPY</h2><p>A slower index schedule with every limit visible before signing.</p><button onClick={() => applyTemplate("SPY", "Monthly", "Monthly Index")}>Build this plan →</button></article><article><span>03 · CHIP ACCUMULATION</span><Mark ticker="NVDA" small /><h2>25 USDG into NVDA</h2><p>A weekly semiconductor plan you can pause from the same wallet.</p><button onClick={() => applyTemplate("NVDA", "Weekly", "Weekly NVIDIA")}>Build this plan →</button></article></div>
          <div className="summary-row dca-summary"><div><span>Saved automations</span><strong>{dcaRows.length}</strong></div><div><span>Active schedules</span><strong>{activeDcaCount}</strong></div><div><span>Scheduled cap</span><strong>{scheduledDcaBudget.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDG</strong></div><div><span>Engine status</span><strong>{contractReady ? "Live" : engineChecking ? "Checking" : enginePaused ? "Activation" : "Retrying"}</strong></div></div>
          <div className="dca-how"><article><span>1</span><p><strong>You choose the rules</strong><small>Asset, amount per buy, cadence, total number of buys and maximum slippage.</small></p></article><article><span>2</span><p><strong>The contract enforces the cap</strong><small>No execution can spend above the per-buy amount or remaining lifetime budget.</small></p></article><article><span>3</span><p><strong>You keep control</strong><small>Pause, resume or cancel from the strategy owner wallet. Tokens settle directly to it.</small></p></article></div>
          <div className="device-save-note"><span><i /> RECEIPTS SAVED ON THIS DEVICE</span><p>Confirmed transaction references and onchain strategy IDs are kept locally. Wallet keys and account data are never stored.</p></div>
          <div className="table-card">
            <div className="table-head upgraded"><span>ORDER / AUTOMATION</span><span>RULE</span><span>RESULT / NEXT ACTION</span><span>CHAIN</span><span>STATUS</span><span /></div>
            {dcaRows.map((item) => <StrategyRow key={item.id} item={item} detailed onToggle={() => toggleStrategy(item.id)} onInspect={() => setSelectedStrategy(item)} />)}
            {dcaRows.length === 0 && <div className="empty-state order-empty dca-empty"><strong>Your first DCA takes about a minute to configure</strong><span>Start with a template, edit every limit, and review the exact onchain cap before your wallet signs.</span><button onClick={() => openComposer("DCA")}>Create first DCA</button></div>}
          </div>
          <p className="dca-risk-note">Automation does not guarantee execution or returns. A stale oracle, paused token, insufficient allowance, low liquidity or slippage breach stops the scheduled buy.</p>
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
            <div><span><i /> CHAINLINK ORACLE / ROBINHOOD MAINNET</span><strong>{priceState === "loading" ? "Connecting secure price sources" : priceState === "error" ? "Automatic recovery in progress" : `${priceCounts.live} current · ${priceCounts.guarded} guarded · ${25 - priceCounts.available} unavailable`}</strong></div>
            <p><strong>{priceState === "live" ? "Onchain token prices verified" : priceState === "degraded" ? "Verified snapshot · refreshing" : priceState === "error" ? "Routes online · price feed delayed" : "Live checks are running"}</strong><span>{priceState === "live" ? "Each value passed its onchain price and token pause checks. Execution still uses a fresh pool quote." : "Each market appears as soon as both its onchain price and pause state verify."}</span>{priceError && <small>{priceError}</small>}</p>
            <div className="price-refresh"><span>{priceUpdatedAt ? `Last verified ${new Date(priceUpdatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · every 10s` : "First check in progress · every 10s"}</span><button onClick={() => void refreshPrices()} disabled={priceRefreshing}>{priceRefreshing ? "Checking live feed" : "Check now"}</button></div>
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
          <AssetRequestBoard walletAddress={walletAddress} walletProvider={walletProvider} onWallet={handleWalletButton} notify={notify} />
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
              <div className="asset-price-line"><div><span>ONCHAIN TOKEN PRICE</span><strong>{priceBook[selectedAsset.ticker]?.price ? formatPrice(priceBook[selectedAsset.ticker].price) : <span className="price-skeleton detail" aria-label="Live price loading" />}</strong><small>{priceBook[selectedAsset.ticker]?.status === "live" ? formatPriceAge(priceBook[selectedAsset.ticker].updatedAt) : priceState === "error" ? "Automatic verification retry active" : "Connecting to live onchain feed"}</small></div>{historyStats && <div className={historyStats.change >= 0 ? "positive" : "negative"}><span>ROUND RANGE</span><strong>{historyStats.change >= 0 ? "+" : ""}{historyStats.change.toFixed(2)}%</strong><small>{priceHistory.length} verified rounds</small></div>}</div>
              <PriceHistoryChart points={priceHistory} loading={historyLoading} livePoint={priceBook[selectedAsset.ticker]} />
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

      {view === "community" && <CommunityTokens walletAddress={walletAddress} walletProvider={walletProvider} onWallet={handleWalletButton} notify={notify} onTradeConfirmed={qualifyReferral} />}

      {view === "agents" && <AgentsWorkspace onOpenMarket={openAgentMarket} />}

      {view === "portfolio" && (
        <section className="page inner-page portfolio-page">
          <div className="inner-heading"><div><p className="eyebrow">MY PORTFOLIO</p><h1>Your positions,<br />read from the chain.</h1><p>Live wallet balances with token value, browser-tracked entry cost and confirmed HoodFlow receipts.</p></div><button className="primary-action" onClick={() => connected && walletProvider ? void refreshWalletBalances(walletAddress, new BrowserProvider(walletProvider, "any")) : handleWalletButton()}>{connected ? "Refresh wallet" : "Connect wallet"}</button></div>
          {!connected ? <div className="portfolio-connect"><span>01</span><h2>Connect to read your Stock Tokens.</h2><p>HoodFlow reads public balances. It does not import private keys or custody assets.</p><button onClick={handleWalletButton}>Connect wallet →</button></div> : <>
            <div className="portfolio-summary"><article><span>TOKEN VALUE</span><strong>{usdFormatter.format(portfolioTotals.value)}</strong><small>{portfolioRows.length} positions with balance</small></article><article><span>TRACKED UNREALIZED PNL</span><strong className={portfolioTotals.unrealized >= 0 ? "positive" : "negative"}>{portfolioTotals.unrealized >= 0 ? "+" : ""}{usdFormatter.format(portfolioTotals.unrealized)}</strong><small>HoodFlow trades saved in this browser</small></article><article><span>TRACKED REALIZED PNL</span><strong className={portfolioTotals.realized >= 0 ? "positive" : "negative"}>{portfolioTotals.realized >= 0 ? "+" : ""}{usdFormatter.format(portfolioTotals.realized)}</strong><small>Average-cost method</small></article><article><span>AVAILABLE CASH</span><strong>{walletUsdgBalance || "0.00"} USDG</strong><small>{walletBalance || "0.0000"} ETH for gas</small></article></div>
            <div className="portfolio-table"><div className="portfolio-table-head"><span>ASSET</span><span>BALANCE</span><span>VALUE</span><span>AVG ENTRY</span><span>PNL</span><span /></div>{portfolioRows.map((row) => <article key={row.ticker}><div><Mark ticker={row.ticker} /><p><strong>{row.ticker}</strong><small>{row.name}</small></p></div><strong>{row.balance.toLocaleString("en-US", { maximumFractionDigits: 6 })}</strong><strong>{row.currentValue === null ? "Price unavailable" : usdFormatter.format(row.currentValue)}</strong><span>{row.averageEntry === null ? "Not tracked" : usdFormatter.format(row.averageEntry)}</span><span className={(row.unrealizedPnl ?? 0) >= 0 ? "positive" : "negative"}>{row.unrealizedPnl === null ? "—" : `${row.unrealizedPnl >= 0 ? "+" : ""}${usdFormatter.format(row.unrealizedPnl)}`}</span><button onClick={() => openAsset(row.ticker)}>Open →</button>{row.importedQuantity > 0.00000001 && <small className="portfolio-imported">{row.importedQuantity.toLocaleString("en-US", { maximumFractionDigits: 6 })} tokens have no HoodFlow cost basis in this browser.</small>}</article>)}{!portfolioLoading && portfolioRows.length === 0 && <div className="empty-state"><strong>No Stock Token balance found</strong><span>This wallet does not currently hold one of HoodFlow&apos;s 25 indexed Stock Tokens.</span></div>}{portfolioLoading && <div className="empty-state"><strong>Reading onchain balances…</strong><span>Checking the indexed token registry.</span></div>}</div>
            <p className="portfolio-note">PnL is informational. Average entry uses only confirmed HoodFlow trades saved in this browser; transferred or previously acquired tokens are shown without an invented cost basis.</p>
          </>}
        </section>
      )}

      {view === "rewards" && <ReferralRewards walletAddress={walletAddress} walletProvider={walletProvider} onWallet={handleWalletButton} notify={notify} />}

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
          <p className="market-note">{contractReady ? "Recurring templates open an editable capped strategy. Nothing moves until your wallet confirms." : "Recurring templates are unavailable while the HoodFlow engine is not verified and active on mainnet."}</p>
        </section>
      )}

      {view === "activity" && (
        <section className="page inner-page activity-page">
          <div className="inner-heading"><div><p className="eyebrow">MAINNET RECEIPTS</p><h1>Activity</h1><p>A wallet-specific timeline of confirmed trades and DCA creation transactions saved on this device.</p></div><div className="activity-head-actions"><button className="secondary-action" onClick={exportActivity} disabled={!connected || activityRows.length === 0}>Export CSV</button><button className="primary-action" onClick={() => openComposer("Buy")}>New trade</button></div></div>
          <div className="activity-overview"><article><span>CONFIRMED RECEIPTS</span><strong>{activityRows.length}</strong><small>Explorer-linked mainnet transactions</small></article><article><span>TRACKED TRADE VOLUME</span><strong>{trackedTradeVolume.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDG</strong><small>Buys spent plus sell proceeds</small></article><article><span>DCA CREATED</span><strong>{activityRows.filter((item) => item.kind === "DCA").length}</strong><small>Onchain automation receipts</small></article><article><span>LAST ACTIVITY</span><strong>{activityRows[0] ? new Date(activityRows[0].createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "None yet"}</strong><small>{activityRows[0] ? new Date(activityRows[0].createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "Your first receipt will appear here"}</small></article></div>
          <div className="activity-toolbar"><div>{(["all", "trades", "dca"] as ActivityFilter[]).map((filter) => <button key={filter} className={activityFilter === filter ? "selected" : ""} onClick={() => setActivityFilter(filter)}>{filter === "all" ? `All ${activityRows.length}` : filter === "trades" ? "Buy & Sell" : "DCA"}</button>)}</div><span><i /> {connected ? `${compactAddress(walletAddress)} · Robinhood Chain` : "Connect wallet to load receipts"}</span></div>
          <div className="activity-card">
            {connected && visibleActivityRows.map((item) => <div className="activity-row upgraded" key={item.id}><Mark ticker={item.asset} /><div><span className={`activity-kind ${item.kind.toLowerCase()}`}>{item.kind}</span><strong>{item.kind === "Buy" ? `Bought ${item.asset}` : item.kind === "Sell" ? `Sold ${item.asset}` : `${item.asset} DCA created`}</strong><small>{item.name}</small></div><p><strong>{item.detail}</strong><small>{item.rule}</small></p><time>{new Date(item.createdAt).toLocaleString()}</time><a className="activity-status" href={`${ROBINHOOD_MAINNET.blockExplorerUrls[0]}/tx/${item.txHash}`} target="_blank" rel="noreferrer">View receipt ↗</a></div>)}
            {!connected && <div className="empty-state order-empty activity-empty wallet-locked-empty"><span className="activity-lock" aria-hidden="true">↳</span><strong>Connect a wallet to view activity</strong><span>Receipts are isolated by wallet address. Disconnecting immediately hides every local transaction label.</span><div><button onClick={handleWalletButton}>Connect wallet</button></div></div>}
            {connected && activityRows.length === 0 && <div className="empty-state order-empty activity-empty"><strong>No confirmed mainnet activity yet</strong><span>Start with a live quote. Once the wallet confirms, HoodFlow stores the transaction reference under this wallet only and links the block explorer receipt.</span><div><button onClick={() => openComposer("Buy")}>Buy a Stock Token</button><button onClick={() => openComposer("DCA")}>Create a DCA</button></div></div>}
            {activityRows.length > 0 && visibleActivityRows.length === 0 && <div className="empty-state"><strong>No receipts in this filter</strong><span>Your other confirmed activity remains available under All.</span></div>}
          </div>
          <div className="activity-proof"><article><span>01</span><p><strong>Wallet confirmed</strong><small>Prepared quotes never appear as completed activity.</small></p></article><article><span>02</span><p><strong>Explorer linked</strong><small>Every row opens the public transaction receipt.</small></p></article><article><span>03</span><p><strong>Exportable</strong><small>Download the same local receipt history as CSV.</small></p></article></div>
          <p className="activity-local-note">This device-local index is separated by wallet address and is not a complete tax record. Disconnecting hides it immediately; clearing browser storage removes the labels but never changes onchain transactions.</p>
        </section>
      )}

      {view === "controls" && (
        <section className="page inner-page controls-page">
          <div className="inner-heading"><div><p className="eyebrow">SECURITY & PERMISSIONS</p><h1>Your wallet stays in control.</h1><p>See what HoodFlow can do, what it cannot do, and every permission you have approved.</p></div></div>
          <div className="control-grid">
            <article className="control-card"><span>CUSTODY</span><strong>Funds stay in your wallet</strong><p>HoodFlow cannot withdraw assets by itself. Every Buy and Sell order requires your wallet confirmation.</p><b className="control-ok">YOU CONTROL</b></article>
            <article className="control-card"><span>BUY & SELL</span><strong>{executionReadyAssetCount} verified routes</strong><p>Fresh quotes, maximum slippage protection, and exact short-lived order permissions.</p><b className="control-ok">LIVE</b></article>
            <article className="control-card dca-control"><span>RECURRING DCA</span><strong>{contractReady ? "Active on mainnet" : enginePaused ? "Ready to activate" : engineChecking ? "Verifying engine" : "Verification delayed"}</strong><p>{contractReady ? "Capped recurring strategies can be created and executed onchain." : enginePaused ? "Only the owner wallet can switch the DCA engine on." : contractStatus}</p><div><b className={`control-ok ${contractReady ? "" : "warning"}`}>{contractReady ? "LIVE" : engineChecking ? "CHECKING" : enginePaused ? "OWNER ACTION" : "AUTO RETRY"}</b>{!contractReady && !engineChecking && <button type="button" className="engine-retry" onClick={() => void refreshEngineStatus()}>Retry now</button>}</div></article>
            <article className="control-card"><span>RPC HEALTH</span><strong>{rpcHealth ? `${rpcHealth.endpoint} · ${rpcHealth.latencyMs} ms` : "Checking endpoints"}</strong><p>Server reads retry the configured RPC list automatically. Wallet transactions still use the endpoint selected inside your wallet.</p><b className="control-ok">{rpcHealth ? `${rpcHealth.configuredEndpoints} ENDPOINT${rpcHealth.configuredEndpoints === 1 ? "" : "S"}` : "CHECKING"}</b></article>
            <article className="control-card"><span>ENGINE CONTROL</span><strong>{engineOwner ? `${compactAddress(engineOwner)} · ${engineOwnerType}` : "Reading owner"}</strong><p>{engineOwnerType === "EOA" ? "The current owner is a single externally owned wallet. A multisig or timelock is not verified." : engineOwnerType === "Contract" ? "The controller is a contract, but its multisig or timelock policy has not been independently verified." : "Controller type is still being checked."}</p><b className={`control-ok ${engineOwnerType === "EOA" ? "warning" : ""}`}>{engineOwnerType === "EOA" ? "CENTRALIZATION RISK" : "VERIFY ONCHAIN"}</b></article>
          </div>
          <div className="permissions-card">
            <div className="permissions-head"><div><p className="eyebrow">ONCHAIN ORDERS</p><h2>Strategy permissions</h2></div><span>{strategies.length} records</span></div>
            {strategies.map((item) => <div className="permission-row" key={item.id}><div className="permission-name"><Mark ticker={item.asset} /><p><strong>{item.name}</strong><small>{item.asset} only</small></p></div><div><span>SPENDING CAP</span><strong>{item.budget}</strong></div><div><span>EXPIRES</span><strong>{item.expires}</strong></div><div><span>CHAIN</span><strong>Mainnet</strong></div><button onClick={() => toggleStrategy(item.id)} disabled={item.status === "Confirmed" || item.status === "Cancelled"}>{item.status === "Confirmed" ? "Settled" : item.status === "Cancelled" ? "Cancelled" : item.status === "Prepared" ? "Pause" : "Resume"}</button></div>)}
            {strategies.length === 0 && <div className="empty-state"><strong>No active permissions</strong><span>No HoodFlow strategy currently has a saved onchain permission.</span></div>}
          </div>
          <div className="safety-notes"><article><span>01</span><div><strong>Asset allowlist</strong><p>A strategy cannot swap into a token that was not approved when it was created.</p></div></article><article><span>02</span><div><strong>Hard budget caps</strong><p>Keepers cannot execute above the per-trade or lifetime spending limit.</p></div></article><article><span>03</span><div><strong>Automatic circuit breaker</strong><p>Stale prices, excess slippage or low liquidity stop execution before a swap.</p></div></article></div>
        </section>
      )}

      <footer><span>HoodFlow Labs · Release 0.10.2</span><div><button onClick={() => navigate("assets")}>Markets</button><button onClick={() => navigate("agents")}>Agents</button><button onClick={() => navigate("portfolio")}>Portfolio</button><Link href="/learn">Learn</Link><Link href="/roadmap">Roadmap</Link><Link href="/docs">Docs</Link><Link href="/security">Security</Link><a className="x-social" href="https://x.com/hoodfloow" target="_blank" rel="noreferrer" aria-label="HoodFlow on X"><b>𝕏</b> @hoodfloow</a></div><span className="chain-tag mainnet-tag"><i /> MAINNET BETA</span></footer>

      {composerOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setComposerOpen(false); }}>
          <section className="composer wide-composer" role="dialog" aria-modal="true" aria-labelledby="composer-title">
            <div className="composer-head"><div><p className="eyebrow">NEW ORDER</p><h2 id="composer-title">{kind === "Buy" ? "Buy with limits." : kind === "Sell" ? "Sell to USDG." : "Automate with limits."}</h2></div><button aria-label="Close strategy builder" onClick={() => setComposerOpen(false)} disabled={onchainBusy}>x</button></div>
            <div className="kind-grid">
              {(["Buy", "Sell", "DCA"] as StrategyKind[]).map((item, index) => <button type="button" key={item} className={kind === item ? "selected" : ""} onClick={() => openComposer(item, draftAsset)} disabled={onchainBusy}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item === "Buy" ? "Buy now" : item === "Sell" ? "Sell now" : "Recurring DCA"}</strong><small>{item === "Buy" ? "USDG to stock token" : item === "Sell" ? "Stock token to USDG" : contractReady ? "Recurring mainnet buys" : enginePaused ? "Owner activation required" : "Checking engine"}</small></button>)}
            </div>
            <form onSubmit={createStrategy}>
              <label>ORDER NAME<input name="name" value={draftName} onChange={(event) => setDraftName(event.target.value)} required disabled={onchainBusy} /></label>
              <div className="asset-choice"><Mark ticker={draftAsset} /><label>ASSET <small>{kind === "DCA" ? "13 recurring V4 routes" : `${executionReadyAssetCount} verified swap routes`}</small><select name="asset" value={draftAsset} onChange={(event) => setDraftAsset(event.target.value)}>{assetRegistry.filter((asset) => asset.fullFill && (kind !== "DCA" || !isV3RoutedAsset(asset.ticker))).map((asset) => <option key={asset.ticker} value={asset.ticker}>{asset.ticker} · {asset.name} · {formatPrice(priceBook[asset.ticker]?.price)}</option>)}</select></label></div>
              <div className="form-pair">
                <label>{kind === "Buy" ? "TOTAL TO SPEND" : kind === "Sell" ? "AMOUNT TO SELL" : "EACH BUY"}<span className="input-unit"><input name="amount" type="number" min={kind === "Sell" ? "0.000000000000000001" : "0.000001"} step={kind === "Sell" ? "0.000000000000000001" : "0.000001"} value={draftAmount} onChange={(event) => setDraftAmount(event.target.value)} required disabled={onchainBusy} /><b>{kind === "Sell" ? draftAsset : "USDG"}</b></span></label>
                <label>MAX SLIPPAGE<span className="input-unit"><input name="slippage" type="number" min="0.01" max="5" step="0.01" value={draftSlippage} onChange={(event) => setDraftSlippage(event.target.value)} required disabled={onchainBusy} /><b>%</b></span></label>
              </div>
              {kind === "DCA" && <div className="form-pair"><label>SCHEDULE<select name="frequency" value={draftFrequency} onChange={(event) => setDraftFrequency(event.target.value)} disabled={onchainBusy}><option>Daily</option><option>Weekly</option><option>Monthly</option></select></label><label>NUMBER OF BUYS<span className="input-unit"><input name="executions" type="number" min="2" max={draftFrequency === "Daily" ? "52" : draftFrequency === "Weekly" ? "52" : "12"} value={draftExecutions} onChange={(event) => setDraftExecutions(event.target.value)} disabled={onchainBusy} /><b>×</b></span></label></div>}
              <div className="live-order-banner"><i /><span><strong>{kind === "Buy" ? "Buy stock tokens with USDG" : kind === "Sell" ? `Sell ${draftAsset} back to USDG` : contractReady ? "Mainnet recurring strategy" : enginePaused ? "DCA engine awaits owner activation" : "Checking recurring engine"}</strong><small>{kind === "Buy" ? "Your wallet confirms a protected mainnet buy." : kind === "Sell" ? "Your wallet confirms an exact-token sell; USDG returns directly to you." : contractReady ? "The onchain engine enforces your schedule and lifetime cap." : enginePaused ? "Connect the owner wallet and confirm one activation transaction." : "Buy and Sell remain available while the engine check completes."}</small></span><b>{kind !== "DCA" || contractReady ? "LIVE" : enginePaused ? "READY" : "CHECKING"}</b></div>
              <div className="execution-preview"><div className="preview-head"><span>ORDER REVIEW</span><b>{kind === "DCA" ? contractReady ? "MAINNET DCA" : enginePaused ? "OWNER ACTIVATION REQUIRED" : "ENGINE CHECK" : composerQuoteBusy ? "UPDATING QUOTE" : composerQuote ? `LIVE ${composerQuote.protocol} QUOTE` : "WAITING FOR ROUTE"}</b></div><div className="preview-grid"><p><span>Estimated receive</span><strong>{kind === "DCA" ? `${estimatedUnits} ${draftAsset} each` : composerQuote ? `${Number(composerQuote.amountOut).toLocaleString("en-US", { maximumFractionDigits: 8 })} ${kind === "Sell" ? "USDG" : draftAsset}` : "—"}</strong></p><p><span>{kind === "Sell" ? "Sell amount" : "Total USDG cap"}</span><strong>{kind === "Sell" ? `${draftAmount || "0"} ${draftAsset}` : `${draftTotalBudget.toFixed(2)} USDG`}</strong></p><p><span>Minimum received</span><strong>{kind === "DCA" ? `${draftSlippage}% max · engine cap` : composerQuote ? `${Number(composerQuote.minimumOut).toLocaleString("en-US", { maximumFractionDigits: 8 })} ${kind === "Sell" ? "USDG" : draftAsset}` : "Waiting for route"}</strong></p><p><span>Oracle status</span><strong>{priceBook[draftAsset]?.status === "live" ? formatPriceAge(priceBook[draftAsset].updatedAt) : priceBook[draftAsset]?.status ?? "Syncing"}</strong></p></div></div>
              <div className="fee-review"><div><span>POOL FEE</span><strong>{kind === "DCA" ? "Selected at execution" : composerQuote ? `${(composerQuote.feeBps / 100).toFixed(2)}%` : "—"}</strong></div><div><span>HOODFLOW FEE</span><strong>{kind === "DCA" ? engineFeeBps === null ? "Checking" : `${(engineFeeBps / 100).toFixed(2)}%` : "0.00%"}</strong></div><div><span>NETWORK GAS</span><strong>Shown in wallet</strong></div><div><span>QUOTE REFRESH</span><strong>{kind === "DCA" ? "At execution" : composerQuote ? composerQuoteBusy ? "Refreshing · last quote kept" : "Fresh · auto" : composerQuoteBusy ? "Updating" : "Unavailable"}</strong></div></div>
              {composerQuoteError && kind !== "DCA" && <div className="quote-inline-error"><strong>Route unavailable for this amount.</strong><span>{composerQuoteError}</span><button type="button" onClick={() => void refreshComposerQuote()}>Try again</button></div>}
              <div className="limit-note"><span>✓</span><p><strong>{kind === "DCA" ? "Spending limits stay enforced onchain." : "The order permission is exact and short-lived."}</strong><small>{kind === "Buy" ? "HoodFlow signs only this USDG amount for the router." : kind === "Sell" ? `HoodFlow signs only the selected ${draftAsset} amount; sale proceeds return as USDG.` : "The recurring engine cannot execute outside the selected asset, total budget, schedule and expiry."}</small></p></div>
              {transactionStep && <div className="transaction-step"><i /><span>{transactionStep}</span></div>}
              <div className="composer-actions"><button type="button" onClick={() => setComposerOpen(false)} disabled={onchainBusy}>Cancel</button><button type="submit" className="primary-action" disabled={onchainBusy || (connected && (kind === "Buy" || kind === "Sell") && !composerQuote) || (connected && kind === "DCA" && !contractReady && !enginePaused)}>{onchainBusy ? "Working…" : kind === "Buy" ? connected ? `Buy ${draftAsset} with USDG` : "Connect wallet first" : kind === "Sell" ? connected ? `Sell ${draftAsset} for USDG` : "Connect wallet first" : contractReady ? connected ? "Create onchain DCA" : "Connect wallet first" : enginePaused ? connected ? "Activate DCA engine" : "Connect owner wallet to activate" : connected ? "Checking engine" : "Connect wallet first"} <span>&rarr;</span></button></div>
            </form>
          </section>
        </div>
      )}

      {selectedStrategy && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !onchainBusy) setSelectedStrategy(null); }}>
        <section className="detail-drawer" role="dialog" aria-modal="true" aria-label={`${selectedStrategy.name} details`}>
          <div className="composer-head"><div><p className="eyebrow">MAINNET ORDER</p><h2>{selectedStrategy.name}</h2></div><button onClick={() => setSelectedStrategy(null)} disabled={onchainBusy}>x</button></div>
          <div className="order-status-hero"><Mark ticker={selectedStrategy.asset} /><div><strong>{selectedStrategy.status}</strong><span>{selectedStrategy.detail}</span></div></div>
          <div className="health-checks"><div><span>Network</span><strong>Robinhood Chain <b>4663</b></strong></div><div><span>Order type</span><strong>{selectedStrategy.kind} <b>ONCHAIN</b></strong></div><div><span>Asset</span><strong>{selectedStrategy.asset} <b>ONLY</b></strong></div><div><span>Created</span><strong>{new Date(selectedStrategy.createdAt).toLocaleString()}</strong></div></div>
          <div className="permission-summary"><p><span>Rule</span><strong>{selectedStrategy.rule}</strong></p><p><span>Spending cap</span><strong>{selectedStrategy.budget}</strong></p><p><span>Permission expires</span><strong>{selectedStrategy.expires}</strong></p></div>
          {selectedStrategy.txHash ? <a className="drawer-action receipt-link" href={`${ROBINHOOD_MAINNET.blockExplorerUrls[0]}/tx/${selectedStrategy.txHash}`} target="_blank" rel="noreferrer">View mainnet receipt ↗</a> : null}
          {selectedStrategy.kind === "DCA" && selectedStrategy.chainStrategyId && selectedStrategy.status !== "Cancelled" && <button type="button" className="drawer-action" onClick={() => void cancelOnchainStrategy(selectedStrategy.id)} disabled={onchainBusy}>{onchainBusy ? "Cancelling…" : "Cancel strategy onchain"}</button>}
        </section>
      </div>}

      {walletModalOpen && !connected && <div className="confirm-backdrop wallet-connect-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !walletConnecting) setWalletModalOpen(false); }}><section className="wallet-connect-card" role="dialog" aria-modal="true" aria-labelledby="wallet-connect-title">
        <button className="wallet-connect-close" type="button" aria-label="Close wallet options" onClick={() => setWalletModalOpen(false)} disabled={walletConnecting}>×</button>
        <div className="wallet-brand-orb" aria-hidden="true"><img src="/favicon.svg" alt="" width={58} height={58} /></div>
        <div className="wallet-connect-heading"><h2 id="wallet-connect-title">Log in or sign up</h2><p>Connect to HoodFlow</p></div>
        <p className="wallet-connect-intro">Use a self-custody wallet to trade on Robinhood Chain. HoodFlow never sees your seed phrase or private key.</p>
        <div className="wallet-connect-options">
          {PRIVY_CONFIGURED && <button type="button" className="wallet-option wallet-option-privy" onClick={openPrivy} disabled={walletConnecting || !privyRuntimeReady}><span className="wallet-option-icon privy">P</span><span><strong>{privyRuntimeReady ? "Continue with Privy" : "Loading secure sign-in…"}</strong><small>{privyRuntimeReady ? "Email, Google, X, passkey or wallet" : "Privy loads only when you open this panel"}</small></span><b>{privyRuntimeReady ? "SECURE" : "…"}</b></button>}
          <button type="button" className="wallet-option" onClick={() => void connectBrowserWallet("rabby")} disabled={walletConnecting}><span className="wallet-option-icon rabby">R</span><span><strong>Rabby Wallet</strong><small>Best detected EVM wallet experience</small></span><b>4663</b></button>
          <button type="button" className="wallet-option" onClick={() => void connectBrowserWallet("metamask")} disabled={walletConnecting}><span className="wallet-option-icon metamask">M</span><span><strong>MetaMask</strong><small>Browser extension and mobile app</small></span><b>4663</b></button>
          <button type="button" className="wallet-option" onClick={() => void connectBrowserWallet("okx")} disabled={walletConnecting}><span className="wallet-option-icon okx">OKX</span><span><strong>OKX Wallet</strong><small>Connect the installed OKX extension</small></span><b>4663</b></button>
          <div className="wallet-connect-divider"><span>OR</span></div>
          <button type="button" className="wallet-option wallet-option-wc" onClick={() => void connectWalletConnect()} disabled={walletConnecting || walletConnectReady !== true}><span className="wallet-option-icon walletconnect">W</span><span><strong>Continue with a wallet</strong><small>{walletConnectReady === null ? "Checking WalletConnect…" : walletConnectReady ? "Scan QR or open your mobile wallet" : "WalletConnect is temporarily unavailable"}</small></span><b>{walletConnectReady ? "QR" : "OFFLINE"}</b></button>
        </div>
        <p className="wallet-connect-terms">By connecting, you confirm that you understand the product risks and jurisdiction restrictions.</p>
        <div className="wallet-connect-foot"><span><i /> Robinhood Chain mainnet</span><strong>{PRIVY_CONFIGURED ? "PROTECTED BY PRIVY" : "CHAIN ID 4663"}</strong></div>
      </section></div>}

      {infoPanel && <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setInfoPanel(null); }}><section className="info-card" role="dialog" aria-modal="true" aria-labelledby="info-title"><div className="composer-head"><div><p className="eyebrow">{infoPanel === "docs" ? "QUICK GUIDE" : "PRODUCT RISKS"}</p><h2 id="info-title">{infoPanel === "docs" ? "Know every status." : "Understand before you trade."}</h2></div><button aria-label="Close information" onClick={() => setInfoPanel(null)}>x</button></div>{infoPanel === "docs" ? <div className="info-list"><article><span>01</span><p><strong>Buy or sell</strong><small>HoodFlow compares reviewed liquidity routes and returns a protected quote.</small></p></article><article><span>02</span><p><strong>Exact order permission</strong><small>Permit2 signs only the selected token amount for ten minutes.</small></p></article><article><span>03</span><p><strong>Full-fill ready</strong><small>The complete input passed a router fork test. A fresh quote is still required.</small></p></article><article><span>04</span><p><strong>Watch-only</strong><small>The token remains visible, but HoodFlow blocks trading until a route is verified.</small></p></article><article><span>05</span><p><strong>Recurring DCA</strong><small>A separate optional automation layer; direct Buy and Sell remain the primary product.</small></p></article></div> : <div className="info-copy"><p><strong>Stock Tokens are not shares.</strong> Robinhood describes them as derivative contracts that track an underlying security without granting shareholder rights.</p><p>Stock Tokens carry a high level of risk, may not be appropriate for every investor, and eligibility or jurisdictional restrictions can apply.</p><p>Verify the token amount, minimum output and router address in your wallet before signing. Network gas is paid in ETH.</p><p><a href="https://robinhood.com/eu/en/support/articles/about-stock-tokens/" target="_blank" rel="noreferrer">Review Robinhood&apos;s Stock Token explanation and risks ↗</a></p></div>}<button className="drawer-action" onClick={() => setInfoPanel(null)}>Got it</button></section></div>}

      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}

function StrategyRow({ item, detailed = false, onToggle, onInspect }: { item: Strategy; detailed?: boolean; onToggle: () => void; onInspect: () => void }) {
  const terminal = item.status === "Confirmed" || item.status === "Cancelled";
  return <article className={`strategy-row ${detailed ? "detailed upgraded" : ""}`}><div className="strategy-name"><Mark ticker={item.asset} /><p><strong>{item.name}</strong><small>{item.kind} · {item.asset}</small></p></div><div className="rule-cell"><span>{detailed ? "" : "RULE"}</span><strong>{item.rule}</strong></div><div className="next-cell"><span>{detailed ? "" : "RESULT"}</span><strong>{item.detail}</strong></div>{detailed && <div className="health-cell"><strong>4663</strong><span>MAINNET</span></div>}<button className={`status-button ${item.status.toLowerCase()}`} onClick={onToggle} disabled={terminal}><i />{item.status}</button><button className="row-more" onClick={onInspect} aria-label={`Inspect ${item.name}`}>DETAILS</button></article>;
}
