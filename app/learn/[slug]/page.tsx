import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLearnArticle, learnArticles } from "@/lib/learn";
import { absoluteUrl, APP_ID, breadcrumbJsonLd, DEFAULT_OG_IMAGE, LEARN_PUBLISHED, jsonLdString, ORGANIZATION_ID, PAGE_LAST_MODIFIED, pageSocialMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return learnArticles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const article = getLearnArticle((await params).slug);
  if (!article) return {};
  return {
    title: article.title,
    description: article.excerpt,
    alternates: { canonical: `/learn/${article.slug}` },
    ...pageSocialMetadata({
      path: `/learn/${article.slug}`,
      title: article.title,
      description: article.excerpt,
      type: "article",
      publishedTime: LEARN_PUBLISHED,
      modifiedTime: PAGE_LAST_MODIFIED.learnArticle,
    }),
  };
}

export default async function LearnArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const article = getLearnArticle((await params).slug);
  if (!article) notFound();
  const url = absoluteUrl(`/learn/${article.slug}`);
  const structured = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${url}#article`,
        headline: article.title,
        description: article.excerpt,
        url,
        mainEntityOfPage: url,
        image: absoluteUrl(DEFAULT_OG_IMAGE.url),
        inLanguage: "en",
        datePublished: LEARN_PUBLISHED,
        dateModified: PAGE_LAST_MODIFIED.learnArticle,
        articleSection: "Stock Tokens",
        wordCount: article.sections.reduce((total, [heading, copy]) => total + `${heading} ${copy}`.split(/\s+/).length, 0),
        author: { "@id": ORGANIZATION_ID },
        publisher: { "@id": ORGANIZATION_ID },
        about: { "@id": APP_ID },
      },
      breadcrumbJsonLd([{ name: "HoodFlow", path: "/" }, { name: "Learn", path: "/learn" }, { name: article.title, path: `/learn/${article.slug}` }]),
    ],
  };
  return <main className="seo-shell article-shell">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(structured) }} />
    <header className="seo-nav"><Link href="/" className="seo-logo">hoodflow<span>MAINNET BETA</span></Link><nav><Link href="/learn">All guides</Link><Link href="/docs">Docs</Link><Link href="/security">Security</Link><Link href="/?view=assets" className="seo-cta">Open app</Link></nav></header>
    <article className="learn-article"><header><p>HOODFLOW LEARN · {article.readingTime}</p><h1>{article.title}</h1><span>{article.excerpt}</span></header>{article.sections.map(([title, copy], index) => <section key={title}><span>0{index + 1}</span><div><h2>{title}</h2><p>{copy}</p></div></section>)}<aside><strong>Before any transaction</strong><p>Verify the network, token address, amount, spender, minimum output and gas estimate inside your wallet.</p><Link href="/?view=assets">Explore route-ready markets →</Link></aside></article>
    <footer className="seo-footer"><Link href="/learn">← Back to Learn</Link><a href="https://x.com/hoodfloow" target="_blank" rel="noreferrer">Follow @hoodfloow on 𝕏 →</a></footer>
  </main>;
}
