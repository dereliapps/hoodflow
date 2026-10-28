import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/seo";

/**
 * AI search, assistant and training crawlers are named explicitly so the intent is
 * unambiguous: HoodFlow wants to be readable and citable by answer engines.
 * A crawler that matches a named group ignores the `*` group, so every group
 * repeats the same API restrictions.
 */
const AI_CRAWLERS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "PerplexityBot",
  "Perplexity-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "Google-Extended",
  "Applebot-Extended",
  "Amazonbot",
  "DuckAssistBot",
];

// Public, read-only agent discovery documents stay crawlable; everything else under /api/ does not.
const allow = ["/", "/api/agents/hoodflow", "/api/agents/markets"];
const disallow = ["/api/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow, disallow },
      { userAgent: AI_CRAWLERS, allow, disallow },
    ],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
