"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";

import { track } from "@/lib/analytics-client";

export const DEFAULT_RAGRET_COMMUNITY_ADDRESS = "0x52acaa5b1964f8d09c0c775cc0e32126ee99f11d";

export type RagretStockMarket = {
  ticker: string;
  name: string;
  type?: string;
  route?: string;
};

export type RagretBuyIntent = {
  side: "buy";
  amount: string;
  slippageBps: number;
};

export type RagretReceiptProps = {
  stockMarkets: RagretStockMarket[];
  onOpenStockMarket: (ticker: string, intent: RagretBuyIntent) => void;
  onOpenCommunityMarket: (address: string, intent: Omit<RagretBuyIntent, "slippageBps">) => void;
};

type CommunityMarket = {
  address: string;
  name: string;
  symbol: string;
  priceUsd: number | null;
  priceChange24h: number | null;
  liquidityUsd: number;
  volume24h: number;
  pairAddress: string;
  pairUrl: string;
  dex: string;
  lifecycle: "bonding" | "graduated" | "dex";
  executionVenue: "dex" | "virtuals-bonding";
};

type RagretReceipt = {
  receiptId: string;
  status: "scenario-receipt";
  scenario: true;
  transactionProof: false;
  requiresUserSignature: false;
  verdict: "RAGRET" | "NO_RAGRETS" | "EVEN";
  severity: "paper-cut" | "sting" | "scar" | "legendary";
  winner: string;
  headline: string;
  shareText: string;
  notionalUsdg: string;
  windowHours: number;
  stock: {
    ticker: string;
    name: string;
    startPriceUsd: string;
    endPriceUsd: string;
    returnBps: number;
    returnPct: string;
    scenarioValueUsdg: string;
    startedAt: string;
    observedAt: string;
    sourceId: string;
  };
  community: {
    address: string;
    name: string;
    symbol: string;
    returnBps: number;
    returnPct: string;
    scenarioValueUsdg: string;
    liquidityUsd: number;
    lifecycle: string;
    pairUrl: string;
    observedAt: string;
  };
  gap: {
    signedUsdg: string;
    absoluteUsdg: string;
    returnBps: number;
    returnPct: string;
  };
  methodology: {
    benchmark: string;
    communityWindow: string;
    excludes: string[];
    assumption: string;
    notice: string;
  };
  generatedAt: string;
};

type RagretErrorPayload = { error?: string; retryable?: boolean };

const REMIX_STOCK_PARAM = "ragretStock";
const REMIX_TOKEN_PARAM = "ragretToken";
const REMIX_AMOUNT_PARAM = "ragretAmount";
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const RECEIPT_WIDTH = 1_200;
const RECEIPT_HEIGHT = 675;

function compactAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatMoney(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Price unavailable";
  if (value > 0 && value < 0.0001) return `$${value.toExponential(2)}`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1 ? 2 : 6,
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "24h unavailable";
  return `${value >= 0 ? "+" : ""}${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function signedPercent(value: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return `${number > 0 ? "+" : ""}${number.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function receiptVerdictLabel(verdict: RagretReceipt["verdict"]) {
  if (verdict === "NO_RAGRETS") return "NO RAGRETS";
  return verdict;
}

function buildRemixUrl(receipt: RagretReceipt) {
  const url = new URL("/", window.location.origin);
  url.searchParams.set("view", "agents");
  url.searchParams.set("ragret", "1");
  url.searchParams.set(REMIX_STOCK_PARAM, receipt.stock.ticker);
  url.searchParams.set(REMIX_TOKEN_PARAM, receipt.community.address);
  url.searchParams.set(REMIX_AMOUNT_PARAM, receipt.notionalUsdg);
  return url.href;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function truncateCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (context.measureText(text).width <= maxWidth) return text;
  let output = text;
  while (output.length > 1 && context.measureText(`${output}…`).width > maxWidth) output = output.slice(0, -1);
  return `${output}…`;
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines - 1) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  const consumed = lines.join(" ");
  if (consumed.length < text.trim().length && lines.length) {
    lines[lines.length - 1] = truncateCanvasText(context, `${lines.at(-1)}…`, maxWidth);
  }
  lines.forEach((value, index) => context.fillText(value, x, y + index * lineHeight));
}

function drawScenarioCard(canvas: HTMLCanvasElement, receipt: RagretReceipt, logo?: CanvasImageSource) {
  canvas.width = RECEIPT_WIDTH;
  canvas.height = RECEIPT_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not create the receipt image.");

  const accent = receipt.verdict === "RAGRET" ? "#ff9a80" : receipt.verdict === "NO_RAGRETS" ? "#37f08a" : "#d8d3bd";
  const background = context.createLinearGradient(0, 0, RECEIPT_WIDTH, RECEIPT_HEIGHT);
  background.addColorStop(0, "#101714");
  background.addColorStop(1, "#080c0a");
  context.fillStyle = background;
  context.fillRect(0, 0, RECEIPT_WIDTH, RECEIPT_HEIGHT);

  const glow = context.createRadialGradient(940, 75, 10, 940, 75, 430);
  glow.addColorStop(0, receipt.verdict === "RAGRET" ? "rgba(255,154,128,.20)" : "rgba(55,240,138,.18)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, RECEIPT_WIDTH, RECEIPT_HEIGHT);

  context.fillStyle = "#eef6f1";
  context.font = "700 24px 'IBM Plex Mono', monospace";
  if (logo) {
    context.save();
    roundedRect(context, 60, 13, 42, 42, 10);
    context.clip();
    context.drawImage(logo, 60, 13, 42, 42);
    context.restore();
  }
  context.fillText("HOODFLOW / RAGRET", logo ? 116 : 60, 52);
  context.textAlign = "right";
  context.fillStyle = accent;
  context.font = "700 18px 'IBM Plex Mono', monospace";
  context.fillText("24H SCENARIO RECEIPT", 1_140, 52);
  context.textAlign = "left";

  roundedRect(context, 60, 76, 1_080, 538, 24);
  context.fillStyle = "#fbfaf2";
  context.fill();
  context.strokeStyle = "rgba(55,75,63,.28)";
  context.lineWidth = 2;
  context.stroke();

  context.fillStyle = "#162019";
  context.font = "800 16px 'IBM Plex Mono', monospace";
  context.fillText(receipt.receiptId.toUpperCase(), 94, 116);
  context.textAlign = "right";
  context.fillStyle = "#5f6b63";
  context.font = "600 14px 'IBM Plex Mono', monospace";
  context.fillText(new Date(receipt.generatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }), 1_106, 116);
  context.textAlign = "left";

  context.setLineDash([8, 9]);
  context.strokeStyle = "#bcc5bd";
  context.beginPath();
  context.moveTo(94, 140);
  context.lineTo(1_106, 140);
  context.stroke();
  context.setLineDash([]);

  context.fillStyle = "#68736c";
  context.font = "700 14px 'IBM Plex Mono', monospace";
  context.fillText("SAME STARTING NOTIONAL", 94, 178);
  context.fillStyle = "#101713";
  context.font = "800 35px 'Instrument Sans', sans-serif";
  context.fillText(`${receipt.notionalUsdg} USDG`, 94, 218);
  context.textAlign = "right";
  context.fillStyle = accent;
  context.font = "800 35px 'Instrument Sans', sans-serif";
  context.fillText(receiptVerdictLabel(receipt.verdict), 1_106, 218);
  context.textAlign = "left";

  const cardY = 250;
  const cardWidth = 487;
  for (const [index, leg] of [
    {
      label: "STOCK TOKEN",
      symbol: receipt.stock.ticker,
      name: receipt.stock.name,
      value: receipt.stock.scenarioValueUsdg,
      change: receipt.stock.returnPct,
    },
    {
      label: "COMMUNITY TOKEN",
      symbol: receipt.community.symbol,
      name: receipt.community.name,
      value: receipt.community.scenarioValueUsdg,
      change: receipt.community.returnPct,
    },
  ].entries()) {
    const x = 94 + index * 525;
    roundedRect(context, x, cardY, cardWidth, 154, 16);
    context.fillStyle = index === 0 ? "#edf4ee" : "#f3efe5";
    context.fill();
    context.strokeStyle = "#d0d8d1";
    context.stroke();
    context.fillStyle = "#657169";
    context.font = "700 13px 'IBM Plex Mono', monospace";
    context.fillText(leg.label, x + 22, cardY + 31);
    context.fillStyle = "#101713";
    context.font = "800 27px 'Instrument Sans', sans-serif";
    context.fillText(truncateCanvasText(context, leg.symbol, 150), x + 22, cardY + 68);
    context.fillStyle = "#667169";
    context.font = "600 14px 'Instrument Sans', sans-serif";
    context.fillText(truncateCanvasText(context, leg.name, 220), x + 22, cardY + 94);
    context.textAlign = "right";
    context.fillStyle = "#101713";
    context.font = "800 28px 'Instrument Sans', sans-serif";
    context.fillText(`${leg.value} USDG`, x + cardWidth - 22, cardY + 69);
    context.fillStyle = Number(leg.change) >= 0 ? "#147546" : "#a34838";
    context.font = "700 16px 'IBM Plex Mono', monospace";
    context.fillText(signedPercent(leg.change), x + cardWidth - 22, cardY + 101);
    context.textAlign = "left";
  }

  context.fillStyle = "#6d756f";
  context.font = "700 13px 'IBM Plex Mono', monospace";
  context.fillText("SCENARIO GAP", 94, 448);
  context.fillStyle = "#101713";
  context.font = "850 38px 'Instrument Sans', sans-serif";
  context.fillText(`${receipt.gap.absoluteUsdg} USDG`, 94, 489);
  context.fillStyle = "#657169";
  context.font = "600 16px 'Instrument Sans', sans-serif";
  wrapCanvasText(context, receipt.headline, 330, 448, 776, 24, 2);

  context.setLineDash([8, 9]);
  context.strokeStyle = "#bcc5bd";
  context.beginPath();
  context.moveTo(94, 526);
  context.lineTo(1_106, 526);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = "#8b3e32";
  context.font = "800 14px 'IBM Plex Mono', monospace";
  context.fillText("SCENARIO ONLY · NOT A TRANSACTION RECEIPT", 94, 558);
  context.fillStyle = "#68736c";
  context.font = "600 13px 'Instrument Sans', sans-serif";
  context.fillText("No wallet activity inspected · 1 USDG = 1 USD · Excludes fees, slippage, taxes and execution feasibility", 94, 584);

  context.fillStyle = "#8e9b93";
  context.font = "600 14px 'IBM Plex Mono', monospace";
  context.fillText("hoodflow.app/?view=agents", 60, 648);
  context.textAlign = "right";
  context.fillText(`WINDOW ${receipt.windowHours.toFixed(2)}H`, 1_140, 648);
  context.textAlign = "left";
}

async function createReceiptPng(receipt: RagretReceipt) {
  if (document.fonts?.ready) await document.fonts.ready;
  const logo = document.createElement("img");
  logo.src = "/ragret-logo.png";
  try {
    await logo.decode();
  } catch {
    // The receipt remains shareable with its text lockup if the logo cannot load.
  }
  const canvas = document.createElement("canvas");
  drawScenarioCard(canvas, receipt, logo.complete && logo.naturalWidth > 0 ? logo : undefined);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 0.95));
  if (!blob) throw new Error("The receipt PNG could not be created.");
  return blob;
}

function isRagretReceipt(value: unknown): value is RagretReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Partial<RagretReceipt>;
  return receipt.status === "scenario-receipt"
    && receipt.scenario === true
    && receipt.transactionProof === false
    && typeof receipt.receiptId === "string"
    && typeof receipt.shareText === "string"
    && Boolean(receipt.stock?.ticker)
    && Boolean(receipt.community?.address)
    && Boolean(receipt.gap?.absoluteUsdg);
}

export default function RagretReceipt({
  stockMarkets,
  onOpenStockMarket,
  onOpenCommunityMarket,
}: RagretReceiptProps) {
  const initialStock = stockMarkets.find((market) => market.ticker === "NVDA")?.ticker ?? stockMarkets[0]?.ticker ?? "";
  const [stock, setStock] = useState(initialStock);
  const activeStock = stockMarkets.some((market) => market.ticker === stock)
    ? stock
    : stockMarkets.find((market) => market.ticker === "NVDA")?.ticker ?? stockMarkets[0]?.ticker ?? "";
  const [communityQuery, setCommunityQuery] = useState(DEFAULT_RAGRET_COMMUNITY_ADDRESS);
  const [communityResults, setCommunityResults] = useState<CommunityMarket[]>([]);
  const [selectedCommunity, setSelectedCommunity] = useState<CommunityMarket | null>(null);
  const [communityBusy, setCommunityBusy] = useState(false);
  const [communityError, setCommunityError] = useState("");
  const [communitySearchOpen, setCommunitySearchOpen] = useState(false);
  const [notionalUsdg, setNotionalUsdg] = useState("100");
  const [receipt, setReceipt] = useState<RagretReceipt | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptError, setReceiptError] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const remixHydrated = useRef(false);
  const receiptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (remixHydrated.current || typeof window === "undefined" || stockMarkets.length === 0) return;
    remixHydrated.current = true;
    const params = new URL(window.location.href).searchParams;
    const requestedStock = params.get(REMIX_STOCK_PARAM)?.toUpperCase();
    const requestedToken = params.get(REMIX_TOKEN_PARAM)?.toLowerCase();
    const requestedAmount = params.get(REMIX_AMOUNT_PARAM);
    const timeout = window.setTimeout(() => {
      if (requestedStock && stockMarkets.some((market) => market.ticker === requestedStock)) setStock(requestedStock);
      if (requestedToken && EVM_ADDRESS.test(requestedToken)) setCommunityQuery(requestedToken);
      if (requestedAmount && /^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(requestedAmount) && Number(requestedAmount) > 0) {
        setNotionalUsdg(requestedAmount);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [stockMarkets]);

  useEffect(() => {
    const query = communityQuery.trim();
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      if (query.length < 2) {
        setCommunityBusy(false);
        setCommunityResults([]);
        setSelectedCommunity(null);
        setCommunityError("");
        return;
      }
      setCommunityBusy(true);
      setCommunityError("");
      try {
        const lookupParam = EVM_ADDRESS.test(query) ? "token" : "search";
        const response = await fetch(`/api/community-markets?${lookupParam}=${encodeURIComponent(query)}`, {
          headers: { accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json() as { markets?: CommunityMarket[]; error?: string };
        if (!response.ok || !Array.isArray(payload.markets)) throw new Error(payload.error || "Community-token search is temporarily unavailable.");
        const unique = payload.markets
          .filter((market, index, rows) => EVM_ADDRESS.test(market.address) && rows.findIndex((candidate) => candidate.address.toLowerCase() === market.address.toLowerCase()) === index)
          .slice(0, 8);
        setCommunityResults(unique);
        if (EVM_ADDRESS.test(query)) {
          const exact = unique.find((market) => market.address.toLowerCase() === query.toLowerCase()) ?? null;
          setSelectedCommunity(exact);
          if (!exact) setCommunityError("No exact Robinhood Chain community token matched that contract address.");
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setCommunityResults([]);
          setSelectedCommunity(null);
          setCommunityError(error instanceof Error ? error.message : "Community-token search is temporarily unavailable.");
        }
      } finally {
        if (!controller.signal.aborted) setCommunityBusy(false);
      }
    }, query.length < 2 ? 0 : 300);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [communityQuery]);

  function invalidateReceipt() {
    setReceipt(null);
    setReceiptError("");
    setShareStatus("");
  }

  function chooseCommunity(market: CommunityMarket) {
    setSelectedCommunity(market);
    setCommunityQuery(market.address.toLowerCase());
    setCommunitySearchOpen(false);
    invalidateReceipt();
  }

  async function createScenario(event: FormEvent) {
    event.preventDefault();
    if (!selectedCommunity || !activeStock) return;
    setReceiptBusy(true);
    setReceiptError("");
    setShareStatus("");
    try {
      const response = await fetch("/api/agents/ragret", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ stock: activeStock, communityAddress: selectedCommunity.address, notionalUsdg }),
      });
      const payload = await response.json() as RagretReceipt | RagretErrorPayload;
      if (!response.ok) throw new Error("error" in payload && payload.error ? payload.error : "The 24-hour scenario could not be prepared.");
      if (!isRagretReceipt(payload)) throw new Error("The scenario service returned an incomplete receipt.");
      setReceipt(payload);
      track("ragret_created", { ticker: payload.stock.ticker });
      window.requestAnimationFrame(() => receiptRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    } catch (error) {
      setReceipt(null);
      setReceiptError(error instanceof Error ? error.message : "The 24-hour scenario could not be prepared.");
    } finally {
      setReceiptBusy(false);
    }
  }

  async function shareReceipt() {
    if (!receipt) return;
    setShareStatus("Preparing the 1200×675 PNG…");
    try {
      const blob = await createReceiptPng(receipt);
      const file = new File([blob], `${receipt.receiptId}.png`, { type: "image/png" });
      const remixUrl = buildRemixUrl(receipt);
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "HoodFlow RAGRET Receipt", text: receipt.shareText, url: remixUrl });
        track("ragret_shared", { ticker: receipt.stock.ticker, format: "png" });
        setShareStatus("Receipt shared.");
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: "HoodFlow RAGRET Receipt", text: receipt.shareText, url: remixUrl });
        track("ragret_shared", { ticker: receipt.stock.ticker, format: "link" });
        setShareStatus("Scenario shared; this browser cannot attach the PNG.");
        return;
      }
      await navigator.clipboard.writeText(`${receipt.shareText}\n${remixUrl}`);
      track("ragret_shared", { ticker: receipt.stock.ticker, format: "clipboard" });
      setShareStatus("Share text and remix link copied.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setShareStatus("");
        return;
      }
      setShareStatus(error instanceof Error ? error.message : "The receipt could not be shared.");
    }
  }

  async function copyReceiptPng() {
    if (!receipt) return;
    setShareStatus("Copying the 1200×675 PNG…");
    try {
      const blob = await createReceiptPng(receipt);
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        track("ragret_shared", { ticker: receipt.stock.ticker, format: "copy-png" });
        setShareStatus("Receipt PNG copied.");
        return;
      }
      await navigator.clipboard.writeText(`${receipt.shareText}\n${buildRemixUrl(receipt)}`);
      track("ragret_shared", { ticker: receipt.stock.ticker, format: "copy-link" });
      setShareStatus("Image copy is unavailable; share text and remix link copied instead.");
    } catch (error) {
      setShareStatus(error instanceof Error ? error.message : "The receipt could not be copied.");
    }
  }

  async function downloadReceiptPng() {
    if (!receipt) return;
    setShareStatus("Rendering the 1200×675 PNG…");
    try {
      const blob = await createReceiptPng(receipt);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${receipt.receiptId}.png`;
      link.click();
      track("ragret_shared", { ticker: receipt.stock.ticker, format: "download" });
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setShareStatus("Receipt PNG downloaded.");
    } catch (error) {
      setShareStatus(error instanceof Error ? error.message : "The receipt could not be downloaded.");
    }
  }

  return (
    <section className="ragret-shell" id="agent-ragret" aria-labelledby="ragret-title">
      <header className="ragret-heading">
        <div className="ragret-heading-copy">
          <p className="ragret-eyebrow">RAGRET // UP TO 24H</p>
          <h2 id="ragret-title">Put the same USDG<br />down two roads.</h2>
          <p>Compare one Stock Token with one exact Robinhood Chain community-token contract over source-backed windows of up to 24 hours.</p>
        </div>
        <div className="ragret-heading-badge">
          <Image src="/ragret-logo.png" alt="RAGRET agent logo" width={58} height={58} priority />
          <div><span>WALLETLESS</span><strong>Deterministic receipt</strong><a href="https://app.virtuals.io/virtuals/119134" target="_blank" rel="noreferrer">Live on Virtuals ↗</a></div>
        </div>
      </header>

      <div className="ragret-permanent-disclaimer" role="note">
        <strong>SCENARIO ONLY · NOT A TRANSACTION RECEIPT</strong>
        <span>No wallet activity is inspected. A newer community token may use its since-launch window. Values assume 1 USDG = 1 USD and exclude fees, slippage, taxes and execution feasibility.</span>
      </div>

      <div className="ragret-workbench">
        <form className="ragret-form" onSubmit={createScenario} aria-busy={receiptBusy}>
          <div className="ragret-form-head"><span>BUILD_RAGRET_RECEIPT</span><b>UP TO 24H</b></div>

          <label className="ragret-field">
            <span>STOCK TOKEN</span>
            <select value={activeStock} onChange={(event) => { setStock(event.target.value); invalidateReceipt(); }} disabled={!stockMarkets.length}>
              {stockMarkets.map((market) => <option key={market.ticker} value={market.ticker}>{market.ticker} · {market.name}{market.route ? ` · ${market.route}` : ""}</option>)}
            </select>
          </label>

          <div className="ragret-community-picker">
            <label className="ragret-field">
              <span>COMMUNITY TOKEN · SYMBOL OR CONTRACT</span>
              <div className="ragret-search-control">
                <input
                  value={communityQuery}
                  onChange={(event) => {
                    setCommunityQuery(event.target.value);
                    setSelectedCommunity(null);
                    setCommunitySearchOpen(true);
                    invalidateReceipt();
                  }}
                  onFocus={() => setCommunitySearchOpen(true)}
                  onBlur={() => window.setTimeout(() => setCommunitySearchOpen(false), 120)}
                  placeholder="RAGRET or 0x…"
                  autoComplete="off"
                  spellCheck={false}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={communitySearchOpen && communityResults.length > 0}
                  aria-controls="ragret-community-results"
                />
                <b>{communityBusy ? "SEARCHING" : selectedCommunity ? "EXACT" : "FIND"}</b>
              </div>
            </label>
            {communitySearchOpen && communityResults.length > 0 && <div className="ragret-search-results" id="ragret-community-results" role="listbox">
              {communityResults.map((market) => <button
                key={market.address}
                type="button"
                role="option"
                aria-selected={selectedCommunity?.address === market.address}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseCommunity(market)}
              >
                <span><strong>{market.symbol}</strong><small>{market.name}</small></span>
                <span><b>{formatPercent(market.priceChange24h)}</b><small>{formatMoney(market.liquidityUsd)} liq.</small></span>
                <code>{compactAddress(market.address)}</code>
              </button>)}
            </div>}
            {communityError && <p className="ragret-search-error" role="alert">{communityError}</p>}
            {selectedCommunity && <div className="ragret-selected-community">
              <span><strong>{selectedCommunity.symbol}</strong><small>{selectedCommunity.name}</small></span>
              <span><b>{compactAddress(selectedCommunity.address)}</b><small>{selectedCommunity.dex} · {selectedCommunity.lifecycle}</small></span>
              <span><b>{formatPercent(selectedCommunity.priceChange24h)}</b><small>{formatMoney(selectedCommunity.liquidityUsd)} liquidity</small></span>
            </div>}
          </div>

          <label className="ragret-field">
            <span>SAME STARTING NOTIONAL</span>
            <div className="ragret-amount-control">
              <input
                type="number"
                min="0.01"
                max="999999.99"
                step="0.01"
                inputMode="decimal"
                value={notionalUsdg}
                onChange={(event) => { setNotionalUsdg(event.target.value); invalidateReceipt(); }}
                required
              />
              <b>USDG</b>
            </div>
          </label>

          {receiptError && <div className="ragret-request-error" role="alert"><strong>Scenario stopped.</strong><span>{receiptError}</span></div>}
          <button className="ragret-submit" type="submit" disabled={receiptBusy || !activeStock || !selectedCommunity || !notionalUsdg}>
            {receiptBusy ? "Reading both 24h paths…" : "Print my RAGRET receipt"}<span>→</span>
          </button>
          <small className="ragret-form-note">Community symbols are resolved to one exact contract before calculation. No token is selected by ticker alone.</small>
        </form>

        <div className="ragret-output" ref={receiptRef} aria-live="polite">
          {!receipt ? <div className="ragret-output-empty">
            <div className="ragret-output-mark"><span>R</span><i /><i /></div>
            <strong>{receiptBusy ? "Printing a source-backed scenario…" : "Your receipt prints here"}</strong>
            <span>{receiptBusy ? "HoodFlow is comparing the Stock Token reference with the selected contract's reported 24h move." : "Select two exact assets and give both the same hypothetical USDG start."}</span>
          </div> : <article className={`ragret-receipt ragret-receipt--${receipt.verdict.toLowerCase()}`}>
            <header className="ragret-receipt-head">
              <div><span>HOODFLOW / RAGRET</span><strong>{receipt.receiptId}</strong></div>
              <b>{receiptVerdictLabel(receipt.verdict)}</b>
            </header>
            <div className="ragret-receipt-notional"><span>SAME START</span><strong>{receipt.notionalUsdg} USDG</strong><small>{receipt.windowHours.toFixed(2)}h observed window</small></div>
            <div className="ragret-receipt-legs">
              <section>
                <span>STOCK TOKEN</span>
                <h3>{receipt.stock.ticker}</h3>
                <p>{receipt.stock.name}</p>
                <strong>{receipt.stock.scenarioValueUsdg} USDG</strong>
                <b className={Number(receipt.stock.returnPct) >= 0 ? "ragret-positive" : "ragret-negative"}>{signedPercent(receipt.stock.returnPct)}</b>
              </section>
              <section>
                <span>COMMUNITY TOKEN</span>
                <h3>{receipt.community.symbol}</h3>
                <p>{receipt.community.name} · {compactAddress(receipt.community.address)}</p>
                <strong>{receipt.community.scenarioValueUsdg} USDG</strong>
                <b className={Number(receipt.community.returnPct) >= 0 ? "ragret-positive" : "ragret-negative"}>{signedPercent(receipt.community.returnPct)}</b>
              </section>
            </div>
            <div className="ragret-gap">
              <span>SCENARIO GAP</span><strong>{receipt.gap.absoluteUsdg} USDG</strong><b>{signedPercent(receipt.gap.returnPct)}</b>
              <p>{receipt.headline}</p>
            </div>
            <div className="ragret-receipt-proof">
              <div><span>STOCK WINDOW</span><strong>{new Date(receipt.stock.startedAt).toLocaleString()} → {new Date(receipt.stock.observedAt).toLocaleString()}</strong></div>
              <div><span>COMMUNITY CONTRACT</span><strong>{receipt.community.address}</strong></div>
              <div><span>GENERATED</span><strong>{new Date(receipt.generatedAt).toLocaleString()}</strong></div>
            </div>
            <footer className="ragret-receipt-disclaimer"><strong>SCENARIO ONLY · NOT A TRANSACTION RECEIPT</strong><span>No wallet activity inspected · Newer community tokens may use since-launch data · Fees, slippage, taxes and execution feasibility excluded.</span></footer>
          </article>}

          {receipt && <div className="ragret-actions">
            <div className="ragret-share-actions">
              <button type="button" onClick={() => void shareReceipt()}>Share PNG</button>
              <button type="button" onClick={() => void copyReceiptPng()}>Copy PNG</button>
              <button type="button" onClick={() => void downloadReceiptPng()}>Download PNG</button>
            </div>
            <div className="ragret-market-actions">
              <button type="button" onClick={() => { track("ragret_handoff_opened", { ticker: receipt.stock.ticker, destination: "stock" }); onOpenStockMarket(receipt.stock.ticker, { side: "buy", amount: receipt.notionalUsdg, slippageBps: 50 }); }}>Check {receipt.stock.ticker} route →</button>
              <button type="button" onClick={() => { track("ragret_handoff_opened", { ticker: receipt.community.symbol, destination: "community" }); onOpenCommunityMarket(receipt.community.address, { side: "buy", amount: receipt.notionalUsdg }); }}>Open {receipt.community.symbol} market →</button>
            </div>
            {shareStatus && <p className="ragret-share-status" role="status">{shareStatus}</p>}
          </div>}
        </div>
      </div>
    </section>
  );
}
