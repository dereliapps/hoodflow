import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import { Analytics } from "./analytics";
import "./globals.css";
import "./community-redesign.css";
import "./route-desk.css";
import { absoluteUrl, APP_ID, DEFAULT_OG_IMAGE, GITHUB_URL, jsonLdString, ORGANIZATION_ID, SITE_ORIGIN, WEBSITE_ID, X_URL } from "@/lib/seo";

const instrumentSans = Instrument_Sans({ variable: "--font-instrument-sans", subsets: ["latin"] });
const ibmPlexMono = IBM_Plex_Mono({ variable: "--font-ibm-plex-mono", subsets: ["latin"], weight: ["400", "500", "600"] });
const metadataBase = (() => {
  try {
    const candidate = new URL(process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://hoodflow.app");
    if (candidate.protocol === "http:" || candidate.protocol === "https:") return candidate;
  } catch {
    // Invalid deployment metadata must not make the root layout dynamic or fail the build.
  }
  return new URL("https://hoodflow.app");
})();
const origin = metadataBase.origin;

export const metadata: Metadata = {
    metadataBase,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/favicon.svg" },
    title: { default: "HoodFlow | Stock Token Markets on Robinhood Chain", template: "%s | HoodFlow" },
    description: "Discover Stock Token markets, compare a protected USDG route and keep the final decision inside your self-custody wallet.",
    keywords: ["Robinhood Chain", "Stock Tokens", "tokenized stocks", "USDG", "self-custody", "protected swap", "BellLock", "DepthMap", "ActionLock"],
    alternates: { canonical: "/" },
    category: "finance",
    applicationName: "HoodFlow",
    authors: [{ name: "HoodFlow Labs", url: origin }],
    openGraph: {
      type: "website",
      url: origin,
      siteName: "HoodFlow",
      title: "HoodFlow | Find the route. Keep the signature.",
      description: "Reviewed markets, protected USDG quotes and a final signature that stays with the user.",
      images: [{ url: "/og.png", width: 1732, height: 909, alt: "HoodFlow Payday Radar verifies corporate-action evidence before showing multiplier-transition math" }],
    },
    twitter: {
      card: "summary_large_image",
      site: "@hoodfloow",
      creator: "@hoodfloow",
      title: "HoodFlow | Find the route. Keep the signature.",
      description: "Reviewed markets, protected USDG quotes and a final signature that stays with the user.",
      images: ["/og.png"],
    },
    verification: { google: "7aPY4eAxVFKSGKAdD7KezZRG6g_tpnOadEqFXdWHeP4" },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORGANIZATION_ID,
        name: "HoodFlow Labs",
        alternateName: "HoodFlow",
        url: `${SITE_ORIGIN}/`,
        logo: { "@type": "ImageObject", url: absoluteUrl("/favicon.svg") },
        description: "Independent builders of HoodFlow, a self-custody execution interface for Stock Tokens on Robinhood Chain.",
        sameAs: [X_URL, GITHUB_URL],
      },
      {
        "@type": "WebSite",
        "@id": WEBSITE_ID,
        url: `${SITE_ORIGIN}/`,
        name: "HoodFlow",
        description: "Discover Stock Token markets on Robinhood Chain, compare a protected USDG route and sign from your own wallet.",
        inLanguage: "en",
        publisher: { "@id": ORGANIZATION_ID },
      },
      {
        "@type": "WebApplication",
        "@id": APP_ID,
        name: "HoodFlow",
        url: `${SITE_ORIGIN}/`,
        image: absoluteUrl(DEFAULT_OG_IMAGE.url),
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        inLanguage: "en",
        description: "Self-custody Stock Token market discovery and protected execution interface for Robinhood Chain.",
        featureList: [
          "Reviewed Uniswap V3 and V4 routes for Stock Tokens on Robinhood Chain",
          "Fresh executable quote and protected minimum output before every order",
          "Exact-amount, short-lived Permit2 permission",
          "ActionLock, DepthMap and BellLock protection tools",
          "Public REST, OpenAPI and MCP interfaces for agents",
        ],
        isPartOf: { "@id": WEBSITE_ID },
        provider: { "@id": ORGANIZATION_ID },
      },
    ],
  };
  return (
    <html lang="en">
      <body className={`${instrumentSans.variable} ${ibmPlexMono.variable}`}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(structuredData) }} />
        <Analytics />
        {children}
      </body>
    </html>
  );
}
