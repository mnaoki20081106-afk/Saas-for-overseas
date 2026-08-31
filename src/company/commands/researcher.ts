import fs from "node:fs";
import { config, scoring, type PhaseThresholds } from "../../lib/config";
import { log } from "../../lib/log";
import { programs, state } from "../../lib/store";
import type { Program } from "../../lib/types";
import { clamp, nowISO, slugify, uid } from "../../lib/util";
import { research } from "../store";
import { kv, section } from "../report";
import { ResearchSubmission, validate } from "../schemas";
import type { ResearchCandidate } from "../schemas";

/**
 * Researcher — 案件を調べる係。
 *
 * 従来は Claude API の Web 検索 + 構造化出力で行っていた工程です。
 * 移行後は Claude Code のセッションが自分で WebSearch / WebFetch を使って調べ、
 * 結果の JSON をここに提出します。形の保証はこのファイルの zod スキーマが行います。
 *
 * 「出典のない数値を書かない」を仕組みで強制するのが、この工程のいちばん大事な点です。
 * 誤った報酬条件を記事に書くと、アフィリエイト規約違反で提携を切られます。
 */

export function currentPhase(): "bootstrap" | "growth" | "scale" {
  return state.get().phase ?? "bootstrap";
}

export function phaseThresholds(): PhaseThresholds {
  const phases = scoring().phases;
  if (!phases) {
    throw new Error("config/scoring.json に phases がありません。`git checkout config/scoring.json` で復元してください。");
  }
  const p = phases[currentPhase()];
  if (!p) throw new Error(`config/scoring.json に phase "${currentPhase()}" の定義がありません`);
  return p;
}

/* ---------------------------------------------------------------- context */

/** Researcher が調査を始める前に読むもの */
export function researcherContext(): void {
  const c = config();
  const t = phaseThresholds();
  const known = programs.all();
  const priorRejects = research.all().filter((r) => r.verdict === "rejected");

  console.log("# Researcher — 調査の前提\n");

  section("いまのフェーズ", [
    kv([
      ["フェーズ", `${currentPhase()}（${t.description}）`],
      ["承認済みの案件", `${known.filter((p) => p.status === "approved").length} 件`],
    ]),
    "",
    currentPhase() === "bootstrap"
      ? "⚠ まだ提携が1件も取れていない段階です。**高LTVより「審査が通ること」を優先**してください。\n" +
        "  審査の厳しい大手ばかり並べても、1件も承認されなければ在庫はゼロのままです。\n" +
        "  PartnerStack / Rewardful / FirstPromoter 系は審査が緩く早い傾向があります。"
      : "提携の実績があります。LTV を重視して構いません。",
  ]);

  section("足切り条件（これを満たさない候補は自動で落とされます）", kv([
    ["報酬モデル", "recurring または hybrid のみ（一度きりの報酬は対象外）"],
    ["月額報酬", `$${t.minMonthlyCommissionUsd} 以上`],
    ["平均継続", `${t.minAvgRetentionMonths} ヶ月以上`],
    ["想定LTV", `$${t.minLtvUsd} 以上（月額報酬 × 継続月数）`],
    ["日本語競合", `${t.maxJapaneseCompetition}/10 以下`],
    ["審査の難しさ", `${t.maxApprovalDifficulty}/10 以下（1 = すぐ通る）`],
    ["ネットワーク", c.programs.allowedNetworks.join(", ")],
  ]));

  section("狙う読者と市場", kv([
    ["読者", c.niche.audience],
    ["国", c.niche.geoFocus.join(" / ")],
    ["カテゴリ", c.niche.categories.join(", ")],
  ]));

  section("すでに持っている案件（重複して提出しないこと）",
    known.length ? known.map((p) => `- ${p.name}（${p.category} / ${p.status}）`).join("\n") : "（まだありません）");

  section("過去に落とした候補（再調査の無駄を避けるため）",
    priorRejects.length
      ? priorRejects.slice(-30).map((r) => `- ${r.name}: ${r.rejectReason}`).join("\n")
      : "（まだありません）");

  section("調べ方", [
    "1. WebSearch で候補を探す。次に **アフィリエイトページと価格ページを実際に開く**（WebFetch）。",
    "2. 数値は必ず、そのページに書かれていた文を evidence[].quote に引用する。",
    "   引用できない数値は書かない。null にして unverified に項目名を入れる。",
    "3. 英語圏の既存記事を実際に検索し、件数と質（thin / outdated / moderate / saturated）を見る。",
    "   日本語競合がゼロでも、英語の比較記事が充実していれば勝ちにくい。両方見ること。",
    "4. Pinterest との相性を考える。画面や数字で説明できる商材ほど向いている。",
    "5. 審査の通りやすさを見積もる。最低トラフィック要件や『確立されたサイトのみ』の記載を探す。",
  ]);

  section("提出のしかた", [
    "調べ終わったら次の形の JSON をファイルに書いて、提出コマンドを実行してください。",
    "",
    "```",
    "npm run co -- researcher:submit <ファイルパス>",
    "```",
    "",
    "形が違えば、どこがどう違うかが表示されます。直して同じコマンドをもう一度実行してください。",
    "",
    "雛形: npm run co -- researcher:template",
  ]);
}

export const RESEARCH_TEMPLATE = {
  candidates: [{
    name: "（製品名）",
    homepage: "https://example.com",
    affiliateProgramUrl: "https://example.com/affiliates",
    network: "PartnerStack",
    category: "customer support helpdesk",
    pricingFromUsd: 29,
    commissionModel: "recurring",
    commissionRatePct: 25,
    cookieDays: 90,
    estMonthlyCommissionUsd: 42,
    estAvgRetentionMonths: 14,
    estLtvUsd: 588,
    targetMarket: ["US", "UK", "CA", "AU"],
    mainCompetitors: ["Competitor A", "Competitor B"],
    existingEnglishArticles: 12,
    englishCoverageQuality: "outdated",
    searchDemand: "medium",
    pinterestFit: 7,
    approvalDifficulty: 3,
    japaneseCompetition: 2,
    englishCompetition: 5,
    reliability: 8,
    whyGoodFit: "（2文で具体的に）",
    targetPains: ["（購入前の具体的な悩みを3〜5個）"],
    evidence: [
      { field: "commissionRatePct", url: "https://example.com/affiliates", quote: "Earn 25% recurring commission for the lifetime of the customer." },
    ],
    unverified: [],
  }],
};

/* ----------------------------------------------------------------- submit */

type Candidate = ResearchSubmission["candidates"][number];

/**
 * スコアリング。既存の weights を使いつつ、フェーズに応じて
 * 「審査の通りやすさ」を加点する。
 */
function scoreCandidate(c: Candidate): number {
  const w = scoring().weights;
  const t = phaseThresholds();
  const ltv = c.estLtvUsd ?? (c.estMonthlyCommissionUsd ?? 0) * (c.estAvgRetentionMonths ?? 0);

  const norm = {
    recurring: c.commissionModel === "recurring" ? 1 : c.commissionModel === "hybrid" ? 0.5 : 0,
    money: clamp((c.estMonthlyCommissionUsd ?? 0) / 100, 0, 1),
    retention: clamp((c.estAvgRetentionMonths ?? 0) / 24, 0, 1),
    jpBlueOcean: clamp((10 - c.japaneseCompetition) / 9, 0, 1),
    enBlueOcean: clamp((10 - c.englishCompetition) / 9, 0, 1),
    cookie: clamp((c.cookieDays ?? 30) / 120, 0, 1),
    reliability: clamp(c.reliability / 10, 0, 1),
    // 審査が通りやすいほど高い。初期フェーズではここの重みが大きい。
    approvalEase: clamp((10 - c.approvalDifficulty) / 9, 0, 1),
    // Pinterest で説明しやすい商材か
    pinterestFit: clamp(c.pinterestFit / 10, 0, 1),
    ltv: clamp(ltv / 1000, 0, 1),
  };

  const raw =
    norm.recurring * (w.recurringCommission ?? 0) +
    norm.money * (w.monthlyCommissionUsd ?? 0) +
    norm.retention * (w.avgRetentionMonths ?? 0) +
    norm.jpBlueOcean * (w.japaneseCompetitionInverse ?? 0) +
    norm.enBlueOcean * (w.englishCompetitionInverse ?? 0) +
    norm.cookie * (w.cookieDays ?? 0) +
    norm.reliability * (w.programReliability ?? 0) +
    norm.approvalEase * (t.extraWeights.approvalEase ?? 0) +
    norm.pinterestFit * 8 +
    norm.ltv * 10;

  return Math.round(raw * 10) / 10;
}

function hardFilter(c: Candidate): string | null {
  const t = phaseThresholds();
  const cfg = config();
  const ltv = c.estLtvUsd ?? (c.estMonthlyCommissionUsd ?? 0) * (c.estAvgRetentionMonths ?? 0);

  if (c.commissionModel !== "recurring" && c.commissionModel !== "hybrid") {
    return "継続報酬ではない（一度きりの報酬は積み上がらないので対象外）";
  }
  if ((c.estMonthlyCommissionUsd ?? 0) < t.minMonthlyCommissionUsd) {
    return `月額報酬が $${t.minMonthlyCommissionUsd} 未満（$${c.estMonthlyCommissionUsd ?? 0}）`;
  }
  if ((c.estAvgRetentionMonths ?? 0) < t.minAvgRetentionMonths) {
    return `平均継続が ${t.minAvgRetentionMonths}ヶ月未満（${c.estAvgRetentionMonths ?? 0}ヶ月）`;
  }
  if (ltv < t.minLtvUsd) {
    return `想定LTVが $${t.minLtvUsd} 未満（$${Math.round(ltv)}）`;
  }
  if (c.japaneseCompetition > t.maxJapaneseCompetition) {
    return `日本語競合が多い（${c.japaneseCompetition}/10）`;
  }
  if (c.approvalDifficulty > t.maxApprovalDifficulty) {
    return `審査が厳しすぎる（${c.approvalDifficulty}/10）。いまの段階では通らない可能性が高い`;
  }
  if (!cfg.programs.allowedNetworks.includes(c.network) && c.network !== "Unknown") {
    return `対象外のネットワーク（${c.network}）`;
  }
  return null;
}

/** 出典が要る数値に出典があるか */
function evidenceGaps(c: Candidate): string[] {
  const needsEvidence: [string, unknown][] = [
    ["commissionModel", c.commissionModel],
    ["commissionRatePct", c.commissionRatePct],
    ["pricingFromUsd", c.pricingFromUsd],
    ["cookieDays", c.cookieDays],
  ];
  const covered = new Set(c.evidence.map((e) => e.field));
  return needsEvidence
    .filter(([field, value]) => value !== null && !covered.has(field) && !c.unverified.includes(field))
    .map(([field]) => field);
}

function toProgram(c: Candidate, score: number): Program {
  return {
    slug: slugify(c.name),
    name: c.name,
    homepage: c.homepage,
    signupUrl: c.homepage,
    affiliateProgramUrl: c.affiliateProgramUrl,
    network: c.network,
    category: c.category.toLowerCase(),
    pricingFromUsd: c.pricingFromUsd ?? 0,
    commissionModel: c.commissionModel,
    commissionRatePct: c.commissionRatePct,
    estMonthlyCommissionUsd: c.estMonthlyCommissionUsd ?? 0,
    estAvgRetentionMonths: c.estAvgRetentionMonths ?? 0,
    cookieDays: c.cookieDays,
    japaneseCompetition: c.japaneseCompetition,
    englishCompetition: c.englishCompetition,
    reliability: c.reliability,
    whyGoodFit: c.whyGoodFit,
    targetPains: c.targetPains,
    mainCompetitors: c.mainCompetitors,
    score,
    status: "candidate",
    discoveredAt: nowISO(),
    evidence: c.evidence.map((e) => e.url),
  };
}

export interface ResearchResult {
  submitted: number;
  accepted: number;
  rejected: { name: string; reason: string }[];
  added: number;
  updated: number;
}

export function researcherSubmit(file: string): ResearchResult {
  if (!fs.existsSync(file)) throw new Error(`ファイルがありません: ${file}`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  const parsed = validate(ResearchSubmission, raw, "researcher:submit");

  const known = new Set(programs.all().map((p) => p.slug));
  const accepted: Program[] = [];
  const rejected: { name: string; reason: string }[] = [];
  const records: ResearchCandidate[] = [];

  for (const c of parsed.candidates) {
    const slug = slugify(c.name);

    // 出典のない数値は受け付けない（誤情報の公開が提携解除に直結するため）
    const gaps = evidenceGaps(c);
    if (gaps.length) {
      throw new Error(
        `${c.name}: 次の項目に出典がありません → ${gaps.join(", ")}\n` +
        "数値には必ず evidence を付けてください。実際のページに書かれていた文を quote に引用します。\n" +
        "どうしても確認できない項目は、値を null にして unverified に項目名を入れてください。\n" +
        "推測で埋めてはいけません。誤った報酬条件を記事に書くと提携を切られます。",
      );
    }

    const score = scoreCandidate(c);
    const reason = known.has(slug) ? "すでに保有している案件です" : hardFilter(c);
    const record: ResearchCandidate = {
      ...c,
      id: uid("res"),
      discoveredAt: nowISO(),
      score,
      verdict: reason ? "rejected" : "accepted",
      rejectReason: reason,
    };
    records.push(record);

    if (reason) rejected.push({ name: c.name, reason });
    else accepted.push(toProgram(c, score));
  }

  for (const r of records) research.add(r);
  const { added, updated } = programs.upsertMany(accepted);
  state.patch({ lastResearchAt: nowISO() });

  log.ok(`候補 ${parsed.candidates.length} 件 → 条件クリア ${accepted.length} 件（新規 ${added} / 更新 ${updated}）`);
  for (const r of rejected) log.warn(`除外: ${r.name} — ${r.reason}`);
  for (const a of accepted.sort((x, y) => y.score - x.score)) {
    const ltv = Math.round(a.estMonthlyCommissionUsd * a.estAvgRetentionMonths);
    log.info(`  ${a.score.toFixed(1)}点 ${a.name} — $${a.estMonthlyCommissionUsd}/月 × ${a.estAvgRetentionMonths}ヶ月 = LTV $${ltv}`);
  }
  if (accepted.length === 0) {
    log.human("条件を満たす案件が1件もありませんでした。足切り条件を確認して、別の候補を探してください。");
  }

  return { submitted: parsed.candidates.length, accepted: accepted.length, rejected, added, updated };
}
