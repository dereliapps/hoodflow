import type { MetadataRoute } from "next";
import { seoAssets } from "@/lib/seo-assets";

export default function sitemap(): MetadataRoute.Sitemap {
  const updated = new Date();
  return [
    { url: "https://hoodflow.app/", lastModified: updated, changeFrequency: "daily", priority: 1 },
    { url: "https://hoodflow.app/stock-tokens", lastModified: updated, changeFrequency: "daily", priority: 0.9 },
    { url: "https://hoodflow.app/how-it-works", lastModified: updated, changeFrequency: "monthly", priority: 0.7 },
    { url: "https://hoodflow.app/security", lastModified: updated, changeFrequency: "weekly", priority: 0.8 },
    ...seoAssets.map((asset) => ({
      url: `https://hoodflow.app/stock-tokens/${asset.ticker.toLowerCase()}`,
      lastModified: updated,
      changeFrequency: "daily" as const,
      priority: asset.fullFill ? 0.85 : 0.65,
    })),
  ];
}
