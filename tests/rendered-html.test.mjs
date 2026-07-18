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
  assert.match(html, /<title>HoodFlow — Portfolio automation on Robinhood Chain<\/title>/i);
  assert.match(html, /Your portfolio,/);
  assert.match(html, /on schedule\./);
  assert.match(html, /Build an automation/);
  assert.match(html, /Set it\. Cap it\./);
  assert.match(html, /Permission Center/);
  assert.match(html, /Strategy workspace/);
  assert.match(html, /Protocol core verified/);
  assert.match(html, /Robinhood Chain Testnet/);
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships a bounded, interactive testnet experience", async () => {
  const [page, layout, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /"use client"/);
  assert.match(page, /createStrategy/);
  assert.match(page, /toggleStrategy/);
  assert.match(page, /copyStrategy/);
  assert.match(page, /wallet_switchEthereumChain/);
  assert.match(page, /Robinhood Chain Testnet/);
  assert.match(page, /Start in Shadow Mode/);
  assert.match(page, /PERMISSION CENTER/);
  assert.match(page, /Pause everything/);
  assert.match(page, /EXECUTION PREVIEW/);
  assert.match(page, /Spending limits stay enforced onchain/);
  assert.match(page, /12\/12 safety scenarios passing/);
  assert.match(page, /Independent audit/);
  assert.match(page, /TESTNET ONLY/);
  assert.match(layout, /HoodFlow — Portfolio automation/);
  assert.match(layout, /Instrument_Sans/);
  assert.match(layout, /IBM_Plex_Mono/);
  assert.match(layout, /summary_large_image/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await access(new URL("../public/og.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
