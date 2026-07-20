import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import { headers } from "next/headers";
import { Analytics } from "./analytics";
import { Providers } from "./providers";
import "./globals.css";

const instrumentSans = Instrument_Sans({ variable: "--font-instrument-sans", subsets: ["latin"] });
const ibmPlexMono = IBM_Plex_Mono({ variable: "--font-ibm-plex-mono", subsets: ["latin"], weight: ["400", "500", "600"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/favicon.svg" },
    title: { default: "HoodFlow | Crypto & Stock Token Markets on Robinhood Chain", template: "%s | HoodFlow" },
    description: "Compare live Stock Token and crypto liquidity on Robinhood Chain, review transparent fees and protected minimum output, then trade from a self-custody wallet.",
    keywords: ["Robinhood Chain", "Stock Tokens", "tokenized stocks", "meme tokens", "crypto trading", "USDG", "Uniswap V4", "self-custody"],
    alternates: { canonical: "/" },
    category: "finance",
    applicationName: "HoodFlow",
    authors: [{ name: "HoodFlow Labs", url: origin }],
    openGraph: {
      type: "website",
      url: origin,
      siteName: "HoodFlow",
      title: "HoodFlow | Every live token. One execution screen.",
      description: "Live Robinhood Chain crypto markets, onchain charts and protected self-custody execution.",
      images: [{ url: `${origin}/og-crypto.png`, width: 1728, height: 941, alt: "HoodFlow Crypto market workspace" }],
    },
    twitter: {
      card: "summary_large_image",
      site: "@hoodfloow",
      creator: "@hoodfloow",
      title: "HoodFlow | Every live token. One execution screen.",
      description: "Live crypto markets, onchain charts and protected self-custody execution on Robinhood Chain.",
      images: [`${origin}/og-crypto.png`],
    },
    verification: { google: "7aPY4eAxVFKSGKAdD7KezZRG6g_tpnOadEqFXdWHeP4" },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": "https://hoodflow.app/#organization", name: "HoodFlow Labs", url: "https://hoodflow.app", logo: "https://hoodflow.app/favicon.svg" },
      { "@type": "WebApplication", "@id": "https://hoodflow.app/#app", name: "HoodFlow", url: "https://hoodflow.app", applicationCategory: "FinanceApplication", operatingSystem: "Web", description: "Self-custody Stock Token execution interface for Robinhood Chain.", provider: { "@id": "https://hoodflow.app/#organization" } },
    ],
  };
  return <html lang="en"><body className={`${instrumentSans.variable} ${ibmPlexMono.variable}`}><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} /><Analytics /><Providers>{children}</Providers></body></html>;
}
