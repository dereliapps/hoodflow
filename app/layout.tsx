import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import { Analytics } from "./analytics";
import "./globals.css";
import "./community-redesign.css";
import "./route-desk.css";

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
    title: { default: "HoodFlow | See what changed. Scan again.", template: "%s | HoodFlow" },
    description: "Stress-test Stock Token liquidity across five fixed USDG sizes and compare device-local Depth Memory observations before requesting a fresh wallet quote.",
    keywords: ["Robinhood Chain", "Stock Tokens", "tokenized stocks", "liquidity stress test", "DepthMap", "Depth Memory", "USDG", "self-custody"],
    alternates: { canonical: "/" },
    category: "finance",
    applicationName: "HoodFlow",
    authors: [{ name: "HoodFlow Labs", url: origin }],
    openGraph: {
      type: "website",
      url: origin,
      siteName: "HoodFlow",
      title: "HoodFlow | See what changed. Scan again.",
      description: "Five fixed liquidity samples, device-local route memory and fresh self-custody execution on Robinhood Chain.",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "HoodFlow Depth Memory compares two five-point route observations" }],
    },
    twitter: {
      card: "summary_large_image",
      site: "@hoodfloow",
      creator: "@hoodfloow",
      title: "HoodFlow | See what changed. Scan again.",
      description: "Five fixed liquidity samples, device-local route memory and fresh self-custody execution on Robinhood Chain.",
      images: ["/og.png"],
    },
    verification: { google: "7aPY4eAxVFKSGKAdD7KezZRG6g_tpnOadEqFXdWHeP4" },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": "https://hoodflow.app/#organization", name: "HoodFlow Labs", url: "https://hoodflow.app", logo: "https://hoodflow.app/favicon.svg" },
      { "@type": "WebApplication", "@id": "https://hoodflow.app/#app", name: "HoodFlow", url: "https://hoodflow.app", applicationCategory: "FinanceApplication", operatingSystem: "Web", description: "Self-custody Stock Token execution interface for Robinhood Chain.", provider: { "@id": "https://hoodflow.app/#organization" } },
    ],
  };
  return (
    <html lang="en">
      <body className={`${instrumentSans.variable} ${ibmPlexMono.variable}`}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
        <Analytics />
        {children}
      </body>
    </html>
  );
}
