import fs from "node:fs";
import path from "node:path";
import { config, affiliateLinks } from "../../lib/config";
import { log } from "../../lib/log";
import { P } from "../../lib/paths";
import { articles, pins as pinStore, programs } from "../../lib/store";
import { matches } from "../../lib/util";
import { headingOverlapPct } from "../dedupe";
import { limits } from "../limits";
import { section } from "../report";

/**
 * QA — 公開前の最終検品。
 *
 * Editor が「読み物として自然か」を見るのに対し、QA は「間違っていないか」を見ます。
 * 範囲を完全に分けることで、互いに「もう片方が見ているはず」と手を抜くのを防ぎます。
 *
 * 14項目のうち、**機械的に判定できる項目はここでコードが実行します。**
 * AI が見るのは残りだけです。そのぶんコンテキストが節約でき、判定もぶれません。
 */

export interface QaCheck {
  id: string;
  label: string;
  by: "code" | "ai";
  result: "pass" | "fail" | "na";
  detail: string;
}

/** 記事本文を読む（front matter を落とす） */
function bodyOf(filePath: string): string {
  const full = path.join(P.root, filePath);
  if (!fs.existsSync(full)) return "";
  return fs.readFileSync(full, "utf8").replace(/^---\n[\s\S]*?\n---\n\n?/, "");
}

export function qaCheck(slug: string): { checks: QaCheck[]; failed: number } {
  const c = config();
  const l = limits();
  const article = articles.bySlug(slug);
  if (!article) throw new Error(`記事が見つかりません: ${slug}`);
  const body = bodyOf(article.filePath);
  const relevantPins = pinStore.all().filter((p) => p.articleSlug === slug);
  const links = affiliateLinks();

  const checks: QaCheck[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string, by: "code" | "ai" = "code") =>
    checks.push({ id, label, by, result: ok ? "pass" : "fail", detail });

  /* ── 2. SaaS情報が programs.json と一致しているか ───────────────── */
  const missingPrograms = article.programSlugs.filter((s) => !programs.bySlug(s));
  add("saas_info", "SaaS情報が案件データと一致",
    missingPrograms.length === 0,
    missingPrograms.length ? `存在しない案件を参照: ${missingPrograms.join(", ")}` : "一致");

  /* ── 4. アフィリエイト条件の記述 ───────────────────────────────── */
  const main = programs.bySlug(article.programSlugs[0]);
  add("affiliate_terms", "アフィリエイト条件の記述",
    Boolean(main),
    main ? `主案件: ${main.name}（${main.network} / ${main.commissionModel}）` : "主案件が見つからない");

  /* ── 5. リンク（プレースホルダの解決可能性） ───────────────────── */
  const placeholders = [...new Set(matches(body, /\{\{link:[a-z0-9-]+\}\}/g)
    .map((m) => m.replace(/\{\{link:|\}\}/g, "")))];
  const unresolvable = placeholders.filter((s) => !programs.bySlug(s));
  add("links", "本文のリンクがすべて解決できる",
    unresolvable.length === 0,
    unresolvable.length
      ? `programs.json にない slug: ${unresolvable.join(", ")}`
      : `${placeholders.length} 個のリンク（うち ${placeholders.filter((s) => links[s]).length} 個が本物のアフィリエイトリンク）`);

  const internalLinks = [...new Set(matches(body, /\]\(\/articles\/[a-z0-9-]+\/\)/g)
    .map((m) => m.replace(/\]\(\/articles\/|\/\)/g, "")))];
  const brokenInternal = internalLinks.filter((s) => !articles.bySlug(s));
  add("internal_links", "内部リンクの飛び先が存在する",
    brokenInternal.length === 0,
    brokenInternal.length ? `存在しない記事へのリンク: ${brokenInternal.join(", ")}` : `${internalLinks.length} 本`);

  /* ── 6. UTM ────────────────────────────────────────────────────── */
  const badUtm = relevantPins.filter((p) => !p.destinationUrl.includes("utm_source=pinterest"));
  add("utm", "ピンのリンク先に UTM が付いている",
    badUtm.length === 0,
    badUtm.length ? `${badUtm.length} 枚に utm_source がない` : `${relevantPins.length} 枚すべてOK`);

  /* ── 7. CTA（記事の冒頭と末尾） ────────────────────────────────── */
  // site/build.ts が自動挿入するので、ここでは本文中にリンクが1つ以上あればよい
  add("cta", "本文にアフィリエイト導線がある",
    placeholders.length >= 1 && placeholders.length <= 7,
    `リンク ${placeholders.length} 個（1〜7 が適正。サイト側で冒頭と末尾に CTA ボタンが自動挿入されます）`);

  /* ── 8. ピン画像 ───────────────────────────────────────────────── */
  const noImage = relevantPins.filter((p) => !p.imagePath || !fs.existsSync(path.join(P.root, p.imagePath)));
  add("pin_images", "ピン画像が存在する",
    relevantPins.length > 0 && noImage.length === 0,
    relevantPins.length === 0
      ? "ピンが1枚もありません"
      : noImage.length
        ? `${noImage.length} 枚に画像がありません（npm run co -- pins:render で描画）`
        : `${relevantPins.length} 枚すべて描画済み`);

  /* ── 9. ピンのタイトル ─────────────────────────────────────────── */
  const badTitles = relevantPins.filter((p) =>
    p.title.length > 100 ||
    /\b(19|20)\d{2}\b/.test(p.title) ||
    /\p{Extended_Pictographic}/u.test(p.title));
  add("pin_titles", "ピンのタイトル（100字以内・西暦なし・絵文字なし）",
    badTitles.length === 0,
    badTitles.length ? `違反 ${badTitles.length} 枚: ${badTitles.slice(0, 3).map((p) => p.title.slice(0, 40)).join(" / ")}` : "OK");

  /* ── 10. ピンの説明文 ──────────────────────────────────────────── */
  const prefix = c.compliance.pinDisclosurePrefix;
  const badDesc = relevantPins.filter((p) => p.description.length > 500 || !p.description.startsWith(prefix));
  const doubleDisclosure = relevantPins.filter((p) =>
    /\b(affiliate|sponsored)\b/i.test(p.description.slice(prefix.length)));
  add("pin_descriptions", "ピンの説明文（500字以内・開示が先頭・二重開示なし）",
    badDesc.length === 0 && doubleDisclosure.length === 0,
    [
      badDesc.length ? `開示がない/長すぎる: ${badDesc.length} 枚` : "",
      doubleDisclosure.length ? `開示が二重: ${doubleDisclosure.length} 枚（スパムに見えます）` : "",
    ].filter(Boolean).join(" / ") || "OK");

  /* ── 11. ブランド情報 ──────────────────────────────────────────── */
  const wrongDomain = relevantPins.filter((p) => !p.destinationUrl.startsWith(c.site.baseUrl));
  add("brand", "リンク先が自サイトのドメイン",
    wrongDomain.length === 0,
    wrongDomain.length ? `${wrongDomain.length} 枚が別ドメインを指しています` : c.site.baseUrl);

  /* ── 13. 重複コンテンツ ────────────────────────────────────────── */
  const others = articles.all().filter((a) => a.slug !== slug);
  let worstOverlap = 0;
  let worstSlug = "";
  for (const o of others) {
    const pct = headingOverlapPct(body, bodyOf(o.filePath));
    if (pct > worstOverlap) { worstOverlap = pct; worstSlug = o.slug; }
  }
  add("duplicate_content", "既存記事との重複",
    worstOverlap <= l.duplication.articleHeadingOverlapMaxPct,
    others.length === 0 ? "他に記事がありません" : `最大の重なり ${worstOverlap}%（${worstSlug || "-"}）/ 上限 ${l.duplication.articleHeadingOverlapMaxPct}%`);

  /* ── 14. 開示（記事内で二重になっていないか） ──────────────────── */
  const disclosureInBody = /affiliate link|commission at no extra cost/i.test(body);
  add("disclosure", "記事本文に開示を書いていない（サイトが自動挿入する）",
    !disclosureInBody,
    disclosureInBody ? "本文に開示らしき記述があります。サイト側の自動挿入と二重になります" : "OK");

  /* ── AI が見る項目（コードでは判定できない） ───────────────────── */
  for (const [id, label] of [
    ["pricing_accuracy", "料金の記述が出典と矛盾しないか（出典URLを開いて確認する）"],
    ["fact_check", "検証可能な主張に出典があるか"],
    ["editor_findings_applied", "Editor の指摘がすべて反映されているか"],
    ["pin_image_legibility", "ピン画像の文字が枠内に収まり、読める配色か（画像を実際に見る）"],
  ] as const) {
    checks.push({ id, label, by: "ai", result: "na", detail: "AI が判定してください" });
  }

  const failed = checks.filter((c2) => c2.result === "fail").length;

  console.log(`\n# QA — 最終検品: ${slug}\n`);
  section("コードが判定した項目", checks.filter((c2) => c2.by === "code").map((c2) =>
    `${c2.result === "pass" ? "✓" : "✗"} ${c2.label}\n    ${c2.detail}`).join("\n"));
  section("あなた（AI）が判定する項目", [
    ...checks.filter((c2) => c2.by === "ai").map((c2) => `□ ${c2.label}`),
    "",
    "上の4項目を実際に確認してください。",
    "・料金と事実は、案件の evidence にある URL を WebFetch で開いて突き合わせる",
    "・ピン画像は assets/pins/ の PNG を実際に見る",
    "・出典を確認せずに「たぶん大丈夫」で通さないこと",
  ]);

  if (failed) {
    log.error(`${failed} 件が不合格です。直してから公開してください。`);
  } else {
    log.ok("コードによる判定はすべて合格しました。残りの4項目を確認してください。");
  }
  return { checks, failed };
}
