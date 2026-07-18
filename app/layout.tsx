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
    title: "HoodFlow — Safe stock automation on Robinhood Chain",
    description: "Explore 25 official stock-token and ETF assets, simulate strategies, and understand every spending limit before authorizing anything.",
    openGraph: {
      title: "HoodFlow — Stock automation, clearly explained.",
      description: "Real asset brands, full-fill route checks, Shadow Mode, and hard spending limits on Robinhood Chain.",
      images: [{ url: `${origin}/og.png`, width: 1920, height: 1080, alt: "HoodFlow portfolio automation dashboard" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "HoodFlow — Stock automation, clearly explained.",
      description: "Real asset brands, full-fill route checks, Shadow Mode, and hard spending limits on Robinhood Chain.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${instrumentSans.variable} ${ibmPlexMono.variable}`}>{children}</body></html>;
}
