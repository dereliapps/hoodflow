import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    title: "HoodFlow — Portfolio automation on Robinhood Chain",
    description: "Create bounded, non-custodial DCA, take-profit and rebalancing strategies on Robinhood Chain.",
    openGraph: {
      title: "HoodFlow — Your portfolio, on schedule.",
      description: "Bounded, non-custodial portfolio automation on Robinhood Chain.",
      images: [{ url: `${origin}/og.png`, width: 1920, height: 1080, alt: "HoodFlow portfolio automation dashboard" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "HoodFlow — Your portfolio, on schedule.",
      description: "Bounded, non-custodial portfolio automation on Robinhood Chain.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
