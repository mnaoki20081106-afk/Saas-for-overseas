import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";
import { config, affiliateLinks } from "../lib/config";
import { log } from "../lib/log";
import { P } from "../lib/paths";
import { articles as articleStore, programs } from "../lib/store";
import type { Article } from "../lib/types";
import { escapeHtml, slugify } from "../lib/util";
import { buildAdminPage } from "../admin/page";
import { readArticleBody } from "../stages/content";

marked.setOptions({ gfm: true, breaks: false });

/* --------------------------------------------------------------------- css */

const CSS = `
:root{--bg:#fffdf9;--surface:#fff;--ink:#16130f;--muted:#5f5850;--line:#e8e1d6;
  --accent:#9a3412;--accent-soft:#fef3ec;--max:44rem}
@media (prefers-color-scheme:dark){:root{--bg:#12100e;--surface:#1a1714;--ink:#f5efe6;
  --muted:#a8a096;--line:#2e2924;--accent:#fb923c;--accent-soft:#2a1d13}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);
  font:17px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
a{color:var(--accent)}
.wrap{max-width:var(--max);margin:0 auto;padding:0 1.25rem}
header.site{border-bottom:1px solid var(--line);background:var(--surface)}
header.site .wrap{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding-block:1.1rem}
.logo{font-weight:800;letter-spacing:-.02em;font-size:1.15rem;text-decoration:none;color:var(--ink)}
nav a{margin-left:1.1rem;font-size:.92rem;text-decoration:none;color:var(--muted)}
nav a:hover{color:var(--accent)}
main{padding-block:2.5rem 4rem}
h1{font-size:2.1rem;line-height:1.2;letter-spacing:-.025em;margin:0 0 .8rem}
h2{font-size:1.42rem;line-height:1.3;margin:2.6rem 0 .7rem;letter-spacing:-.015em;scroll-margin-top:1rem}
h3{font-size:1.12rem;margin:1.8rem 0 .5rem}
p,ul,ol{margin:0 0 1.1rem}
li{margin-bottom:.4rem}
.meta{color:var(--muted);font-size:.9rem;margin-bottom:1.6rem}
.disclosure{background:var(--accent-soft);border:1px solid var(--line);border-left:3px solid var(--accent);
  border-radius:.5rem;padding:.85rem 1rem;font-size:.87rem;color:var(--muted);margin:0 0 2rem}
.toc{background:var(--surface);border:1px solid var(--line);border-radius:.6rem;padding:1rem 1.25rem;margin:0 0 2rem}
.toc strong{font-size:.78rem;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.toc ol{margin:.6rem 0 0;padding-left:1.1rem;font-size:.95rem}
.table-scroll{overflow-x:auto;margin:0 0 1.4rem;border:1px solid var(--line);border-radius:.6rem}
table{border-collapse:collapse;width:100%;font-size:.94rem;min-width:34rem}
th,td{text-align:left;padding:.62rem .8rem;border-bottom:1px solid var(--line)}
th{background:var(--accent-soft);font-weight:700}
tbody tr:last-child td{border-bottom:0}
blockquote{margin:0 0 1.2rem;padding:.2rem 0 .2rem 1.1rem;border-left:3px solid var(--line);color:var(--muted)}
code{background:var(--accent-soft);padding:.1rem .35rem;border-radius:.25rem;font-size:.9em}
.card{display:block;border:1px solid var(--line);border-radius:.7rem;padding:1.1rem 1.25rem;margin-bottom:1rem;
  text-decoration:none;color:inherit;background:var(--surface);transition:border-color .15s}
.card:hover{border-color:var(--accent)}
.card h3{margin:0 0 .35rem;font-size:1.05rem;line-height:1.35}
.card p{margin:0;color:var(--muted);font-size:.92rem}
.tag{display:inline-block;font-size:.72rem;letter-spacing:.07em;text-transform:uppercase;
  color:var(--accent);font-weight:700;margin-bottom:.4rem}
.cta{display:inline-block;background:var(--accent);color:#fff;padding:.7rem 1.15rem;border-radius:.5rem;
  text-decoration:none;font-weight:600;font-size:.95rem}
.cta-box{margin:1.6rem 0;padding:1.1rem 1.25rem;background:var(--accent-soft);
  border:1px solid var(--line);border-radius:.6rem;text-align:center}
.cta-box p{margin:0 0 .65rem;font-size:.9rem;color:var(--muted)}
.cta:hover{opacity:.92;text-decoration:none}
footer.site{border-top:1px solid var(--line);margin-top:3rem;padding-block:2rem;color:var(--muted);font-size:.86rem}
footer.site a{color:var(--muted)}
.grid-cats{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 2rem;padding:0;list-style:none}
.grid-cats a{font-size:.85rem;border:1px solid var(--line);border-radius:99px;padding:.3rem .8rem;
  text-decoration:none;color:var(--muted);background:var(--surface)}
`;

/* ------------------------------------------------------------------ layout */

interface PageOpts {
  title: string;
  description: string;
  canonicalPath: string;
  jsonLd?: unknown[];
  noindex?: boolean;
  body: string;
}

function layout(o: PageOpts): string {
  const c = config();
  const url = `${c.site.baseUrl}${o.canonicalPath}`;
  const ga = c.site.gaMeasurementId
    ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${c.site.gaMeasurementId}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}
gtag('js',new Date());gtag('config','${c.site.gaMeasurementId}');</script>`
    : "";

  return `<!doctype html>
<html lang="${c.site.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(o.title)}</title>
<meta name="description" content="${escapeHtml(o.description)}">
${o.noindex ? '<meta name="robots" content="noindex,nofollow">' : `<link rel="canonical" href="${url}">`}
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(o.title)}">
<meta property="og:description" content="${escapeHtml(o.description)}">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="${escapeHtml(c.site.name)}">
<meta name="twitter:card" content="summary_large_image">
${c.site.pinterestVerifyCode ? `<meta name="p:domain_verify" content="${escapeHtml(c.site.pinterestVerifyCode)}">` : ""}
<link rel="alternate" type="application/rss+xml" title="${escapeHtml(c.site.name)}" href="${c.site.baseUrl}/rss.xml">
<style>${CSS}</style>
${(o.jsonLd ?? []).map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join("\n")}
${ga}
</head>
<body>
<header class="site"><div class="wrap">
  <a class="logo" href="/">${escapeHtml(c.site.name)}</a>
  <nav><a href="/">Articles</a><a href="/about/">About</a><a href="/disclosure/">Disclosure</a></nav>
</div></header>
<main><div class="wrap">
${o.body}
</div></main>
<footer class="site"><div class="wrap">
  <p>${escapeHtml(c.site.name)} — ${escapeHtml(c.site.tagline)}</p>
  <p>${escapeHtml(c.compliance.affiliateDisclosure)}</p>
  <p><a href="/disclosure/">Affiliate disclosure</a> · <a href="/privacy/">Privacy</a> · <a href="/rss.xml">RSS</a></p>
</div></footer>
</body></html>`;
}

/* ----------------------------------------------------------- transformers */

/** {{link:slug}} を /go/<slug>/ に置換する。承認前でも公式サイトへ飛ぶので記事は先に作れる。 */
function replaceLinkPlaceholders(md: string): string {
  return md.replace(/\{\{link:([a-z0-9-]+)\}\}/g, (_m, slug: string) => `/go/${slug}/`);
}

function addHeadingIds(html: string): { html: string; toc: { id: string; text: string }[] } {
  const toc: { id: string; text: string }[] = [];
  const out = html.replace(/<h2>([\s\S]*?)<\/h2>/g, (_m, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, "").trim();
    const id = slugify(text) || `section-${toc.length + 1}`;
    toc.push({ id, text });
    return `<h2 id="${id}">${inner}</h2>`;
  });
  return { html: out, toc };
}

function wrapTables(html: string): string {
  return html.replace(/<table>[\s\S]*?<\/table>/g, (m) => `<div class="table-scroll">${m}</div>`);
}

function markAffiliateLinks(html: string): string {
  const rel = config().compliance.linkRel;
  return html.replace(/<a href="(\/go\/[a-z0-9-]+\/)"/g, `<a href="$1" rel="${rel}"`);
}

/**
 * 本文中の文字リンクだけでは押されるかどうか運任せになるため、
 * 目立つボタンを冒頭直後と末尾にプログラム側で確実に挿入する。
 * AI の書き方や配置判断には委ねない。
 */
function ctaBox(slug: string, label: string): string {
  const c = config();
  const name = programs.bySlug(slug)?.name ?? "their site";
  return `<div class="cta-box">
<p>See if ${escapeHtml(name)} fits your team.</p>
<a class="cta" href="/go/${slug}/" rel="${c.compliance.linkRel}">${escapeHtml(label)}</a>
</div>`;
}

function insertCtas(html: string, mainSlug: string): string {
  const top = ctaBox(mainSlug, "Check current pricing →");
  const bottom = ctaBox(mainSlug, "Start a free trial →");

  const firstParaEnd = html.indexOf("</p>");
  const withTop = firstParaEnd === -1
    ? `${top}\n${html}`
    : `${html.slice(0, firstParaEnd + 4)}\n${top}${html.slice(firstParaEnd + 4)}`;

  return `${withTop}\n${bottom}`;
}

/* ------------------------------------------------------------- page types */

function articlePage(a: Article): string {
  const c = config();
  const md = replaceLinkPlaceholders(readArticleBody(a));
  const rawHtml = marked.parse(md) as string;
  const { html: withIds, toc } = addHeadingIds(rawHtml);
  const html = markAffiliateLinks(wrapTables(withIds));

  const strippedH1 = html.replace(/<h1>[\s\S]*?<\/h1>/, "");
  const bodyNoH1 = a.programSlugs.length > 0 ? insertCtas(strippedH1, a.programSlugs[0]) : strippedH1;
  const faqPairs = a.brief?.faq ?? [];

  const jsonLd: unknown[] = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: a.title,
      description: a.metaDescription,
      author: { "@type": "Organization", name: c.site.author },
      publisher: { "@type": "Organization", name: c.site.name },
      datePublished: a.createdAt,
      dateModified: a.updatedAt,
      mainEntityOfPage: `${c.site.baseUrl}/articles/${a.slug}/`,
      about: a.programSlugs.map((s) => programs.bySlug(s)?.name).filter(Boolean),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${c.site.baseUrl}/` },
        { "@type": "ListItem", position: 2, name: a.category, item: `${c.site.baseUrl}/category/${slugify(a.category)}/` },
        { "@type": "ListItem", position: 3, name: a.title },
      ],
    },
  ];
  if (faqPairs.length) {
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqPairs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }

  const tocHtml = toc.length > 3
    ? `<nav class="toc"><strong>On this page</strong><ol>${toc
        .map((t) => `<li><a href="#${t.id}">${escapeHtml(t.text)}</a></li>`)
        .join("")}</ol></nav>`
    : "";

  const body = `
<p class="tag"><a href="/category/${slugify(a.category)}/">${escapeHtml(a.category)}</a></p>
<h1>${escapeHtml(a.title)}</h1>
<p class="meta">${a.words.toLocaleString()} words · Updated ${a.updatedAt.slice(0, 10)}</p>
${c.compliance.requireDisclosure ? `<p class="disclosure">${escapeHtml(c.compliance.affiliateDisclosure)}</p>` : ""}
${tocHtml}
${bodyNoH1}`;

  return layout({
    title: a.metaTitle || a.title,
    description: a.metaDescription,
    canonicalPath: `/articles/${a.slug}/`,
    jsonLd,
    body,
  });
}

function indexPage(list: Article[]): string {
  const c = config();
  const categories = [...new Set(list.map((a) => a.category))].sort();
  const cards = list
    .map(
      (a) => `<a class="card" href="/articles/${a.slug}/">
  <span class="tag">${escapeHtml(a.category)}</span>
  <h3>${escapeHtml(a.title)}</h3>
  <p>${escapeHtml(a.metaDescription)}</p></a>`,
    )
    .join("\n");

  return layout({
    title: `${c.site.name} — ${c.site.tagline}`,
    description: c.site.description,
    canonicalPath: "/",
    jsonLd: [
      { "@context": "https://schema.org", "@type": "WebSite", name: c.site.name, url: `${c.site.baseUrl}/`, description: c.site.description },
    ],
    body: `<h1>${escapeHtml(c.site.tagline)}</h1>
<p class="meta">${escapeHtml(c.site.description)}</p>
<ul class="grid-cats">${categories
      .map((cat) => `<li><a href="/category/${slugify(cat)}/">${escapeHtml(cat)}</a></li>`)
      .join("")}</ul>
${cards || "<p>No articles published yet.</p>"}`,
  });
}

function categoryPage(category: string, list: Article[]): string {
  const c = config();
  const cards = list
    .map(
      (a) => `<a class="card" href="/articles/${a.slug}/">
  <h3>${escapeHtml(a.title)}</h3><p>${escapeHtml(a.metaDescription)}</p></a>`,
    )
    .join("\n");
  return layout({
    title: `${category} — ${c.site.name}`,
    description: `Independent comparisons of ${category} tools for ${c.niche.audience}.`,
    canonicalPath: `/category/${slugify(category)}/`,
    body: `<h1>${escapeHtml(category)}</h1>
<p class="meta">${list.length} article${list.length === 1 ? "" : "s"}</p>
${cards}`,
  });
}

/** アフィリエイトリンクの中継ページ。承認前は公式サイトへそのまま飛ばす。 */
function redirectPage(slug: string): string | null {
  const c = config();
  const program = programs.bySlug(slug);
  const affiliate = affiliateLinks()[slug];
  const target = affiliate || program?.signupUrl || program?.homepage;
  if (!target) return null;

  const ga = c.site.gaMeasurementId
    ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${c.site.gaMeasurementId}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}
gtag('js',new Date());gtag('config','${c.site.gaMeasurementId}');
gtag('event','affiliate_click',{program:'${slug}',affiliate_active:${Boolean(affiliate)}});</script>`
    : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<title>Redirecting…</title>
${ga}
<meta http-equiv="refresh" content="0;url=${escapeHtml(target)}">
<link rel="canonical" href="${escapeHtml(target)}">
<style>body{font:16px/1.6 system-ui,sans-serif;margin:0;display:grid;place-items:center;height:100vh;color:#555}</style>
</head><body>
<p>Redirecting to ${escapeHtml(program?.name ?? slug)}… <a href="${escapeHtml(target)}" rel="${c.compliance.linkRel}">Continue</a></p>
<script>location.replace(${JSON.stringify(target)})</script>
</body></html>`;
}

function staticPage(title: string, canonicalPath: string, bodyHtml: string, description: string): string {
  return layout({ title: `${title} — ${config().site.name}`, description, canonicalPath, body: bodyHtml });
}

/* -------------------------------------------------------------- feeds/maps */

function sitemap(list: Article[]): string {
  const c = config();
  const urls = [
    { loc: `${c.site.baseUrl}/`, lastmod: new Date().toISOString() },
    { loc: `${c.site.baseUrl}/about/`, lastmod: new Date().toISOString() },
    { loc: `${c.site.baseUrl}/disclosure/`, lastmod: new Date().toISOString() },
    ...[...new Set(list.map((a) => a.category))].map((cat) => ({
      loc: `${c.site.baseUrl}/category/${slugify(cat)}/`, lastmod: new Date().toISOString(),
    })),
    ...list.map((a) => ({ loc: `${c.site.baseUrl}/articles/${a.slug}/`, lastmod: a.updatedAt })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`).join("\n")}
</urlset>`;
}

function rss(list: Article[]): string {
  const c = config();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${escapeHtml(c.site.name)}</title>
<link>${c.site.baseUrl}/</link>
<description>${escapeHtml(c.site.description)}</description>
${list
    .slice(0, 30)
    .map(
      (a) => `<item><title>${escapeHtml(a.title)}</title>
<link>${c.site.baseUrl}/articles/${a.slug}/</link>
<guid>${c.site.baseUrl}/articles/${a.slug}/</guid>
<pubDate>${new Date(a.createdAt).toUTCString()}</pubDate>
<description>${escapeHtml(a.metaDescription)}</description></item>`,
    )
    .join("\n")}
</channel></rss>`;
}

/* ------------------------------------------------------------------ build */

function write(rel: string, contents: string): void {
  const full = path.join(P.publicDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents, "utf8");
}

export interface BuildResult {
  pages: number;
  articles: number;
  redirects: number;
  liveAffiliateLinks: number;
  pendingAffiliateLinks: string[];
}

export function buildSite(): BuildResult {
  log.step("STEP 3 / サイトを静的ビルドする（GitHub Pages にそのまま置ける形）");
  const c = config();
  fs.rmSync(P.publicDir, { recursive: true, force: true });
  fs.mkdirSync(P.publicDir, { recursive: true });

  const list = articleStore
    .all()
    // 品質ゲートに落ちた記事は公開しない（ドメイン全体の評価を守るため）
    .filter((a) => a.status === "published")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  let pages = 0;
  for (const a of list) {
    write(`articles/${a.slug}/index.html`, articlePage(a));
    pages++;
  }

  write("index.html", indexPage(list));
  pages++;

  for (const cat of new Set(list.map((a) => a.category))) {
    write(`category/${slugify(cat)}/index.html`, categoryPage(cat, list.filter((a) => a.category === cat)));
    pages++;
  }

  const links = affiliateLinks();
  const referenced = new Set<string>();
  for (const a of list) for (const s of a.programSlugs) referenced.add(s);
  for (const p of programs.all()) referenced.add(p.slug);

  let redirects = 0;
  const pending: string[] = [];
  for (const slug of referenced) {
    const html = redirectPage(slug);
    if (!html) continue;
    write(`go/${slug}/index.html`, html);
    redirects++;
    if (!links[slug]) pending.push(slug);
  }

  write("about/index.html", staticPage(
    "About", "/about/",
    `<h1>About ${escapeHtml(c.site.name)}</h1>
<p>${escapeHtml(c.site.description)}</p>
<p>We write for ${escapeHtml(c.niche.audience)}. Every comparison names who a tool is wrong for, because that is the part most reviews leave out.</p>
<p>We fund the site with affiliate commissions. That is disclosed on every page that contains one, and it does not decide what we recommend — see our <a href="/disclosure/">disclosure</a>.</p>`,
    `About ${c.site.name}`,
  ));
  write("disclosure/index.html", staticPage(
    "Affiliate disclosure", "/disclosure/",
    `<h1>Affiliate disclosure</h1>
<p>${escapeHtml(c.compliance.affiliateDisclosure)}</p>
<h2>What this means in practice</h2>
<ul>
<li>Links that earn us a commission pass through <code>/go/</code> and are marked <code>rel="${escapeHtml(c.compliance.linkRel)}"</code>.</li>
<li>A commission never changes a recommendation. Where a tool we earn nothing from is the better answer, we say so.</li>
<li>Prices and plan limits change. We describe them in ranges and link to the vendor's own pricing page.</li>
</ul>`,
    "How this site is funded and how affiliate links are handled.",
  ));
  write("privacy/index.html", staticPage(
    "Privacy Policy", "/privacy/",
    `<h1>Privacy Policy</h1>
<p class="meta">Last updated: ${new Date().toISOString().slice(0, 10)}</p>
<p>This Privacy Policy explains how ${escapeHtml(c.site.name)} (${escapeHtml(c.site.baseUrl)}) handles information
when you visit this website.</p>
<h2>Information we collect</h2>
<p>This is a static site. We do not operate accounts, forms, or logins, and we do not ask visitors for personal
information such as names, email addresses, or payment details.</p>
<p>${c.site.gaMeasurementId
      ? "We use Google Analytics to measure aggregate page views. Google Analytics may use cookies as described in Google's own privacy policy."
      : "We do not run any analytics or tracking scripts on this site."}</p>
<h2>Cookies and third-party links</h2>
<p>Some links on this site are affiliate links to third-party software vendors (see our
<a href="/disclosure/">affiliate disclosure</a>). When you follow one of those links, the vendor's own site may
set a cookie so they can attribute a signup to us. That cookie is set by the vendor, not by this site, and is
governed by the vendor's own privacy policy. You can block cookies in your browser without affecting anything
on this site.</p>
<h2>Contact</h2>
<p>Questions about this policy can be sent through our <a href="${escapeHtml(c.site.baseUrl)}/about/">About page</a>.</p>`,
    `Privacy Policy for ${c.site.name}.`,
  ));
  pages += 3;

  write("admin/index.html", buildAdminPage(c.admin.branch));

  write("sitemap.xml", sitemap(list));
  write("rss.xml", rss(list));
  write("robots.txt", `User-agent: *\nAllow: /\nDisallow: /go/\nDisallow: /admin/\n\nSitemap: ${c.site.baseUrl}/sitemap.xml\n`);
  write(".nojekyll", "");

  const result: BuildResult = {
    pages, articles: list.length, redirects,
    liveAffiliateLinks: redirects - pending.length,
    pendingAffiliateLinks: pending,
  };
  log.ok(`${pages} ページ + 中継リンク ${redirects} 本を public/ に出力しました`);
  if (pending.length) {
    log.warn(`アフィリエイトリンク未登録 ${pending.length} 件（今は公式サイトへ直リンク）: ${pending.join(", ")}`);
  }
  return result;
}
