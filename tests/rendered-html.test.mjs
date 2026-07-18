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
  assert.match(html, /<title>HoodFlow — Safe stock automation on Robinhood Chain<\/title>/i);
  assert.match(html, /Stock automation,/);
  assert.match(html, /clearly explained\./);
  assert.match(html, /Build an automation/);
  assert.match(html, /Set it\. Cap it\./);
  assert.match(html, /HoodFlow workspace loading/);
  assert.match(html, /Preparing your/);
  assert.match(html, /safe workspace\./);
  assert.match(html, /Loading official assets/);
  assert.match(html, /Permission Center/);
  assert.match(html, /Strategy workspace/);
  assert.match(html, /25 official assets indexed/);
  assert.match(html, /13 full-fill routes/);
  assert.match(html, /24 Chainlink feeds/);
  assert.match(html, /V11 LIVE PRICING/);
  assert.match(html, /Three steps\. You stay in control\./);
  assert.match(html, /NO MAINNET ORDERS/);
  assert.match(html, /Robinhood Chain Testnet/);
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships a bounded, interactive testnet experience", async () => {
  const [page, layout, css, packageJson, priceRoute, priceLib] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/api/prices/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/robinhood-prices.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /"use client"/);
  assert.match(page, /createStrategy/);
  assert.match(page, /toggleStrategy/);
  assert.match(page, /copyStrategy/);
  assert.match(page, /exportActivity/);
  assert.match(page, /hoodflow-device-drafts-v1/);
  assert.match(page, /window\.localStorage\.setItem/);
  assert.match(page, /Wallet keys and account data are never stored/);
  assert.match(page, /wallet_switchEthereumChain/);
  assert.match(page, /Robinhood Chain Testnet/);
  assert.match(page, /Start in Shadow Mode/);
  assert.match(page, /PERMISSION CENTER/);
  assert.match(page, /Pause everything/);
  assert.match(page, /EXECUTION PREVIEW/);
  assert.match(page, /Spending limits stay enforced onchain/);
  assert.match(page, /25\/25 engine, oracle and adapter safety tests passing/);
  assert.match(page, /Best quote across 3 reviewed V4 pool configurations/);
  assert.match(page, /2\/2 capped executions, replay blocked/);
  assert.match(page, /Twenty-five assets/);
  assert.match(page, /13 full-fill routes/);
  assert.match(page, /Full-fill ready/);
  assert.match(page, /MSFT stays blocked after a deterministic-fork partial fill/);
  assert.match(page, /Copy as draft/);
  assert.match(page, /Know every status/);
  assert.match(page, /Independent audit/);
  assert.match(page, /Production RPC \+ oracle map/);
  assert.match(page, /7 of 11 complete/);
  assert.match(page, /\/api\/prices/);
  assert.match(page, /PUBLIC_ROBINHOOD_PRICE_RPC_URL/);
  assert.match(page, /parseRobinhoodPriceResults/);
  assert.match(page, /Onchain token price/);
  assert.match(page, /LIVE TOKEN PRICES/);
  assert.match(page, /Stale — blocked/);
  assert.match(page, /CHAINLINK \/ ROBINHOOD MAINNET/);
  assert.doesNotMatch(page, /price:\s*211\.18/);
  assert.match(page, /MAINNET LOCKED/);
  assert.match(page, /version-badge">V11/);
  assert.match(layout, /HoodFlow — Safe stock automation/);
  assert.match(layout, /Instrument_Sans/);
  assert.match(layout, /IBM_Plex_Mono/);
  assert.match(layout, /summary_large_image/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\.launch-screen/);
  assert.match(css, /launch-fallback/);
  assert.match(css, /\.price-source-bar/);
  assert.match(css, /\.price-cell\.stale/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(priceLib, /0xfeaf968c/);
  assert.match(priceLib, /0x7706ba52/);
  assert.match(priceLib, /pauseResult === false/);
  assert.match(priceRoute, /stale-while-revalidate/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await access(new URL("../public/og.png", import.meta.url));
  await Promise.all([
    "AAPL", "AMD", "AMZN", "BABA", "BE", "COIN", "CRCL", "CRWV", "GOOGL", "INTC",
    "META", "MSFT", "MU", "NVDA", "ORCL", "PLTR", "SNDK", "SPCX", "TSLA", "USAR",
    "QQQ", "SGOV", "SLV", "SPY", "CUSO",
  ].map((ticker) => access(new URL(`../public/logos/${ticker}.png`, import.meta.url))));
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
