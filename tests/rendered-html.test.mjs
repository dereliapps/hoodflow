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
  assert.match(html, /<title>HoodFlow \| Crypto &amp; Stock Token Markets on Robinhood Chain<\/title>/i);
  assert.match(html, /Every live token\. One execution screen\./);
  assert.match(html, /Compare live routes/);
  assert.match(html, /Find the route/);
  assert.match(html, /Hold to draw\. Release to enter\./);
  assert.match(html, /Hold anywhere · Space [/] Enter/);
  assert.match(html, /Skip/);
  assert.match(html, /Direct settlement/);
  assert.match(html, /Reviewed execution markets/);
  assert.match(html, /Protected minimum/);
  assert.match(html, /ROBINHOOD CHAIN [/] MAINNET/);
  assert.match(html, /THE EXECUTION LAYER FOR STOCK TOKENS/);
  assert.match(html, /A swap quote is easy/);
  assert.match(html, /An executable route is harder/);
  assert.match(html, /Independent interface built on Robinhood Chain/);
  assert.match(html, /Not affiliated with or endorsed by Robinhood Markets, Inc/);
  assert.match(html, /Stock Tokens are not shares/);
  assert.match(html, /Compare live routes/);
  assert.match(html, /Robinhood Chain/);
  assert.match(html, /og-crypto\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships a bounded, interactive Robinhood mainnet experience", async () => {
  const [page, intro, layout, css, packageJson, priceRoute, priceLib, historyRoute, stockHistory, docs, community, rewards, referralRoute, communityMarketRoute] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/robin-hood-intro.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/api/prices/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/robinhood-prices.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/history/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../generated/stock-price-history.json", import.meta.url), "utf8"),
    readFile(new URL("../app/docs/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/community-tokens.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/referral-rewards.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/referrals/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/community-markets/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /"use client"/);
  assert.match(page, /createStrategy/);
  assert.match(page, /toggleStrategy/);
  assert.match(page, /applyTemplate/);
  assert.match(page, /exportActivity/);
  assert.match(page, /hoodflow-mainnet-orders-v4/);
  assert.match(page, /orderStorageKey\(activeWallet\)/);
  assert.match(page, /walletAddress: address\.toLowerCase\(\)/);
  assert.match(page, /setStrategies\(\[\]\)/);
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
  assert.match(page, /15 reviewed Stock Token routes are execution-enabled/);
  assert.match(page, /Full-fill ready/);
  assert.match(page, /MSFT stays blocked after a deterministic-fork partial fill/);
  assert.match(page, /Use template/);
  assert.match(page, /Know every status/);
  assert.match(page, /Your wallet stays in control/);
  assert.match(page, /\/api\/prices/);
  assert.match(page, /PUBLIC_ROBINHOOD_PRICE_RPC_URL/);
  assert.match(page, /parseRobinhoodPriceResults/);
  assert.match(page, /Onchain token price/);
  assert.match(page, /ONCHAIN ORACLE REFERENCES/);
  assert.match(page, /every 10s/);
  assert.match(page, /Stale — blocked/);
  assert.match(page, /CHAINLINK ORACLE \/ ROBINHOOD MAINNET/);
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
  assert.match(page, /Compare live routes/);
  assert.match(intro, /RobinHoodIntro/);
  assert.match(intro, /hoodflow-robinhood-intro-v2/);
  assert.match(intro, /sessionStorage\.setItem/);
  assert.match(intro, /new URLSearchParams\(window\.location\.search\)\.get\("intro"\) === "1"/);
  assert.match(intro, /Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/);
  assert.match(intro, /prefers-reduced-motion: reduce/);
  assert.match(intro, /onPointerDown/);
  assert.match(intro, /onKeyDown/);
  assert.match(intro, /setStep\("open"\)/);
  assert.match(page, /Automatic retries are active/);
  assert.match(page, /Release 0\.10\.2/);
  assert.match(page, /DCA command center/);
  assert.match(page, /TRACKED TRADE VOLUME/);
  assert.match(page, /price-skeleton/);
  assert.match(page, /MY PORTFOLIO/);
  assert.match(page, /AssetRequestBoard/);
  assert.match(page, /HOODFLOW FEE/);
  assert.match(page, /MarketStatus/);
  assert.match(page, /label: "Crypto"/);
  assert.match(page, /ReferralRewards/);
  assert.match(page, /href="\/docs"/);
  assert.match(docs, /Buy a Stock Token with USDG/);
  assert.match(docs, /Sell a Stock Token back to USDG/);
  assert.match(docs, /Reference price versus execution quote/);
  assert.match(docs, /Common messages/);
  assert.match(docs, /Discover tokens by contract address/);
  assert.match(community, /Every live token/);
  assert.match(community, /metric-price/);
  assert.match(community, /metric-volume/);
  assert.match(community, /metric-liquidity/);
  assert.match(community, /metric-cap/);
  assert.match(community, /Most traded/);
  assert.match(community, /Deep liquidity/);
  assert.match(community, /MARKET_SORT_OPTIONS/);
  assert.match(community, /market-discovery-card/);
  assert.match(community, /Explore crypto/);
  assert.match(community, /V3_FEES = \[100, 500, 3_000, 10_000\]/);
  assert.match(community, /buildV2ExactInputCalldata/);
  assert.match(community, /settlement-trigger/);
  assert.match(community, /marketSettlement\.address/);
  assert.match(community, /Native pair routing/);
  assert.match(community, /USDG, WETH or the listed pool/);
  assert.match(community, /UNREVIEWED TOKEN MODE/);
  assert.match(community, /ONCHAIN PRICE HISTORY/);
  assert.match(community, /marketCapUsd \?\? market\.fdvUsd/);
  assert.match(rewards, /HOODFLOW REWARDS \/ SEASON 0/);
  assert.match(rewards, /PLANNED \$HFLOW ELIGIBILITY/);
  assert.match(rewards, /SEASON 0 · COMING SOON/);
  assert.match(rewards, /Rankings open later/);
  assert.match(rewards, /Create my referral link/);
  assert.match(referralRoute, /verifyMessage/);
  assert.match(referralRoute, /SEASON_REFERRAL_CAP/);
  assert.match(referralRoute, /leaderboardPayload/);
  assert.match(communityMarketRoute, /trending_pools/);
  assert.match(communityMarketRoute, /new_pools/);
  assert.match(communityMarketRoute, /GeckoTerminal/);
  assert.match(communityMarketRoute, /DEX Screener/);
  assert.match(communityMarketRoute, /Virtuals official/);
  assert.match(communityMarketRoute, /virtuals-bonding/);
  assert.match(css, /Authoritative responsive layout for the crypto workspace/);
  assert.match(css, /@media \(max-width: 1100px\)/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(communityMarketRoute, /token-pairs\/v1\/robinhood/);
  assert.match(layout, /HoodFlow \| Crypto & Stock Token Markets/);
  assert.match(layout, /Instrument_Sans/);
  assert.match(layout, /IBM_Plex_Mono/);
  assert.match(layout, /summary_large_image/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\.rh-intro/);
  assert.match(css, /\.rh-intro-door-left/);
  assert.match(css, /\.rh-intro-arrow/);
  assert.match(css, /@keyframes rh-flight/);
  assert.doesNotMatch(css, /\.launch-screen|\.launch-slider-shell|\.launch-flight-arrow/);
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
  assert.match(priceRoute, /max-age=3, s-maxage=3/);
  assert.match(priceRoute, /PRICE_BATCH_SIZE = 8/);
  assert.match(priceRoute, /MAX_RPC_ATTEMPTS = 3/);
  assert.match(priceRoute, /for \(const batch of chunkRequests/);
  assert.match(priceRoute, /Price RPC returned no usable batches/);
  assert.match(page, /candidate\.liveCount >= 15/);
  assert.match(page, /setEngineFeeBps\(Number\(protocolFeeBps\)\)/);
  assert.match(historyRoute, /0x9a6fc8f5/);
  assert.match(historyRoute, /ROUND_COUNT = 32/);
  assert.match(historyRoute, /HISTORY_CACHE_TTL_MS/);
  assert.match(historyRoute, /Promise\.any/);
  assert.match(historyRoute, /History RPC returned fewer than two rounds/);
  assert.match(historyRoute, /stockHistorySnapshot/);
  assert.match(historyRoute, /"snapshot"/);
  const parsedStockHistory = JSON.parse(stockHistory);
  assert.ok(Object.keys(parsedStockHistory.assets).length >= 20);
  assert.equal(parsedStockHistory.assets.AAPL.points.length, 32);
  assert.match(page, /priceHistoryCacheRef/);
  assert.match(page, /cache: "default"/);
  assert.match(historyRoute, /decodeLatestRoundData/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await access(new URL("../public/og.png", import.meta.url));
  await access(new URL("../public/assets/hoodflow-sherwood.webp", import.meta.url));
  await Promise.all([
    "AAPL", "AMD", "AMZN", "BABA", "BE", "COIN", "CRCL", "CRWV", "GOOGL", "INTC",
    "META", "MSFT", "MU", "NVDA", "ORCL", "PLTR", "SNDK", "SPCX", "TSLA", "USAR",
    "QQQ", "SGOV", "SLV", "SPY", "CUSO",
  ].map((ticker) => access(new URL(`../public/logos/${ticker}.png`, import.meta.url))));
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
