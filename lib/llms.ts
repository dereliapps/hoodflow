import { learnArticles } from "@/lib/learn";
import { absoluteUrl, GITHUB_URL, SITE_ORIGIN, X_URL } from "@/lib/seo";
import { getAssetFaq, seoAssets } from "@/lib/seo-assets";
import { ROBINHOOD_TOKENS } from "@/lib/hoodflow-mainnet";

const SUMMARY =
  "HoodFlow is an independent, self-custody execution interface for Stock Tokens and other markets on Robinhood Chain. " +
  "It discovers canonical markets, compares reviewed Uniswap routes, shows a fresh executable quote with a protected minimum output, " +
  "and leaves the final signature in the user's own wallet. HoodFlow does not custody funds. It is in Mainnet Beta.";

const DISCLAIMER =
  "Stock Tokens are not shares, provide no shareholder rights and may be restricted in your jurisdiction. " +
  "HoodFlow content is educational product documentation, not investment, legal or tax advice.";

export function buildLlmsTxt() {
  const executionReady = seoAssets.filter((asset) => asset.fullFill).length;
  const lines: string[] = [
    "# HoodFlow",
    "",
    `> ${SUMMARY}`,
    "",
    DISCLAIMER,
    "",
    "## Key facts",
    "",
    "- Network: Robinhood Chain (chain ID 4663). Settlement asset for Stock Token buys: USDG.",
    `- Indexed canonical markets: ${seoAssets.length} Stock Tokens and tokenized ETFs, of which ${executionReady} currently have a reviewed, full-fill-verified route. The rest are watch-only.`,
    "- Execution model: fresh DEX quote before every order, protected minimum output from the chosen slippage, exact-amount short-lived Permit2 permission, settlement straight to the user's wallet.",
    "- Protection tools: ActionLock (event-risk inspection), DepthMap (five-point liquidity preflight at 10, 25, 100, 250 and 1,000 USDG), BellLock (market-reopening watcher with no wallet authority), Payday Radar (corporate-action evidence checks).",
    "- Agent interfaces: public REST, OpenAPI and a stateless MCP server. Agents receive preflights and handoffs only; HoodFlow never signs or submits a transaction for the user.",
    "",
    "## Core pages",
    "",
    `- [Home](${absoluteUrl("/")}): Product overview and the live market workspace.`,
    `- [Stock Tokens directory](${absoluteUrl("/stock-tokens")}): Every indexed Stock Token and tokenized ETF with execution status.`,
    `- [How it works](${absoluteUrl("/how-it-works")}): Route review, protected minimum output and Permit2 permissions explained.`,
    `- [Documentation](${absoluteUrl("/docs")}): Step-by-step guides for buying, selling, DepthMap, ActionLock, BellLock, FillProof and the agent API.`,
    `- [Security](${absoluteUrl("/security")}): Contract and router addresses, permission model, audit status and known limitations.`,
    `- [Roadmap](${absoluteUrl("/roadmap")}): What has shipped and the gates required to leave Mainnet Beta.`,
    "",
    "## Guides",
    "",
    ...learnArticles.map((article) => `- [${article.title}](${absoluteUrl(`/learn/${article.slug}`)}): ${article.excerpt}`),
    "",
    "## Markets",
    "",
    ...seoAssets.map(
      (asset) =>
        `- [${asset.name} (${asset.ticker})](${absoluteUrl(`/stock-tokens/${asset.ticker.toLowerCase()}`)}): ${asset.type}, ${asset.fullFill ? "full-fill ready" : "watch-only"}.`,
    ),
    "",
    "## For agents and developers",
    "",
    `- [OpenAPI 3.1 contract](${absoluteUrl("/openapi.json")}): Machine-readable REST description.`,
    `- [API catalog](${absoluteUrl("/.well-known/api-catalog")}): RFC 9727 linkset of public interfaces.`,
    `- [Agent manifest](${absoluteUrl("/api/agents/hoodflow")}): Capabilities and input schema.`,
    `- [Reviewed markets](${absoluteUrl("/api/agents/markets")}): Currently route-reviewed USDG markets and execution policy.`,
    `- [MCP endpoint](${absoluteUrl("/mcp")}): Streamable HTTP MCP server for market discovery, quote preflight and basket planning.`,
    `- [Source code](${GITHUB_URL}): Public repository.`,
    "",
    "## Optional",
    "",
    `- [Full text for language models](${absoluteUrl("/llms-full.txt")}): Guides and per-market answers in one file.`,
    `- [Sitemap](${absoluteUrl("/sitemap.xml")})`,
    `- [HoodFlow on X](${X_URL})`,
    "",
  ];
  return lines.join("\n");
}

export function buildLlmsFullTxt() {
  const out: string[] = [
    "# HoodFlow: full reference",
    "",
    `> ${SUMMARY}`,
    "",
    DISCLAIMER,
    "",
    `Canonical site: ${SITE_ORIGIN}`,
    "",
    "# Guides",
    "",
  ];

  for (const article of learnArticles) {
    out.push(`## ${article.title}`, "", `Source: ${absoluteUrl(`/learn/${article.slug}`)}`, "", article.excerpt, "");
    for (const [heading, copy] of article.sections) out.push(`### ${heading}`, "", copy, "");
  }

  out.push("# Markets", "", "Each entry lists the canonical token contract on Robinhood Chain (chain ID 4663) and HoodFlow's execution status.", "");
  for (const asset of seoAssets) {
    out.push(
      `## ${asset.name} (${asset.ticker}), ${asset.type}`,
      "",
      `Source: ${absoluteUrl(`/stock-tokens/${asset.ticker.toLowerCase()}`)}`,
      `Contract: ${ROBINHOOD_TOKENS[asset.ticker]}`,
      `Execution status: ${asset.fullFill ? "full-fill ready" : "watch-only"}`,
      "",
    );
    for (const item of getAssetFaq(asset)) out.push(`**${item.question}**`, "", item.answer, "");
  }

  return out.join("\n");
}
