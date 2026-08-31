import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "../lib/config";
import { longform, structured, withFixture } from "../lib/claude";
import { log } from "../lib/log";
import { articles, programs, state } from "../lib/store";
import { P } from "../lib/paths";
import type { Article, ArticleBrief, Program } from "../lib/types";
import { matches, nowISO, slugify, wordCount } from "../lib/util";

/* ------------------------------------------------------------------ types */

const ARTICLE_TYPES = ["comparison", "alternatives", "best-for-pain", "deep-review"] as const;
type ArticleType = (typeof ARTICLE_TYPES)[number];

const Brief = z.object({
  title: z.string().describe("Article H1. Specific, no year, no clickbait. Under 70 characters if possible. " +
    "Vary the pattern across articles -- a direct comparison ('X vs Y'), a first-person narrative " +
    "('Why I Switched From X to Y'), and a decision-framed title ('X for Teams Under 10 People') are " +
    "all legitimate; using the same pattern for every article reads as templated."),
  metaTitle: z.string().describe("<=60 characters, includes the primary keyword"),
  metaDescription: z.string().describe("140-158 characters, states the concrete takeaway"),
  slug: z.string().describe("lowercase-hyphenated URL slug, no year"),
  primaryKeyword: z.string(),
  secondaryKeywords: z.array(z.string()).describe("6-10 realistic long-tail queries"),
  searchIntent: z.string().describe("What the reader is actually trying to decide"),
  painPoints: z.array(z.string()).describe("4-6 concrete pains, in the reader's own words"),
  angle: z.string().describe("The one honest opinion this article commits to"),
  outline: z.array(z.object({
    heading: z.string().describe("H2 text"),
    purpose: z.string(),
    bullets: z.array(z.string()),
  })).describe("7-11 H2 sections including an explicit 'who should not buy this' section"),
  faq: z.array(z.object({ q: z.string(), a: z.string() })).describe("5-7 FAQs, answers 40-70 words"),
});

/* ---------------------------------------------------------------- prompts */

const WRITER_SYSTEM = `You are a professional SaaS review writer with ten years of hands-on operations
experience at small agencies. You have personally paid for, migrated between, and cancelled the tools
you write about.

How you write:
- First person, specific, and unglamorous. You sound like a practitioner, not a marketer.
- Every claim is either checkable (pricing tier, feature name, limit) or clearly framed as your opinion.
- You lead with the decision, not with a history of the category.
- You always name who a tool is WRONG for. That is the section readers trust you for.
- You use concrete numbers, real workflows, and small specific details (what broke, what took 20 minutes).
- You never make an unsubstantiated superlative or absolute claim ("the best", "#1", "guaranteed",
  "nothing else comes close", "the only tool you'll ever need"). Every strong claim is qualified by
  who it's true for ("the best fit if your team is under 10 people", not "the best"). This matters
  for both reader trust and affiliate-program compliance -- most networks prohibit unsubstantiated
  superlatives in the terms you agreed to when you got approved.
- You never use: exclamation marks, "in today's fast-paced world", "game-changer", "delve", "unleash",
  "revolutionize", "look no further", "supercharge", or any phrase that dates the article
  (no years, no "latest", no "recently", no "at the time of writing").
- The article must still read as correct and current two years from now. Write stock, not news.
- Prices change, so you always write pricing as "starts around $X per month on their entry plan"
  and tell the reader to confirm on the vendor's pricing page.

Formatting rules:
- Markdown. One H1 at the top, then H2/H3.
- Short paragraphs (2-4 sentences). Use tables for feature/price comparisons.
- Affiliate links MUST be written as the exact placeholder {{link:PROGRAM_SLUG}} used as a markdown
  URL, e.g. [start a free trial]({{link:acme-crm}}). Never write a raw vendor URL for a tracked product.
- Internal links to our other articles use [anchor text](/articles/SLUG/).
- Do not write a disclosure paragraph; the site inserts one automatically above the article.`;

function briefPrompt(main: Program, others: Program[], type: ArticleType, existing: Article[]): string {
  const c = config();
  const existingList = existing.length
    ? existing.map((a) => `- /articles/${a.slug}/ — "${a.title}" (${a.category})`).join("\n")
    : "(no articles published yet)";

  const shape: Record<ArticleType, string> = {
    comparison: `A head-to-head comparison: ${main.name} vs ${main.mainCompetitors.slice(0, 2).join(" vs ")}. The reader is deciding between them right now.`,
    alternatives: `An "alternatives to X" article where X is ${main.mainCompetitors[0] ?? "the category leader"}, and ${main.name} is one of the honest recommendations (not automatically the winner).`,
    "best-for-pain": `A "best ${main.category} tools for <specific situation>" roundup built around one concrete pain from the list below, where ${main.name} wins for a clearly defined type of team.`,
    "deep-review": `A single-product deep review of ${main.name} written after real use, including the parts that annoyed us and the migration cost.`,
  };

  return `Plan one evergreen English article.

## Article shape
${shape[type]}

## Product we can earn recurring commission on
- ${main.name} (${main.category}) — ${main.homepage}
- program slug (use for {{link:...}} placeholders): ${main.slug}
- entry price: about $${main.pricingFromUsd}/month
- why it fits us: ${main.whyGoodFit}
- buyer pains we know about: ${main.targetPains.join("; ")}
- competitors: ${main.mainCompetitors.join(", ")}

## Other products we can also earn on (mention only where genuinely relevant)
${others.length ? others.map((p) => `- ${p.name} (${p.category}, slug: ${p.slug})`).join("\n") : "(none)"}

## Reader
${c.niche.audience}. Buying for ${c.niche.geoFocus.join("/")}.

## Our existing articles (for internal links)
${existingList}

## Constraints
- Target length ${c.content.wordsMin}-${c.content.wordsMax} words.
- Absolutely no time-sensitive language. This article must be correct in two years.
- The outline must include a section that names who should NOT buy the recommended tool.
- Tone: ${c.content.toneNotes}

Produce the plan.`;
}

function writePrompt(brief: ArticleBrief, main: Program, others: Program[], existing: Article[]): string {
  const c = config();
  const outline = brief.outline
    .map((s, i) => `${i + 1}. ## ${s.heading}\n   purpose: ${s.purpose}\n   cover: ${s.bullets.join("; ")}`)
    .join("\n");
  const internal = existing.slice(0, 12).map((a) => `- [/articles/${a.slug}/] "${a.title}"`).join("\n") || "(none yet)";

  return `Write the full article now.

# Title
${brief.title}

# Primary keyword
${brief.primaryKeyword}

# Secondary keywords to work in naturally (never stuff)
${brief.secondaryKeywords.join(", ")}

# Search intent
${brief.searchIntent}

# The honest angle this article commits to
${brief.angle}

# Reader pains (use their language)
${brief.painPoints.map((p) => `- ${p}`).join("\n")}

# Outline to follow
${outline}

# FAQ section to include at the end as "## Frequently asked questions" with H3 questions
${brief.faq.map((f) => `- ${f.q}`).join("\n")}

# Affiliate link placeholders available
- ${main.name} → {{link:${main.slug}}}
${others.map((p) => `- ${p.name} → {{link:${p.slug}}}`).join("\n")}
Use the placeholder 3-5 times total, on natural anchor text ("start their free trial",
"check current pricing on their site"). Never as a bare URL. Never more than once per paragraph.

# Internal links — include at least ${c.content.internalLinksMin} if any exist
${internal}

# Hard requirements
- ${c.content.wordsMin}-${c.content.wordsMax} words.
- Start with a single H1 line: "# ${brief.title}"
- Then a 3-4 sentence opening that states the recommendation immediately. No throat-clearing.
- At least one markdown comparison table.
- One section that names who should NOT buy the main recommendation, with real reasons.
- Never mention a year, "latest", "new", "recently", "currently", or "at the time of writing".
- Never state an exact price as fact — write "starts around $X/month on their entry plan" and
  point the reader to the vendor's pricing page.
- End with a short "## The short version" recap of 4-6 bullets.

Output ONLY the markdown article. No preamble, no explanation.`;
}

/* --------------------------------------------------------------- fixtures */

function fixtureBrief(main: Program): z.infer<typeof Brief> {
  return {
    title: `${main.name} vs ${main.mainCompetitors[0] ?? "the alternatives"}: which one small teams actually keep`,
    metaTitle: `${main.name} vs ${main.mainCompetitors[0] ?? "alternatives"}: an honest comparison`,
    metaDescription: `A hands-on comparison of ${main.name} and its main alternative for small teams, including the setup costs and the cases where neither is the right answer.`,
    slug: slugify(`${main.name} vs ${main.mainCompetitors[0] ?? "alternatives"}`),
    primaryKeyword: `${main.name.toLowerCase()} vs ${(main.mainCompetitors[0] ?? "alternatives").toLowerCase()}`,
    secondaryKeywords: [`${main.name} pricing`, `${main.name} review`, `${main.category} for small teams`],
    searchIntent: "Choosing between two shortlisted tools before starting a trial.",
    painPoints: main.targetPains,
    angle: "Sample DRY_RUN brief. Not for publication.",
    outline: [
      { heading: "The short answer", purpose: "state the recommendation", bullets: ["who each tool suits"] },
      { heading: "Who should not buy it", purpose: "honesty", bullets: ["team size limits", "migration cost"] },
    ],
    faq: [{ q: "Is there a free plan?", a: "Sample answer for DRY_RUN mode." }],
  };
}

function fixtureArticle(brief: ArticleBrief, main: Program, existing: Article[]): string {
  // DRY_RUN でも品質ゲートを通る長さと構造にしておく（サイトの見え方を確認できるように）
  const filler = (topic: string) =>
    [
      `This is placeholder prose generated in DRY_RUN mode so the whole pipeline can be exercised without calling the API. It stands in for the real discussion of ${topic}.`,
      `In a real run this section would carry specific numbers, a named workflow, and the exact point at which ${main.name} stops being the obvious answer for a team of this size.`,
      `The writing model is told to sound like someone who paid for the tool, migrated onto it, and can describe what broke. None of that is present here, because no model was called.`,
      `Set ANTHROPIC_API_KEY and run the pipeline again to replace every paragraph on this page with real, quality-gated copy.`,
    ].join(" ");

  const internal = existing
    .slice(0, 3)
    .map((a) => `If you are also weighing this against another category, see [${a.title}](/articles/${a.slug}/).`)
    .join(" ");

  const sections = [
    ["The short answer", "the recommendation itself"],
    ["What it actually costs once you are past the entry plan", "pricing beyond the headline number"],
    ["Setup and migration", "the first two weeks of ownership"],
    ["Where it beats the alternatives", "the genuine strengths"],
    ["Who should not buy it", "the teams this is wrong for"],
    ["What we would use instead in that case", "the honest alternative"],
    ["The limits nobody mentions on the entry plan", "the caps you meet in month two"],
    ["How it holds up once the team doubles", "scaling past the first five seats"],
  ];

  return [
    `# ${brief.title}`,
    "",
    `${main.name} is the sample product used by DRY_RUN mode. This opening states the recommendation immediately, the way the real writer prompt requires, and then gets out of the way.`,
    "",
    ...sections.flatMap(([heading, topic], i) => [
      `## ${heading}`,
      "",
      filler(topic),
      "",
      filler(`${topic}, continued`),
      "",
      i === 0
        ? `You can [start their free trial]({{link:${main.slug}}}) and confirm the current plan limits on their own pricing page.`
        : i === 3
          ? `Their entry tier is the one most small teams land on; [check what it includes]({{link:${main.slug}}}) before committing.`
          : filler(`${topic}, in practice`),
      "",
    ]),
    "## Feature comparison",
    "",
    `| Feature | ${main.name} | ${main.mainCompetitors[0] ?? "Alternative"} |`,
    "| --- | --- | --- |",
    `| Entry price | starts around $${main.pricingFromUsd}/month | comparable |`,
    "| Seat model | per user | per user |",
    "| Data export | included | limited on entry plan |",
    "",
    internal,
    "",
    "## Frequently asked questions",
    "",
    "### Is there a free plan?",
    "",
    "Sample answer used only in DRY_RUN mode. The real article answers this from the vendor's own plan page and says what the free tier is missing.",
    "",
    "### How long does migration take?",
    "",
    "Sample answer used only in DRY_RUN mode. The real article gives a range based on how many records you are moving.",
    "",
    "## The short version",
    "",
    `- ${main.name} suits a specific kind of team, and this recap names it`,
    "- The entry plan is the one most readers will land on",
    "- Migration is the real cost, not the subscription",
    "- There is a clear case where you should pick something else",
    `- Everything above is placeholder text from DRY_RUN mode`,
  ].join("\n");
}

/* --------------------------------------------------------- quality gates */

export interface QualityReport { ok: boolean; issues: string[]; words: number }

export function checkQuality(markdown: string, brief: ArticleBrief, existingCount: number): QualityReport {
  const c = config();
  const issues: string[] = [];
  const words = wordCount(markdown);

  if (words < c.content.wordsMin - 150) issues.push(`短すぎ: ${words} words (目標 ${c.content.wordsMin}+)`);
  if (words > c.content.wordsMax + 900) issues.push(`長すぎ: ${words} words`);

  const lower = markdown.toLowerCase();
  for (const phrase of c.content.bannedPhrases) {
    if (lower.includes(phrase.toLowerCase())) issues.push(`禁止表現: "${phrase}"`);
  }
  if (/\b(19|20)\d{2}\b/.test(markdown.replace(/\$\d+/g, ""))) {
    issues.push("西暦が本文に含まれています（記事が古びる原因）");
  }
  if (/!/.test(markdown.replace(/\[[^\]]*\]\([^)]*\)/g, ""))) {
    issues.push("感嘆符が使われています");
  }

  const h1 = matches(markdown, /^# .+$/gm);
  if (h1.length !== 1) issues.push(`H1 が ${h1.length} 個（1個であるべき）`);

  const h2 = matches(markdown, /^## .+$/gm).map((s) => s.toLowerCase());
  if (h2.length < 5) issues.push(`H2 が ${h2.length} 個しかありません`);
  if (new Set(h2).size !== h2.length) issues.push("重複した H2 見出しがあります");

  if (!/\|.+\|/.test(markdown)) issues.push("比較テーブルがありません");

  const placeholders = matches(markdown, /\{\{link:[a-z0-9-]+\}\}/g);
  if (placeholders.length === 0) issues.push("アフィリエイトリンクのプレースホルダが 0 個です");
  if (placeholders.length > 7) issues.push(`リンクが多すぎます (${placeholders.length} 個)`);
  if (!brief.programSlugs.some((s) => placeholders.includes(`{{link:${s}}}`))) {
    issues.push("メイン案件へのリンクがありません");
  }

  const internal = matches(markdown, /\]\(\/articles\/[a-z0-9-]+\/\)/g);
  const wantInternal = Math.min(c.content.internalLinksMin, existingCount);
  if (internal.length < wantInternal) {
    issues.push(`内部リンクが ${internal.length} 個（${wantInternal} 個以上必要）`);
  }

  return { ok: issues.length === 0, issues, words };
}

const AccuracyReview = z.object({
  flaggedClaims: z.array(z.string()).describe(
    "One line per claim that was softened: what it said, why it overreached, how it now reads. Empty array if nothing was flagged.",
  ),
  correctedMarkdown: z.string().describe(
    "The full article. Identical to the input except for the specific sentences listed in flaggedClaims.",
  ),
});

const ACCURACY_REVIEWER_SYSTEM = `You are a skeptical editor whose only job, on a second pass, is to
catch overclaiming before an article about SaaS products is published. You did not write it and have
no attachment to the wording.

Read the article for exactly one class of problem: claims stated as settled fact that are not
checkable, or that overreach beyond what a reviewer could actually know. This includes:
- Absolute or superlative claims not qualified to a specific audience ("the best", "guaranteed",
  "nothing else comes close") -- including ones worded differently from any banned-phrase list, since
  the same overclaiming shows up in many different words.
- An opinion stated as settled fact ("X is faster than Y") instead of framed as one ("in our
  experience, X felt faster for Y-sized teams").
- A specific number or detail that reads as invented rather than grounded in something stated
  elsewhere in the article or in general knowledge about the product category.
- A claim about a competitor the article gives no basis for.

For every problem found, rewrite ONLY that sentence or clause -- qualify it, frame it as opinion, or
soften it -- without weakening the actual recommendation or making the article wishy-washy. Leave every
other sentence byte-for-byte unchanged, including all {{link:slug}} placeholders, headings, and the
markdown table. If nothing needs fixing, return the article completely unchanged and an empty list.`;

/**
 * 品質ゲートの構造チェック(語数・見出し・リンク数)とは独立に、
 * 「誇張していないか・裏付けのない断定をしていないか」だけを専門に見る第2の目。
 * 記事本文の生成直後、毎回必ず1回通す。
 */
async function accuracyReview(
  markdown: string,
  brief: ArticleBrief,
): Promise<{ markdown: string; flagged: string[] }> {
  const result = await withFixture(
    () => ({ correctedMarkdown: markdown, flaggedClaims: [] as string[] }),
    () =>
      structured(AccuracyReview, {
        system: ACCURACY_REVIEWER_SYSTEM,
        user: `Review this article for overclaiming and fix only what needs fixing.

## Title
${brief.title}

## Article
${markdown}`,
        stage: "repair",
        label: "誇張・事実確認レビュー",
        effort: "medium",
        maxTokens: 32000,
      }),
  );
  return { markdown: result.correctedMarkdown, flagged: result.flaggedClaims };
}

async function repair(markdown: string, issues: string[], brief: ArticleBrief): Promise<string> {
  log.warn(`品質ゲート不合格 → 自動修正を試みます (${issues.length} 件)`);
  return longform({
    system: WRITER_SYSTEM,
    user: `Below is a draft article and a list of defects found by our automated quality gate.
Rewrite the article so every defect is fixed. Change nothing else — keep the structure, the voice,
and the affiliate link placeholders. Output ONLY the corrected markdown.

## Defects (each one must be fixed)
${issues.map((i) => `- ${i}`).join("\n")}

## Required title
${brief.title}

## Draft
${markdown}`,
    stage: "repair",
    label: "記事の自動修正",
    effort: "high",
    maxTokens: 32000,
  });
}

/* ------------------------------------------------------------ orchestration */

function pickProgram(): { main: Program; others: Program[]; type: ArticleType } | null {
  const all = programs.all().filter((p) => p.status !== "rejected" && p.status !== "paused");
  if (all.length === 0) return null;

  const written = articles.all();
  const countFor = (slug: string) => written.filter((a) => a.programSlugs.includes(slug)).length;
  const recentCategories = written.slice(-3).map((a) => a.category);

  const ranked = [...all].sort((a, b) => {
    const aPenalty = countFor(a.slug) * 40 + (recentCategories.includes(a.category) ? 25 : 0);
    const bPenalty = countFor(b.slug) * 40 + (recentCategories.includes(b.category) ? 25 : 0);
    return b.score - bPenalty - (a.score - aPenalty);
  });

  const main = ranked[0];
  const others = ranked.slice(1).filter((p) => p.category === main.category).slice(0, 3);
  const cursor = state.get().cursor;
  const type = ARTICLE_TYPES[(countFor(main.slug) + cursor) % ARTICLE_TYPES.length];
  return { main, others, type };
}

function frontMatter(a: Article): string {
  const esc = (s: string) => s.replace(/"/g, '\\"');
  return [
    "---",
    `title: "${esc(a.title)}"`,
    `slug: "${a.slug}"`,
    `category: "${esc(a.category)}"`,
    `metaTitle: "${esc(a.metaTitle)}"`,
    `metaDescription: "${esc(a.metaDescription)}"`,
    `primaryKeyword: "${esc(a.primaryKeyword)}"`,
    `programs: [${a.programSlugs.map((s) => `"${s}"`).join(", ")}]`,
    `createdAt: "${a.createdAt}"`,
    `updatedAt: "${a.updatedAt}"`,
    "---",
    "",
  ].join("\n");
}

export function readArticleBody(a: Article): string {
  const raw = fs.readFileSync(path.join(P.root, a.filePath), "utf8");
  return raw.replace(/^---\n[\s\S]*?\n---\n\n?/, "");
}

export interface WriteResult { article: Article; quality: QualityReport }

export async function writeOneArticle(): Promise<WriteResult | null> {
  log.step("STEP 2 / 英語記事を1本つくる（ペイン設計 → 構成 → 本文 → 品質ゲート）");

  const picked = pickProgram();
  if (!picked) {
    log.warn("案件が0件です。先に `npm run autopilot research` を実行してください。");
    return null;
  }
  const { main, others, type } = picked;
  log.info(`対象: ${main.name} / 形式: ${type}`);

  const existing = articles.all();

  const briefRaw = await withFixture(
    () => fixtureBrief(main),
    () =>
      structured(Brief, {
        system: WRITER_SYSTEM,
        user: briefPrompt(main, others, type, existing),
        stage: "brief",
        label: "記事の設計（ペイン + 構成）",
        effort: "high",
        maxTokens: 12000,
      }),
  );

  let slug = slugify(briefRaw.slug || briefRaw.title);
  if (existing.some((a) => a.slug === slug)) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  const brief: ArticleBrief = {
    ...briefRaw,
    slug,
    audience: config().niche.audience,
    programSlugs: [main.slug, ...others.map((p) => p.slug)],
  };

  let markdown = await withFixture(
    () => fixtureArticle(brief, main, existing),
    () =>
      longform({
        system: WRITER_SYSTEM,
        user: writePrompt(brief, main, others, existing),
        stage: "article",
        label: `本文執筆: ${brief.title}`,
        effort: "high",
        maxTokens: 32000,
      }),
  );
  markdown = markdown.replace(/^```(?:markdown|md)?\n?/, "").replace(/\n?```\s*$/, "").trim();

  const accuracy = await accuracyReview(markdown, brief);
  markdown = accuracy.markdown.replace(/^```(?:markdown|md)?\n?/, "").replace(/\n?```\s*$/, "").trim();
  if (accuracy.flagged.length) {
    log.warn(`誇張・事実確認レビューで ${accuracy.flagged.length} 件を修正しました:`);
    accuracy.flagged.forEach((f) => log.warn(`   - ${f}`));
  }

  let quality = checkQuality(markdown, brief, existing.length);
  if (!quality.ok) {
    try {
      const fixed = await repair(markdown, quality.issues, brief);
      const cleaned = fixed.replace(/^```(?:markdown|md)?\n?/, "").replace(/\n?```\s*$/, "").trim();
      const after = checkQuality(cleaned, brief, existing.length);
      if (after.issues.length < quality.issues.length) {
        markdown = cleaned;
        quality = after;
      }
    } catch (err) {
      log.warn(`自動修正をスキップ: ${(err as Error).message}`);
    }
  }

  const article: Article = {
    slug,
    title: brief.title,
    metaTitle: brief.metaTitle,
    metaDescription: brief.metaDescription,
    primaryKeyword: brief.primaryKeyword,
    secondaryKeywords: brief.secondaryKeywords,
    category: main.category,
    programSlugs: brief.programSlugs,
    filePath: path.join("content", "articles", `${slug}.md`),
    words: quality.words,
    status: quality.ok ? "published" : "needs_review",
    createdAt: nowISO(),
    updatedAt: nowISO(),
    qualityIssues: quality.issues,
    internalLinks: matches(markdown, /\/articles\/[a-z0-9-]+\//g).map((s) => s.replace(/\/articles\/|\//g, "")),
    brief,
  };

  fs.mkdirSync(P.contentDir, { recursive: true });
  fs.writeFileSync(path.join(P.root, article.filePath), `${frontMatter(article)}${markdown}\n`, "utf8");
  articles.upsert(article);
  state.patch({ lastArticleAt: nowISO(), cursor: state.get().cursor + 1 });

  if (quality.ok) log.ok(`記事完成: ${article.title} (${quality.words} words)`);
  else {
    log.warn(`記事は保存しましたが要確認 (${quality.issues.length} 件): ${article.filePath}`);
    quality.issues.forEach((i) => log.warn(`   - ${i}`));
  }
  return { article, quality };
}
