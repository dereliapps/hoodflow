import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the HoodFlow product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>HoodFlow — Buy Stock Tokens from your wallet<\/title>/i);
  assert.match(html, /Self-custody Stock Token trading/);
  assert.match(html, /Explore Stock Tokens/);
  assert.match(html, /Buy Stock Tokens/);
  assert.match(html, /HoodFlow workspace loading/);
  assert.match(html, /Preparing your/);
  assert.match(html, /safe workspace\./);
  assert.match(html, /Loading token registry/);
  assert.match(html, /Sell to USDG/);
  assert.match(html, /Your orders/);
  assert.match(html, /Desktop, QR and mobile wallets/);
  assert.match(html, /Direct Buy \+ Sell enabled only for verified routes/);
  assert.match(html, /ROBINHOOD CHAIN [/] MAINNET/);
  assert.match(html, /SELF-CUSTODY ROUTING/);
  assert.match(html, /Three steps\. You stay in control\./);
  assert.match(html, /Direct Stock Token Buy and Sell is live/);
  assert.match(html, /Independent interface built on Robinhood Chain/);
  assert.match(html, /Not affiliated with or endorsed by Robinhood Markets, Inc/);
  assert.match(html, /Stock Tokens are not shares/);
  assert.match(html, /Explore Stock Tokens/);
  assert.match(html, /Robinhood Chain/);
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships a bounded, interactive Robinhood mainnet experience", async () => {
  const [page, layout, css, packageJson, priceRoute, priceLib, historyRoute] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/api/prices/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/robinhood-prices.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/history/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /"use client"/);
  assert.match(page, /createStrategy/);
  assert.match(page, /toggleStrategy/);
  assert.match(page, /applyTemplate/);
  assert.match(page, /exportActivity/);
  assert.match(page, /hoodflow-mainnet-orders-v3/);
  assert.match(page, /window\.localStorage\.setItem/);
  assert.match(page, /Wallet keys and account data are never stored/);
  assert.match(page, /wallet_switchEthereumChain/);
  assert.match(page, /Robinhood Chain mainnet/);
  assert.doesNotMatch(page, /\bShadow\b/i);
  assert.match(page, /SECURITY & PERMISSIONS/);
  assert.match(page, /RECEIPTS SAVED ON THIS DEVICE/);
  assert.match(page, /ORDER REVIEW/);
  assert.match(page, /Spending limits stay enforced onchain/);
  assert.match(page, /Funds stay in your wallet/);
  assert.match(page, /15 verified routes/);
  assert.match(page, /Twenty-five assets/);
  assert.match(page, /All 15 full-fill V3\/V4 routes receive a fresh quote/);
  assert.match(page, /Full-fill ready/);
  assert.match(page, /MSFT stays blocked after a deterministic-fork partial fill/);
  assert.match(page, /Use template/);
  assert.match(page, /Know every status/);
  assert.match(page, /Your wallet stays in control/);
  assert.match(page, /\/api\/prices/);
  assert.match(page, /PUBLIC_ROBINHOOD_PRICE_RPC_URL/);
  assert.match(page, /parseRobinhoodPriceResults/);
  assert.match(page, /Onchain token price/);
  assert.match(page, /LIVE TOKEN PRICES/);
  assert.match(page, /Stale — blocked/);
  assert.match(page, /CHAINLINK \/ ROBINHOOD MAINNET/);
  assert.match(page, /The chart contains real Chainlink rounds/);
  assert.match(page, /openAsset/);
  assert.match(page, /\/api\/history\?ticker=/);
  assert.match(page, /TOKEN CONTRACT/);
  assert.doesNotMatch(page, /price:\s*211\.18/);
  assert.match(page, /MAINNET BETA/);
  assert.match(page, /version-badge">MAINNET BETA/);
  assert.match(page, /WalletConnect/);
  assert.match(page, /@walletconnect\/ethereum-provider/);
  assert.match(page, /PERMIT2_TYPES/);
  assert.match(page, /buildDirectBuyCalldata/);
  assert.match(page, /buildV4ExactInputCalldata/);
  assert.match(page, /buildV3ExactInputCalldata/);
  assert.match(page, /Sell now/);
  assert.match(page, /Sell to USDG/);
  assert.match(page, /Explore Stock Tokens/);
  assert.match(page, /PROTECTED QUOTES/);
  assert.match(page, /Price feed temporarily unavailable\. Trading is disabled until verification completes\./);
  assert.match(page, /Build 22/);
  assert.match(layout, /HoodFlow — Buy Stock Tokens/);
  assert.match(layout, /Instrument_Sans/);
  assert.match(layout, /IBM_Plex_Mono/);
  assert.match(layout, /summary_large_image/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\.launch-screen/);
  assert.match(css, /launch-fallback/);
  assert.match(css, /\.price-source-bar/);
  assert.match(css, /\.price-cell\.stale/);
  assert.match(css, /\.asset-detail-grid/);
  assert.match(css, /\.history-chart/);
  assert.doesNotMatch(css, /\.shadow-toggle|\.status-button\.shadow/i);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(priceLib, /0xfeaf968c/);
  assert.match(priceLib, /0x7706ba52/);
  assert.match(priceLib, /pauseResult === false/);
  assert.match(priceRoute, /stale-while-revalidate/);
  assert.match(historyRoute, /0x9a6fc8f5/);
  assert.match(historyRoute, /ROUND_COUNT = 32/);
  assert.match(historyRoute, /decodeLatestRoundData/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await access(new URL("../public/og.png", import.meta.url));
  await Promise.all([
    "AAPL", "AMD", "AMZN", "BABA", "BE", "COIN", "CRCL", "CRWV", "GOOGL", "INTC",
    "META", "MSFT", "MU", "NVDA", "ORCL", "PLTR", "SNDK", "SPCX", "TSLA", "USAR",
    "QQQ", "SGOV", "SLV", "SPY", "CUSO",
  ].map((ticker) => access(new URL(`../public/logos/${ticker}.png`, import.meta.url))));
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
