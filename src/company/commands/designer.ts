import fs from "node:fs";
import path from "node:path";
import { config } from "../../lib/config";
import { log } from "../../lib/log";
import { P } from "../../lib/paths";
import { articles, pins as pinStore } from "../../lib/store";
import type { Pin } from "../../lib/types";
import { uid } from "../../lib/util";
import { TEMPLATE_IDS } from "../../pins/templates";
import { renderPins, type RenderRequest } from "../../pins/render";
import { templateRanking } from "../../stages/optimize";
import { DuplicateError, findPinCopyDuplicate, hashFile, hashText } from "../dedupe";
import { isColdStart, limits } from "../limits";
import { kv, section } from "../report";
import { PinSubmission, validate } from "../schemas";
import { ideas } from "../store";
import { addTask } from "./tasks";

/**
 * Designer — Pinterest のクリエイティブを設計する係。
 *
 * 画像そのものは作りません。テンプレートIDと文言を決めるだけです。
 * 画像は Actions が Chromium で描画します（1枚 $0）。
 *
 * コールドスタート中（実測データが貯まるまで）は「どれが効くか」を判断せず、
 * テンプレート・配色・切り口を機械的に一巡させます。
 * データを作るのが目的であって、最適化が目的ではないからです。
 */

/** 10通りの「約束の形」。1記事のピンは全部違う切り口にする。 */
export const ANGLE_TYPES = [
  ["price-objection", "価格の壁", '例: "$29/mo plans that quietly cap you at 3 seats"'],
  ["hidden-limit", "隠れた上限", '例: "The export limit nobody mentions"'],
  ["switching-cost", "乗り換えコスト", '例: "Two weekends. That is what migrating cost us."'],
  ["concrete-number", "具体的な数字", '例: "We tracked 41 tickets across both tools"'],
  ["team-size", "チーム規模", '例: "Under 10 people? Only one of these makes sense"'],
  ["specific-workflow", "特定の作業", '例: "If you invoice in two currencies, read this first"'],
  ["unspoken", "誰も言わないこと", '例: "The setting we wish we had changed on day one"'],
  ["who-should-not-buy", "買うべきでない人", '例: "Who should skip Acme entirely"'],
  ["free-plan-trap", "無料プランの罠", '例: "The free plan works — until month three"'],
  ["head-to-head", "直接比較", '例: "Acme vs Zendesk"（versus テンプレート固定）'],
] as const;

/* ---------------------------------------------------------------- context */

export function designerContext(slug: string): void {
  const c = config();
  const l = limits();
  const article = articles.bySlug(slug);
  if (!article) throw new Error(`記事が見つかりません: ${slug}`);

  const full = path.join(P.root, article.filePath);
  if (!fs.existsSync(full)) throw new Error(`記事の本文がありません: ${article.filePath}`);
  const body = fs.readFileSync(full, "utf8").replace(/^---\n[\s\S]*?\n---\n\n?/, "");

  const allPins = pinStore.all();
  const measured = allPins.filter((p) => (p.metrics?.impressions ?? 0) >= l.coldStart.minImpressionsPerPin).length;
  const cold = isColdStart(measured);
  const existingForArticle = allPins.filter((p) => p.articleSlug === slug).length;
  const remaining = l.output.maxPinsPerArticleTotal - existingForArticle;

  console.log(`# Designer — 「${article.title}」のピンを設計する\n`);

  section("作る枚数", kv([
    ["1記事あたりの上限", `${l.output.maxPinsPerArticleTotal} 枚`],
    ["この記事の既存", `${existingForArticle} 枚`],
    ["今回作れる枚数", `${Math.min(c.pins.perArticle, remaining)} 枚`],
  ]));

  if (cold) {
    section("⚠ コールドスタート中です", [
      `実測データのあるピンは ${measured} 枚しかありません（判断に必要なのは ${l.coldStart.minPinsWithEnoughImpressions} 枚）。`,
      "",
      "**「どのデザインが効くか」を判断してはいけません。** まだ根拠がありません。",
      "代わりに、次を機械的に守ってください。データを作るためです。",
      "",
      `- テンプレート ${TEMPLATE_IDS.length} 種類（${TEMPLATE_IDS.join(", ")}）を**全部使う**`,
      `- 切り口 ${ANGLE_TYPES.length} 種類を**全部使う**（下の一覧）`,
      "- 配色は co が順番に割り当てます（あなたは指定しません）",
      "",
      "1回に1変数だけ変える、が実験の原則です。全部いっぺんに変えると何が効いたか永久に分かりません。",
    ]);
  } else {
    const ranking = templateRanking().filter((r) => r.pins >= 2);
    section("これまでの実績", ranking.length
      ? [
        ranking.map((r) => `- ${r.templateId}: CTR ${r.ctrPct}%（${r.pins} 枚）`).join("\n"),
        "",
        `成績の良いテンプレートを厚めに使い、最下位（${ranking[ranking.length - 1].templateId}）は多くても1回にしてください。`,
      ]
      : "まだテンプレート別の実績が出ていません。均等に使ってください。");
  }

  section("切り口の一覧（それぞれ1枚ずつ）",
    ANGLE_TYPES.map(([id, jp, ex]) => `- ${id}（${jp}）\n    ${ex}`).join("\n"));

  section("守ること", [
    "- overlayMain は 60文字以内。ここでクリックが決まる。**具体的な名詞か数字を入れる。**",
    "- overlayTop は 28文字以内（小さな見出し）。overlayBottom は 90文字以内。",
    '- templateId が "checklist" のときは、overlayBottom を " | " 区切りの 3〜5 項目にする。',
    '- templateId が "versus" のときは、overlayMain を「A vs B」の形にする（製品名2つ）。',
    "- title は95文字以内。**絵文字なし。西暦なし。**",
    "- description は 80〜400文字。末尾に小文字のハッシュタグを 2〜4 個。",
    "- **description に開示文を書かない。** affiliate / sponsored / ad の語も使わない。",
    `  （"${c.compliance.pinDisclosurePrefix.trim()}" を co が先頭に自動で付けます。二重になるとスパムに見えます）`,
    "- 「効果を約束する」表現は禁止。読者が何を知れるかを書く。",
    "- 10枚が10通りの切り口であること。**同じ切り口の言い換え違いは重複として弾かれます。**",
  ]);

  section("この記事の中身（具体的な事実を使うこと。抽象的な表現はクリックされません）",
    ["```markdown", body.slice(0, 9000), "```"]);

  section("提出のしかた", [
    "1. JSON を書く（雛形: npm run co -- designer:template）",
    "2. npm run co -- designer:submit <ファイル>",
    "",
    "画像は作らないでください。co が Chromium で描画します（1枚 $0）。",
  ]);
}

export const PIN_TEMPLATE = {
  articleSlug: "（記事のslug）",
  pins: [{
    templateId: "bold-stat",
    title: "（95文字以内。数字か具体的な名詞を入れる）",
    description: "（80〜400文字。開示は書かない。末尾に小文字ハッシュタグ2〜4個）",
    overlayTop: "（28文字以内の小見出し）",
    overlayMain: "（60文字以内。ここでクリックが決まる）",
    overlayBottom: "（90文字以内）",
    altText: "（画像の説明。120文字以内）",
    angleType: "price-objection",
  }],
};

/* ----------------------------------------------------------------- submit */

function withDisclosure(body: string): string {
  const prefix = config().compliance.pinDisclosurePrefix;
  const budget = Math.max(0, 500 - prefix.length);
  return `${prefix}${body.trim().slice(0, budget)}`;
}

function boardFor(category: string): string {
  return `${category.replace(/\b\w/g, (m) => m.toUpperCase())} Tools`;
}

export async function designerSubmit(file: string): Promise<Pin[]> {
  if (!fs.existsSync(file)) throw new Error(`ファイルがありません: ${file}`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  const sub = validate(PinSubmission, raw, "designer:submit");

  const c = config();
  const l = limits();
  const article = articles.bySlug(sub.articleSlug);
  if (!article) throw new Error(`記事が見つかりません: ${sub.articleSlug}`);

  const allPins = pinStore.all();
  const existingForArticle = allPins.filter((p) => p.articleSlug === sub.articleSlug).length;
  if (existingForArticle + sub.pins.length > l.output.maxPinsPerArticleTotal) {
    throw new Error(
      `1記事あたりのピンが上限を超えます: 既存 ${existingForArticle} + 今回 ${sub.pins.length} > ${l.output.maxPinsPerArticleTotal}\n` +
      "同じ記事にピンを集中させても、Pinterest 上で自分のピン同士が食い合うだけです。",
    );
  }

  // 提出分どうしの切り口の重複を弾く
  const angles = sub.pins.map((p) => p.angleType);
  const dupAngles = angles.filter((a, i) => angles.indexOf(a) !== i);
  if (dupAngles.length) {
    throw new Error(
      `同じ切り口が複数あります: ${[...new Set(dupAngles)].join(", ")}\n` +
      "10枚は10通りの切り口にしてください。言い換え違いは切り口を変えたことになりません。",
    );
  }

  // 既存ピンとの文案の重複を弾く（Pinterest のスパム判定を避ける）
  if (l.duplication.requireUniquePinCopyHash) {
    const hits = sub.pins
      .map((p) => findPinCopyDuplicate(p.overlayMain, allPins))
      .filter((h): h is NonNullable<typeof h> => Boolean(h));
    if (hits.length) throw new DuplicateError(hits);
  }

  const destination = `${c.site.baseUrl}/articles/${article.slug}/?utm_source=pinterest&utm_medium=social&utm_campaign=${article.slug}`;
  const board = boardFor(article.category);
  const paletteBase = allPins.length;

  const newPins: Pin[] = sub.pins.map((p, i) => ({
    id: uid("pin"),
    articleSlug: article.slug,
    templateId: p.templateId,
    title: p.title.slice(0, 100),
    description: withDisclosure(p.description),
    overlayTop: p.overlayTop,
    overlayMain: p.overlayMain,
    overlayBottom: p.overlayBottom,
    altText: p.altText,
    boardName: board,
    imagePath: "",
    destinationUrl: destination,
    // ★draft のまま。QA と承認を通るまで予約もされない。
    status: "draft",
    scheduledAt: null,
    publishedAt: null,
    pinterestPinId: null,
    parentPinId: null,
    generation: 0,
    angleType: p.angleType,
    paletteIndex: (paletteBase + i) % 8,
    hasNumber: /\d/.test(p.overlayMain),
    hasVersus: /\bvs\.?\b/i.test(p.overlayMain),
    hasCta: false,
    imageHash: null,
    copyHash: hashText(p.overlayMain),
    experimentId: null,
    variant: null,
    approvalId: null,
  }));

  pinStore.addMany(newPins);
  log.ok(`ピン ${newPins.length} 枚を下書きとして登録しました（${article.slug}）`);
  log.info("画像はまだありません。`npm run co -- pins:render` で描画します（Actions が自動実行します）。");

  const idea = ideas.all().find((i) => i.programSlug === article.programSlugs[0] && i.status === "writing");
  if (idea) ideas.replace((i) => i.id === idea.id, { status: "published" });

  const task = addTask({ kind: "qa_release", targetRef: article.slug, createdBy: "designer" });
  log.info(`最終検品タスク: ${task.id}`);
  return newPins;
}

/* ----------------------------------------------------------------- render */

/**
 * 画像のないピンを描画する。
 * これは判断を伴わない機械的な作業なので、GitHub Actions 側で走らせる。
 */
export async function renderMissingPins(): Promise<number> {
  const c = config();
  const list = pinStore.all();
  const missing = list.filter((p) => !p.imagePath || !fs.existsSync(path.join(P.root, p.imagePath)));
  if (missing.length === 0) {
    log.info("描画が必要なピンはありません。");
    return 0;
  }

  const requests: RenderRequest[] = missing.map((p) => ({
    id: p.id,
    templateId: p.templateId,
    data: {
      overlayTop: p.overlayTop,
      overlayMain: p.overlayMain,
      overlayBottom: p.overlayBottom,
      siteName: c.site.name,
      width: c.pins.width,
      height: c.pins.height,
      paletteIndex: p.paletteIndex ?? 0,
    },
  }));

  const rendered = await renderPins(requests);
  for (const p of list) {
    const rel = rendered.get(p.id);
    if (!rel) continue;
    p.imagePath = rel;
    p.imageHash = hashFile(path.join(P.root, rel));
  }
  pinStore.save(list);
  log.ok(`${rendered.size} 枚を描画しました`);
  return rendered.size;
}
