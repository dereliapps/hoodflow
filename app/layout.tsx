import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import { headers } from "next/headers";
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
    title: "HoodFlow — Buy stock tokens on Robinhood Chain",
    description: "Explore 25 official stock tokens, inspect real Chainlink price history, and buy every full-fill verified asset with USDG on Robinhood Chain mainnet.",
    openGraph: {
      title: "HoodFlow — Robinhood Chain stock-token explorer",
      description: "Real onchain prices, verified history, protected V4 routing and direct-to-wallet delivery.",
      images: [{ url: `${origin}/og.png`, width: 1920, height: 1080, alt: "HoodFlow portfolio automation dashboard" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "HoodFlow — Robinhood Chain stock-token explorer",
      description: "Real onchain prices, verified history, protected V4 routing and direct-to-wallet delivery.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${instrumentSans.variable} ${ibmPlexMono.variable}`}>{children}</body></html>;
}
