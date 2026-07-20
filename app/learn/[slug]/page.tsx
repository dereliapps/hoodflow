import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLearnArticle, learnArticles } from "@/lib/learn";

export function generateStaticParams() {
  return learnArticles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const article = getLearnArticle((await params).slug);
  if (!article) return {};
  return { title: article.title, description: article.excerpt, alternates: { canonical: `/learn/${article.slug}` }, openGraph: { title: article.title, description: article.excerpt } };
}

export default async function LearnArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const article = getLearnArticle((await params).slug);
  if (!article) notFound();
  const structured = { "@context": "https://schema.org", "@type": "Article", headline: article.title, description: article.excerpt, author: { "@type": "Organization", name: "HoodFlow Labs" }, publisher: { "@type": "Organization", name: "HoodFlow Labs" }, mainEntityOfPage: `https://hoodflow.app/learn/${article.slug}` };
  return <main className="seo-shell article-shell">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structured) }} />
    <header className="seo-nav"><Link href="/" className="seo-logo">hoodflow<span>MAINNET BETA</span></Link><nav><Link href="/learn">All guides</Link><Link href="/docs">Docs</Link><Link href="/security">Security</Link><Link href="/?view=assets" className="seo-cta">Open app</Link></nav></header>
    <article className="learn-article"><header><p>HOODFLOW LEARN · {article.readingTime}</p><h1>{article.title}</h1><span>{article.excerpt}</span></header>{article.sections.map(([title, copy], index) => <section key={title}><span>0{index + 1}</span><div><h2>{title}</h2><p>{copy}</p></div></section>)}<aside><strong>Before any transaction</strong><p>Verify the network, token address, amount, spender, minimum output and gas estimate inside your wallet.</p><Link href="/?view=assets">Explore route-ready markets →</Link></aside></article>
    <footer className="seo-footer"><Link href="/learn">← Back to Learn</Link><a href="https://x.com/hoodfloow" target="_blank" rel="noreferrer">Follow @hoodfloow on 𝕏 →</a></footer>
  </main>;
}
