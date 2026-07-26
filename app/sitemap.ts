import type { MetadataRoute } from "next";
import { seoAssets } from "@/lib/seo-assets";
import { learnArticles } from "@/lib/learn";

const releaseUpdated = new Date("2026-07-22T00:00:00.000Z");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://hoodflow.app/", lastModified: releaseUpdated, changeFrequency: "daily", priority: 1 },
    { url: "https://hoodflow.app/stock-tokens", lastModified: releaseUpdated, changeFrequency: "daily", priority: 0.9 },
    { url: "https://hoodflow.app/docs", lastModified: releaseUpdated, changeFrequency: "weekly", priority: 0.85 },
    { url: "https://hoodflow.app/how-it-works", lastModified: releaseUpdated, changeFrequency: "monthly", priority: 0.7 },
    { url: "https://hoodflow.app/security", lastModified: releaseUpdated, changeFrequency: "weekly", priority: 0.8 },
    { url: "https://hoodflow.app/learn", lastModified: releaseUpdated, changeFrequency: "weekly", priority: 0.85 },
    { url: "https://hoodflow.app/roadmap", lastModified: releaseUpdated, changeFrequency: "weekly", priority: 0.75 },
    ...learnArticles.map((article) => ({
      url: `https://hoodflow.app/learn/${article.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.75,
    })),
    ...seoAssets.map((asset) => ({
      url: `https://hoodflow.app/stock-tokens/${asset.ticker.toLowerCase()}`,
      changeFrequency: "daily" as const,
      priority: asset.fullFill ? 0.85 : 0.65,
    })),
  ];
}
