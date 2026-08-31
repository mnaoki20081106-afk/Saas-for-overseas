import fs from "node:fs";
import path from "node:path";
import { config } from "../../lib/config";
import { log } from "../../lib/log";
import { P } from "../../lib/paths";
import { articles, programs } from "../../lib/store";
import type { Article, ArticleBrief } from "../../lib/types";
import { matches, nowISO, slugify, wordCount } from "../../lib/util";
import { checkQuality } from "../../stages/content";
import { DuplicateError, findHeadingDuplicate, findKeywordDuplicate } from "../dedupe";
import { limits } from "../limits";
import { kv, section } from "../report";
import { drafts, ideas } from "../store";
import { addTask } from "./tasks";

/**
 * Writer — 英語記事を書く係。
 *
 * 従来は Claude API の longform() が本文を生成していました。
 * 移行後は Claude Code のセッションが content/drafts/<slug>.md を直接書きます。
 *
 * 品質の担保は変わりません。**既存の checkQuality() をそのまま使います。**
 * つまり「誰が書くか」だけが変わり、「合格の基準」は完全に同じです。
 *
 * Writer は content/articles/ に直接書けません。Editor を通ってからです。
 */

/** 記事の型ごとの目標語数。固定値ではなく、検索意図と競合から決める。 */
const WORD_TARGETS: Record<string, [number, number]> = {
  comparison: [1800, 2600],       // 読者は結論を急いでいる
  alternatives: [2200, 3200],
  "best-for-pain": [2800, 4000],  // 比較対象が多い
  "deep-review": [2400, 3600],
};

export function wordTargetFor(articleType: string, competitorWordCounts: number[]): [number, number] {
  const base = WORD_TARGETS[articleType] ?? [2400, 3200];
  if (competitorWordCounts.length < 3) return base;
  // 競合上位の中央値 ±20% を目標にする（実測があるならそちらを優先）
  const sorted = [...competitorWordCounts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return [Math.round(median * 0.8), Math.round(median * 1.2)];
}

/* ---------------------------------------------------------------- context */

export function writerContext(ideaId: string): void {
  const c = config();
  const idea = ideas.all().find((i) => i.id === ideaId || i.workingTitle === ideaId);
  if (!idea) {
    throw new Error(
      `企画が見つかりません: ${ideaId}\n` +
      `いまある企画: ${ideas.all().map((i) => `${i.id}(${i.status})`).join(", ") || "なし"}`,
    );
  }
  const main = programs.bySlug(idea.programSlug);
  if (!main) throw new Error(`案件が見つかりません: ${idea.programSlug}`);
  const others = idea.supportingProgramSlugs
    .map((s) => programs.bySlug(s))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  const existing = articles.all();
  const [minWords, maxWords] = wordTargetFor(idea.articleType, idea.competitorWordCounts);

  console.log(`# Writer — 「${idea.workingTitle}」を書く\n`);

  section("この記事の設計", kv([
    ["企画ID", idea.id],
    ["記事の型", idea.articleType],
    ["主キーワード", idea.primaryKeyword],
    ["副キーワード", idea.secondaryKeywords.join(", ")],
    ["検索意図", idea.searchIntent],
    ["目標語数", `${minWords}〜${maxWords} 語（競合の実測 ${idea.competitorWordCounts.join(", ") || "未計測"}）`],
  ]));

  section("主役の製品", [
    kv([
      ["製品名", main.name],
      ["カテゴリ", main.category],
      ["公式サイト", main.homepage],
      ["リンク用のスラッグ", `{{link:${main.slug}}} ← 本文ではこの形で書く`],
      ["入口価格", `約 $${main.pricingFromUsd}/月`],
      ["競合", main.mainCompetitors.join(", ")],
      ["この案件を選んだ理由", main.whyGoodFit],
    ]),
    "",
    `読者の悩み: ${main.targetPains.map((p) => `\n  ・${p}`).join("")}`,
  ]);

  if (others.length) {
    section("触れてもよい他の製品（本当に関係あるときだけ）",
      others.map((p) => `- ${p.name}（${p.category}） → {{link:${p.slug}}}`).join("\n"));
  }

  section("読者", kv([
    ["誰か", c.niche.audience],
    ["どこの人か", c.niche.geoFocus.join(" / ")],
  ]));

  section("内部リンクに使える既存記事",
    existing.length
      ? existing.slice(0, 12).map((a) => `- [/articles/${a.slug}/] "${a.title}"`).join("\n")
      : "（まだ1本もありません。内部リンクは不要です）");

  section("守ること（これを外すと品質ゲートで落ちます）", [
    `- ${minWords}〜${maxWords} 語。`,
    "- H1 はちょうど1つ。冒頭の1行に `# タイトル` を書く。",
    "- H2 は5つ以上。重複しないこと。",
    "- 比較テーブルを最低1つ入れる。",
    `- {{link:${main.slug}}} を 1〜7 回使う。**生のURLは書かない。**`,
    `- 内部リンクを ${Math.min(c.content.internalLinksMin, existing.length)} 本以上（既存記事がある場合）。`,
    "- **西暦・「最新」「最近」「現在」「今年」を書かない。** 2年後に読んでも正しい記事にする。",
    "- 感嘆符を使わない。",
    "- 価格は断定しない。\"starts around $X per month on their entry plan\" と書き、公式ページの確認を促す。",
    "- 「誰にとって不向きか」のセクションを必ず1つ入れる。ここが読者の信頼を作る。",
    "- 裏付けのない最上級表現（the best / guaranteed / #1）を書かない。**アフィリエイト規約違反になります。**",
    "- 開示文は書かない。サイト側が自動で挿入します。",
  ]);

  section("書き方の姿勢", c.content.toneNotes);

  section("提出のしかた", [
    `1. content/drafts/${idea.primaryKeyword ? slugify(idea.workingTitle) : "<slug>"}.md に本文を書く`,
    "2. npm run co -- writer:check <slug>    ← 品質ゲート。落ちたら直してもう一度",
    "3. npm run co -- writer:submit <slug>   ← 合格したら提出。Editor に回る",
  ]);
}

/* ------------------------------------------------------------------ check */

/** 企画から最小限の brief を組み立てる（checkQuality が要求するため） */
function briefFromIdea(slug: string): ArticleBrief {
  const idea = ideas.all().find((i) => slugify(i.workingTitle) === slug || i.id === slug);
  if (!idea) {
    throw new Error(
      `この下書きに対応する企画が見つかりません: ${slug}\n` +
      "先に企画（ideas.json）を作ってください。企画のない記事は書けません。",
    );
  }
  return {
    slug,
    title: idea.workingTitle,
    metaTitle: idea.workingTitle.slice(0, 60),
    metaDescription: idea.searchIntent.slice(0, 158),
    primaryKeyword: idea.primaryKeyword,
    secondaryKeywords: idea.secondaryKeywords,
    searchIntent: idea.searchIntent,
    audience: config().niche.audience,
    painPoints: [],
    angle: idea.searchIntent,
    programSlugs: [idea.programSlug, ...idea.supportingProgramSlugs],
    outline: [],
    faq: [],
  };
}

export interface WriterCheckResult {
  ok: boolean;
  words: number;
  issues: string[];
  duplicates: string[];
}

export function writerCheck(slug: string): WriterCheckResult {
  const l = limits();
  const markdown = drafts.read(slug);
  const brief = briefFromIdea(slug);
  const existing = articles.all();
  const idea = ideas.all().find((i) => slugify(i.workingTitle) === slug || i.id === slug);

  // ① 既存の品質ゲートをそのまま使う（api 経路と完全に同じ基準）。
  //    ただし語数だけは企画が決めた目標を使う。記事の適切な長さは
  //    検索意図と競合の分量で変わるので、全記事一律の固定値では測れない。
  const range = idea
    ? wordTargetFor(idea.articleType, idea.competitorWordCounts)
    : undefined;
  const quality = checkQuality(markdown, brief, existing.length, range);
  const issues = [...quality.issues];
  const duplicates: string[] = [];

  // ② 重複チェック（AI に「重複しないで」と頼まず、機械的に弾く）
  if (l.duplication.requireUniquePrimaryKeyword) {
    const hit = findKeywordDuplicate(
      brief.primaryKeyword,
      existing.map((a) => ({ slug: a.slug, primaryKeyword: a.primaryKeyword })),
    );
    if (hit && hit.existingRef !== slug) duplicates.push(hit.detail);
  }
  const bodies = existing
    .filter((a) => a.slug !== slug)
    .map((a) => ({ slug: a.slug, body: readPublished(a) }))
    .filter((x) => x.body.length > 0);
  const overlap = findHeadingDuplicate(markdown, bodies, l.duplication.articleHeadingOverlapMaxPct);
  if (overlap) duplicates.push(overlap.detail);

  const result: WriterCheckResult = {
    ok: issues.length === 0 && duplicates.length === 0,
    words: quality.words,
    issues,
    duplicates,
  };

  console.log(`\n# 品質ゲート: ${slug}\n`);
  console.log(`語数: ${result.words}`);
  if (result.ok) {
    log.ok("合格しました。`writer:submit` で提出できます。");
  } else {
    if (issues.length) {
      console.log("\n## 直すべき点\n");
      issues.forEach((i) => console.log(`  ・${i}`));
    }
    if (duplicates.length) {
      console.log("\n## 重複\n");
      duplicates.forEach((d) => console.log(`  ・${d}`));
    }
    console.log("\n直したら、もう一度同じコマンドを実行してください。");
  }
  return result;
}

function readPublished(a: Article): string {
  const full = path.join(P.root, a.filePath);
  if (!fs.existsSync(full)) return "";
  return fs.readFileSync(full, "utf8").replace(/^---\n[\s\S]*?\n---\n\n?/, "");
}

/* ----------------------------------------------------------------- submit */

export function writerSubmit(slug: string): Article {
  const check = writerCheck(slug);
  if (!check.ok) {
    throw new Error(
      "品質ゲートに合格していないので提出できません。上の指摘をすべて直してください。\n" +
      "どうしても直せない場合は、この仕事を task:fail で失敗にして CEO に判断を戻してください。",
    );
  }
  if (check.duplicates.length) {
    throw new DuplicateError(check.duplicates.map((d) => ({
      kind: "headingOverlap" as const, existingRef: slug, detail: d,
    })));
  }

  const markdown = drafts.read(slug);
  const idea = ideas.all().find((i) => slugify(i.workingTitle) === slug || i.id === slug);
  if (!idea) throw new Error(`企画が見つかりません: ${slug}`);
  const main = programs.bySlug(idea.programSlug);
  if (!main) throw new Error(`案件が見つかりません: ${idea.programSlug}`);

  const h1 = matches(markdown, /^# .+$/m)[0]?.replace(/^# /, "").trim() ?? idea.workingTitle;

  const article: Article = {
    slug,
    title: h1,
    metaTitle: h1.slice(0, 60),
    metaDescription: idea.searchIntent.slice(0, 158),
    primaryKeyword: idea.primaryKeyword,
    secondaryKeywords: idea.secondaryKeywords,
    category: main.category,
    programSlugs: [idea.programSlug, ...idea.supportingProgramSlugs],
    // ★ここが要点: 下書きの段階では content/drafts/ を指す。
    //   Editor が合格させて初めて content/articles/ に移り、サイトに載る。
    filePath: path.join("content", "drafts", `${slug}.md`),
    words: wordCount(markdown),
    status: "drafted",
    createdAt: nowISO(),
    updatedAt: nowISO(),
    qualityIssues: [],
    internalLinks: matches(markdown, /\/articles\/[a-z0-9-]+\//g).map((s) => s.replace(/\/articles\/|\//g, "")),
  };

  articles.upsert(article);
  ideas.replace((i) => i.id === idea.id, { status: "writing" });

  // 次の工程（検品）を自動で積む。AI が積み忘れることを許さない。
  const task = addTask({ kind: "edit_article", targetRef: slug, createdBy: "ken" });
  log.ok(`提出しました: ${slug}（${article.words} 語）`);
  log.info(`検品タスクを作成: ${task.id} → editor`);
  return article;
}
