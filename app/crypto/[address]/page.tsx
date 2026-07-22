import type { Metadata } from "next";
import Home from "../../page";

export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const address = (await params).address.toLowerCase();
  const valid = /^0x[a-f0-9]{40}$/.test(address);
  const compact = valid ? `${address.slice(0, 8)}…${address.slice(-6)}` : "unknown token";
  const title = `Crypto market ${compact}`;
  const description = "Inspect available Robinhood Chain market data and check whether a self-custody route is executable.";
  return {
    title,
    description,
    alternates: { canonical: valid ? `/crypto/${address}` : "/?view=community" },
    robots: { index: false, follow: true },
    openGraph: { title, description },
  };
}

export default function CryptoTokenPage() {
  return <Home />;
}
