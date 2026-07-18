import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import { headers } from "next/headers";
import { Analytics } from "./analytics";
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
    title: { default: "HoodFlow | Stock Token Trading on Robinhood Chain", template: "%s | HoodFlow" },
    description: "Compare reviewed Uniswap V3 and V4 liquidity, receive a protected USDG quote and trade canonical Stock Tokens from a self-custody wallet on Robinhood Chain.",
    keywords: ["Robinhood Chain", "Stock Tokens", "tokenized stocks", "Stock Token trading", "USDG", "Uniswap V4", "self-custody"],
    alternates: { canonical: "/" },
    category: "finance",
    applicationName: "HoodFlow",
    authors: [{ name: "HoodFlow Labs", url: origin }],
    openGraph: {
      type: "website",
      url: origin,
      siteName: "HoodFlow",
      title: "HoodFlow | The execution layer for Stock Tokens",
      description: "Find a reviewed executable route, protect minimum output and settle Stock Tokens directly to your wallet on Robinhood Chain.",
      images: [{ url: `${origin}/og.png`, width: 1672, height: 941, alt: "HoodFlow Stock Token execution workspace" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "HoodFlow | The execution layer for Stock Tokens",
      description: "Reviewed V3/V4 routes, protected minimum output and self-custody settlement on Robinhood Chain.",
      images: [`${origin}/og.png`],
    },
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
  return <html lang="en"><body className={`${instrumentSans.variable} ${ibmPlexMono.variable}`}><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} /><Analytics />{children}</body></html>;
}
