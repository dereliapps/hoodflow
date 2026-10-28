import type { Metadata } from "next";

export const SITE_ORIGIN = "https://hoodflow.app";
export const SITE_NAME = "HoodFlow";
export const X_URL = "https://x.com/hoodfloow";
export const GITHUB_URL = "https://github.com/dereliapps/hoodflow";

export const DEFAULT_OG_IMAGE = {
  url: "/og.png",
  width: 1732,
  height: 909,
  alt: "HoodFlow Payday Radar verifies corporate-action evidence before showing multiplier-transition math",
} as const;

/**
 * Last meaningful content change per page, taken from the file's last git commit.
 * Update the matching entry whenever a page's visible content changes; sitemap
 * `lastmod` and structured-data `dateModified` both read from here so search
 * engines get a truthful freshness signal instead of one global release date.
 */
export const PAGE_LAST_MODIFIED = {
  home: "2026-10-28",
  docs: "2026-08-12",
  security: "2026-08-11",
  roadmap: "2026-07-26",
  howItWorks: "2026-07-18",
  learnIndex: "2026-07-20",
  learnArticle: "2026-07-20",
  stockTokensIndex: "2026-07-22",
  stockTokenDetail: "2026-10-28",
} as const;

export const LEARN_PUBLISHED = "2026-07-20";

export function absoluteUrl(path: string) {
  return new URL(path, SITE_ORIGIN).toString();
}

type SocialOptions = {
  path: string;
  title: string;
  description: string;
  type?: "website" | "article";
  publishedTime?: string;
  modifiedTime?: string;
};

/**
 * Next.js replaces (not merges) `openGraph` and `twitter` when a child route
 * defines them, so pages that only set `openGraph: { title, description }`
 * silently lose og:image, og:url, og:type and the correct twitter card.
 * Build the complete objects in one place instead.
 */
export function pageSocialMetadata({
  path,
  title,
  description,
  type = "website",
  publishedTime,
  modifiedTime,
}: SocialOptions): Pick<Metadata, "openGraph" | "twitter"> {
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;
  return {
    openGraph: {
      type,
      url: absoluteUrl(path),
      siteName: SITE_NAME,
      locale: "en_US",
      title: fullTitle,
      description,
      images: [DEFAULT_OG_IMAGE],
      ...(type === "article" ? { publishedTime, modifiedTime } : {}),
    },
    twitter: {
      card: "summary_large_image",
      site: "@hoodfloow",
      creator: "@hoodfloow",
      title: fullTitle,
      description,
      images: [DEFAULT_OG_IMAGE.url],
    },
  };
}

export function breadcrumbJsonLd(items: ReadonlyArray<{ name: string; path: string }>) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function faqJsonLd(items: ReadonlyArray<{ question: string; answer: string }>) {
  return {
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

/** Serialises JSON-LD for an inline <script>, escaping characters that could end the tag early. */
export function jsonLdString(data: unknown) {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export const ORGANIZATION_ID = `${SITE_ORIGIN}/#organization`;
export const WEBSITE_ID = `${SITE_ORIGIN}/#website`;
export const APP_ID = `${SITE_ORIGIN}/#app`;
