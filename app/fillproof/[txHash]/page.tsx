import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import FillProofReceipt from "@/app/fill-proof-receipt";

export const metadata: Metadata = {
  title: "FillProof execution receipt · HoodFlow",
  description: "Verify a reviewed Robinhood Chain Stock Token settlement, protected minimum and mainnet receipt.",
  robots: { index: false, follow: false },
};

export default async function PublicFillProofPage({ params }: { params: Promise<{ txHash: string }> }) {
  const { txHash } = await params;
  return <main className="fillproof-public terminal-v2">
    <nav>
      <Link href="/" aria-label="Back to HoodFlow"><Image src="/favicon.svg" alt="" width={34} height={34} /><strong>hoodflow</strong></Link>
      <span><i /> ROBINHOOD CHAIN · PUBLIC RECEIPT</span>
    </nav>
    <FillProofReceipt txHash={txHash} standalone />
    <footer><p>Public onchain reconstruction. No wallet connection is required.</p><Link href="/?view=activity">Open HoodFlow activity →</Link></footer>
  </main>;
}
