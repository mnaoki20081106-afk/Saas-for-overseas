import fs from "node:fs";
import path from "node:path";
import { log } from "../../lib/log";
import { P } from "../../lib/paths";
import { articles } from "../../lib/store";
import { nowISO, uid, wordCount } from "../../lib/util";
import { limits } from "../limits";
import { section } from "../report";
import { Review, ReviewSubmission, validate } from "../schemas";
import type { Review as ReviewT } from "../schemas";
import { drafts, reviews } from "../store";
import { addTask } from "./tasks";

/**
 * Editor — ネイティブ英語品質の検品。
 *
 * ★必ず Writer とは別のサブエージェントで動かします。
 *   同じコンテキストで検品すると、自分が書いた文章を擁護してしまいます。
 *   そのため editor:context は **本文しか渡しません**。
 *   企画書も、Writer が何を考えて書いたかも渡しません。
 *
 * Editor が見るのは「読み物として自然か」だけです。
 * 事実の照合・リンクの生存・メタデータは QA の担当です（範囲を重複させない）。
 */

const CHECKLIST = [
  ["literal_translation", "日本語直訳的な英文になっていないか"],
  ["unnatural_phrasing", "不自然な言い回し・コロケーション"],
  ["grammar", "文法"],
  ["vocabulary", "AIっぽい語彙の多用（delve / leverage / robust / seamless など）"],
  ["us_english", "US英語で統一されているか（colour/color の混在など）"],
  ["overclaim", "裏付けのない最上級・断定（アフィリエイト規約違反になる）"],
  ["repetition", "同じ主張の繰り返し"],
  ["logic", "論理の飛躍・根拠のない接続"],
  ["readability", "段落と文の長さ・見出しと中身のずれ"],
  ["search_intent", "読者が知りたいことに答えているか"],
] as const;

/* ---------------------------------------------------------------- context */

export function editorContext(slug: string): void {
  const l = limits();
  const body = drafts.read(slug);
  const prior = reviews.all().filter((r) => r.targetRef === slug && r.reviewer === "editor");
  const round = prior.length + 1;

  if (round > l.quality.maxEditorRounds) {
    log.warn(
      `この記事はすでに ${prior.length} 回検品しています（上限 ${l.quality.maxEditorRounds} 回）。\n` +
      "これ以上は往復せず、needs_human で提出して CEO に判断を戻してください。",
    );
  }

  console.log(`# Editor — 検品（${round} 回目）\n`);

  section("あなたの役割", [
    "あなたはこの記事を書いていません。企画の意図も知りません。**読者としてだけ読んでください。**",
    "",
    "見るのは「読み物として自然か」だけです。次は **あなたの担当ではありません**（QAが見ます）:",
    "  ・製品情報が出典と一致しているか",
    "  ・リンクが生きているか",
    "  ・メタデータ・画像・開示の有無",
    "",
    "Writer を擁護しないでください。前任者の出力は疑ってよく、疑った理由を書いてください。",
  ]);

  if (prior.length) {
    section("前回までの指摘（直っているか確認すること）",
      prior.flatMap((r) => r.findings.map((f) => `- [${f.severity}] ${f.problem}\n    引用: ${f.quote.slice(0, 120)}`)).join("\n"));
  }

  section("チェック項目", CHECKLIST.map(([k, label]) => `- ${k}: ${label}`).join("\n"));

  section("最後に必ず答えること", [
    "SaaS を探している英語圏の実務者として、この記事を通しで読んでください。",
    "",
    "**「途中で読むのをやめたくなった段落」を1つ挙げ、その理由を書いてください。**",
    "挙げられないなら readerImpression に「なし」と書いてください。",
    "挙げた場合は、その段落だけ書き直してください。",
    "",
    "チェックリストを機械的に埋めるだけでは、文章の自然さは測れません。ここが本番です。",
  ]);

  section("判定", [
    "- pass        : そのまま公開してよい",
    "- fix         : 直せば公開してよい（修正後の本文を content/drafts/<slug>.md に上書きしてから提出）",
    "- reject      : 作り直したほうが早い",
    "- needs_human : 判断がつかない。CEO に戻す",
  ]);

  section("提出のしかた", [
    "1. 直す場合は content/drafts/" + slug + ".md を直接書き換える（指摘した箇所だけ）",
    "2. 指摘を JSON に書く（雛形: npm run co -- editor:template）",
    "3. npm run co -- editor:submit <ファイル>",
    "",
    "★ round は書かないでください。co が自動で採番します。",
  ]);

  section(`検品する本文（${wordCount(body)} 語）`, ["```markdown", body, "```"]);
}

export const REVIEW_TEMPLATE = {
  targetType: "article",
  targetRef: "（記事のslug）",
  reviewer: "editor",
  verdict: "fix",
  findings: [{
    category: "overclaim",
    severity: "major",
    quote: "（該当箇所をそのまま引用。省略しない）",
    problem: "（何が問題か）",
    suggestion: "（どう直すか）",
    fixed: true,
  }],
  readerImpression: "（読むのをやめたくなった段落とその理由。なければ「なし」）",
  checklistResults: Object.fromEntries(CHECKLIST.map(([k]) => [k, "pass"])),
};

/* ----------------------------------------------------------------- submit */

/** 下書きを公開対象へ昇格させる（front matter を付けて content/articles/ へ） */
function promote(slug: string): string {
  const a = articles.bySlug(slug);
  if (!a) throw new Error(`記事メタが見つかりません: ${slug}`);
  const body = drafts.read(slug).replace(/^---\n[\s\S]*?\n---\n\n?/, "");
  const esc = (s: string) => s.replace(/"/g, '\\"');
  const frontMatter = [
    "---",
    `title: "${esc(a.title)}"`,
    `slug: "${a.slug}"`,
    `category: "${esc(a.category)}"`,
    `metaTitle: "${esc(a.metaTitle)}"`,
    `metaDescription: "${esc(a.metaDescription)}"`,
    `primaryKeyword: "${esc(a.primaryKeyword)}"`,
    `programs: [${a.programSlugs.map((s) => `"${s}"`).join(", ")}]`,
    `createdAt: "${a.createdAt}"`,
    `updatedAt: "${nowISO()}"`,
    "---",
    "",
  ].join("\n");

  const rel = path.join("content", "articles", `${slug}.md`);
  fs.mkdirSync(path.join(P.root, "content", "articles"), { recursive: true });
  fs.writeFileSync(path.join(P.root, rel), `${frontMatter}${body}\n`, "utf8");
  return rel;
}

export function editorSubmit(file: string): ReviewT {
  if (!fs.existsSync(file)) throw new Error(`ファイルがありません: ${file}`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  const sub = validate(ReviewSubmission, raw, "editor:submit");
  if (sub.reviewer !== "editor") throw new Error('reviewer は "editor" である必要があります');

  const l = limits();
  const slug = sub.targetRef;
  const prior = reviews.all().filter((r) => r.targetRef === slug && r.reviewer === "editor");

  // ★round は AI が自己申告しない。既存件数から co が採番する。
  //   自己申告だと、セッションが落ちて再実行されたときにリセットされ、無限に往復する。
  const round = prior.length + 1;

  let verdict = sub.verdict;
  if (verdict === "fix" && round >= l.quality.maxEditorRounds + 1) {
    verdict = "needs_human";
    log.warn(`${l.quality.maxEditorRounds} 回直しても合格しないため、CEO の判断に回します。`);
  }

  const review: ReviewT = { ...sub, verdict, id: uid("rev"), round, at: nowISO() };
  validate(Review, review, "editor:submit");
  reviews.add(review);

  const a = articles.bySlug(slug);
  if (!a) throw new Error(`記事メタが見つかりません: ${slug}`);

  if (verdict === "pass") {
    const rel = promote(slug);
    const body = fs.readFileSync(path.join(P.root, rel), "utf8");
    articles.upsert({
      ...a,
      filePath: rel,
      status: "published",     // ここでの published は「公開してよい状態」。実際の公開は承認後。
      words: wordCount(body),
      updatedAt: nowISO(),
      qualityIssues: [],
    });
    log.ok(`検品合格: ${slug} → ${rel}`);
    log.info("次はピンの作成です。");
    const task = addTask({ kind: "design_pins", targetRef: slug, createdBy: "editor" });
    log.info(`ピン作成タスク: ${task.id} → designer`);
  } else if (verdict === "needs_human") {
    articles.upsert({ ...a, status: "needs_review", qualityIssues: review.findings.map((f) => f.problem), updatedAt: nowISO() });
    log.human(`${slug} は判断がつきません。CEO が見てください（${review.findings.length} 件の指摘）。`);
  } else {
    articles.upsert({ ...a, status: "drafted", qualityIssues: review.findings.map((f) => f.problem), updatedAt: nowISO() });
    log.warn(`検品 ${verdict}: ${slug}（${review.findings.length} 件の指摘 / ${round} 回目）`);
    if (verdict === "fix") {
      log.info("Writer が直したら、もう一度 editor:submit してください。");
    }
  }

  const unfixed = review.findings.filter((f) => !f.fixed);
  if (unfixed.length) {
    log.warn(`未修正の指摘が ${unfixed.length} 件あります:`);
    unfixed.forEach((f) => log.warn(`  ・[${f.severity}] ${f.problem}`));
  }
  return review;
}
