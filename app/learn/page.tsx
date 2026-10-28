import type { Metadata } from "next";
import Link from "next/link";
import { learnArticles } from "@/lib/learn";
import { absoluteUrl, breadcrumbJsonLd, jsonLdString, ORGANIZATION_ID, pageSocialMetadata } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Learn Stock Tokens & Onchain Trading",
  description: "Plain-language guides to Stock Tokens, Robinhood Chain, slippage, market hours, wallet permissions and HoodFlow fees.",
  alternates: { canonical: "/learn" },
  ...pageSocialMetadata({
    path: "/learn",
    title: "Learn Stock Tokens & Onchain Trading",
    description: "Plain-language guides to Stock Tokens, Robinhood Chain, slippage, market hours, wallet permissions and HoodFlow fees.",
  }),
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "CollectionPage",
      "@id": absoluteUrl("/learn#page"),
      url: absoluteUrl("/learn"),
      name: "Learn Stock Tokens & Onchain Trading",
      description: "Plain-language guides to Stock Tokens, Robinhood Chain, slippage, market hours, wallet permissions and HoodFlow fees.",
      inLanguage: "en",
      publisher: { "@id": ORGANIZATION_ID },
      mainEntity: {
        "@type": "ItemList",
        itemListElement: learnArticles.map((article, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: absoluteUrl(`/learn/${article.slug}`),
          name: article.title,
        })),
      },
    },
    breadcrumbJsonLd([{ name: "HoodFlow", path: "/" }, { name: "Learn", path: "/learn" }]),
  ],
};

export default function LearnPage() {
  return <main className="seo-shell learn-shell">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(structuredData) }} />
    <header className="seo-nav"><Link href="/" className="seo-logo">hoodflow<span>MAINNET BETA</span></Link><nav><Link href="/stock-tokens">Markets</Link><Link href="/roadmap">Roadmap</Link><Link href="/docs">Docs</Link><Link href="/?view=assets" className="seo-cta">Open app</Link></nav></header>
    <section className="learn-hero"><p>HOODFLOW LEARN</p><h1>Onchain markets,<br /><em>without the fog.</em></h1><div><p>Short, direct guides for understanding Stock Tokens, wallet permissions and execution before you sign.</p><span>{learnArticles.length} practical guides · no return promises</span></div></section>
    <section className="learn-grid">{learnArticles.map((article, index) => <Link href={`/learn/${article.slug}`} key={article.slug}><span>0{index + 1} · {article.readingTime}</span><h2>{article.title}</h2><p>{article.excerpt}</p><b>Read guide →</b></Link>)}</section>
    <section className="seo-risk"><strong>Educational content only</strong><p>These guides explain product mechanics and risks. They are not investment, legal or tax advice.</p></section>
    <footer className="seo-footer"><span>HoodFlow Learn · Updated as the product changes</span><a href="https://x.com/hoodfloow" target="_blank" rel="noreferrer">Follow @hoodfloow on 𝕏 →</a></footer>
  </main>;
}
