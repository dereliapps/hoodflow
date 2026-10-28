import type { MetadataRoute } from "next";
import { learnArticles } from "@/lib/learn";
import { absoluteUrl, PAGE_LAST_MODIFIED } from "@/lib/seo";
import { seoAssets } from "@/lib/seo-assets";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: absoluteUrl("/"), lastModified: day(PAGE_LAST_MODIFIED.home), changeFrequency: "daily", priority: 1 },
    { url: absoluteUrl("/stock-tokens"), lastModified: day(PAGE_LAST_MODIFIED.stockTokensIndex), changeFrequency: "daily", priority: 0.9 },
    { url: absoluteUrl("/docs"), lastModified: day(PAGE_LAST_MODIFIED.docs), changeFrequency: "weekly", priority: 0.85 },
    { url: absoluteUrl("/how-it-works"), lastModified: day(PAGE_LAST_MODIFIED.howItWorks), changeFrequency: "monthly", priority: 0.7 },
    { url: absoluteUrl("/security"), lastModified: day(PAGE_LAST_MODIFIED.security), changeFrequency: "weekly", priority: 0.8 },
    { url: absoluteUrl("/learn"), lastModified: day(PAGE_LAST_MODIFIED.learnIndex), changeFrequency: "weekly", priority: 0.85 },
    { url: absoluteUrl("/roadmap"), lastModified: day(PAGE_LAST_MODIFIED.roadmap), changeFrequency: "weekly", priority: 0.75 },
    ...learnArticles.map((article) => ({
      url: absoluteUrl(`/learn/${article.slug}`),
      lastModified: day(PAGE_LAST_MODIFIED.learnArticle),
      changeFrequency: "monthly" as const,
      priority: 0.75,
    })),
    ...seoAssets.map((asset) => ({
      url: absoluteUrl(`/stock-tokens/${asset.ticker.toLowerCase()}`),
      lastModified: day(PAGE_LAST_MODIFIED.stockTokenDetail),
      changeFrequency: "daily" as const,
      priority: asset.fullFill ? 0.85 : 0.65,
    })),
  ];
}
