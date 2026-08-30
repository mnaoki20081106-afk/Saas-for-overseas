import { config } from "../lib/config";
import { log } from "../lib/log";
import { articles, metrics as metricsStore, pins as pinStore } from "../lib/store";
import type { Pin } from "../lib/types";
import { generatePinsForArticle } from "./pins";

export interface WinnerInfo {
  pin: Pin;
  ctrPct: number;
  impressions: number;
}

export interface OptimizeResult {
  winners: WinnerInfo[];
  losers: WinnerInfo[];
  expandedPins: number;
  targetedArticles: string[];
  templateRanking: { templateId: string; pins: number; ctrPct: number }[];
  note: string;
}

/** クリック率が閾値を超えたピン = 勝ち型 */
export function findWinners(): { winners: WinnerInfo[]; losers: WinnerInfo[] } {
  const c = config();
  const m = metricsStore.get();
  const winners: WinnerInfo[] = [];
  const losers: WinnerInfo[] = [];

  for (const pin of pinStore.all()) {
    const pm = pin.metrics ?? m.pinMetrics[pin.id];
    if (!pm || pm.impressions < c.optimizer.minImpressionsForJudgement) continue;
    const info = { pin, ctrPct: pm.ctrPct, impressions: pm.impressions };
    if (pm.ctrPct >= c.optimizer.winnerCtrPct) winners.push(info);
    else if (pm.ctrPct <= c.optimizer.loserCtrPct) losers.push(info);
  }

  winners.sort((a, b) => b.ctrPct - a.ctrPct);
  losers.sort((a, b) => a.ctrPct - b.ctrPct);
  return { winners, losers };
}

/** テンプレート別の実績（次回の生成にフィードバックする） */
export function templateRanking(): { templateId: string; pins: number; ctrPct: number }[] {
  const agg = new Map<string, { impressions: number; clicks: number; pins: number }>();
  for (const pin of pinStore.all()) {
    const pm = pin.metrics;
    if (!pm || pm.impressions === 0) continue;
    const row = agg.get(pin.templateId) ?? { impressions: 0, clicks: 0, pins: 0 };
    row.impressions += pm.impressions;
    row.clicks += pm.outboundClicks;
    row.pins += 1;
    agg.set(pin.templateId, row);
  }
  return [...agg.entries()]
    .map(([templateId, r]) => ({
      templateId,
      pins: r.pins,
      ctrPct: r.impressions ? Math.round((r.clicks / r.impressions) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.ctrPct - a.ctrPct);
}

function expansionInstruction(winner: Pin, ctrPct: number, ranking: { templateId: string; ctrPct: number }[]): string {
  const best = ranking.slice(0, 3).map((r) => `${r.templateId} (${r.ctrPct}%)`).join(", ");
  return `## Proven winner to copy the STRUCTURE of (not the words)

This pin earned a ${ctrPct}% outbound click rate, well above our ${config().optimizer.winnerCtrPct}% bar:

- template: ${winner.templateId}
- image kicker: "${winner.overlayTop}"
- image headline: "${winner.overlayMain}"
- image support line: "${winner.overlayBottom}"
- pin title: "${winner.title}"

What made it work is the SHAPE of the promise: the specificity of the noun, the concreteness of the
number or limit, and the fact that it names a decision the reader is already stuck on.

Reproduce that shape for the article below, with this article's own facts. Do not reuse its words,
its product names, or its numbers — a copy with swapped nouns performs badly. Keep the same
template (${winner.templateId}) for at least half the pins, and use our other best performers for the
rest: ${best || "spread across the remaining templates"}.

`;
}

/**
 * 勝ち型を別カテゴリの記事へ横展開する。
 * 「クリック率3%以上のピンが勝ち型。その型を横に広げる」を自動でやる部分。
 */
export async function runOptimizer(): Promise<OptimizeResult> {
  log.step("STEP 6 / 勝ち型を見つけて、別カテゴリへ自動で横展開する");
  const c = config();
  const { winners, losers } = findWinners();
  const ranking = templateRanking();

  const result: OptimizeResult = {
    winners, losers, expandedPins: 0, targetedArticles: [], templateRanking: ranking, note: "",
  };

  if (winners.length === 0) {
    const measured = pinStore.all().filter((p) => (p.metrics?.impressions ?? 0) >= c.optimizer.minImpressionsForJudgement).length;
    result.note = measured === 0
      ? `まだ判定できるピンがありません（${c.optimizer.minImpressionsForJudgement} 表示以上が必要）。投稿を続けてください。`
      : `判定対象 ${measured} 枚のうち、CTR ${c.optimizer.winnerCtrPct}% を超えたピンはまだありません。`;
    log.info(result.note);
    return result;
  }

  log.ok(`勝ち型 ${winners.length} 枚を検出（最高 CTR ${winners[0].ctrPct}%）`);
  for (const w of winners.slice(0, 5)) {
    log.info(`  ${w.ctrPct}% (${w.impressions} 表示) [${w.pin.templateId}] ${w.pin.overlayMain}`);
  }

  const allArticles = articles.all().filter((a) => a.status !== "brief");
  const pinCountByArticle = new Map<string, number>();
  for (const p of pinStore.all()) {
    pinCountByArticle.set(p.articleSlug, (pinCountByArticle.get(p.articleSlug) ?? 0) + 1);
  }

  // 同じ記事にピンが集中しないよう、1回の実行では記事を使い回さない
  const usedTargets = new Set<string>();

  for (const winner of winners.slice(0, c.optimizer.maxExpansionsPerRun)) {
    const sourceArticle = articles.bySlug(winner.pin.articleSlug);
    const sourceCategory = sourceArticle?.category;

    // 「別の SaaS カテゴリ」へ広げる。無ければ同カテゴリの別記事へ。
    const targets = allArticles
      .filter((a) => a.slug !== winner.pin.articleSlug && !usedTargets.has(a.slug))
      .sort((a, b) => {
        const aOther = a.category !== sourceCategory ? -100 : 0;
        const bOther = b.category !== sourceCategory ? -100 : 0;
        return (aOther + (pinCountByArticle.get(a.slug) ?? 0)) - (bOther + (pinCountByArticle.get(b.slug) ?? 0));
      })
      .slice(0, 3);

    if (targets.length === 0) {
      result.note = usedTargets.size
        ? `横展開先の記事を使い切りました（この実行では ${usedTargets.size} 記事へ展開）。記事本数が増えるとさらに広がります。`
        : "横展開できる別記事がまだありません。記事本数が増えると自動的に広がります。";
      log.warn(result.note);
      break;
    }

    const per = Math.max(2, Math.ceil(c.optimizer.expansionPinsPerWinner / targets.length));
    const instruction = expansionInstruction(winner.pin, winner.ctrPct, ranking);

    for (const target of targets) {
      const gen = await generatePinsForArticle(target.slug, {
        generation: winner.pin.generation + 1,
        parentPinId: winner.pin.id,
        extraInstruction: instruction,
        count: per,
      });
      result.expandedPins += gen.created;
      result.targetedArticles.push(target.slug);
      usedTargets.add(target.slug);
      pinCountByArticle.set(target.slug, (pinCountByArticle.get(target.slug) ?? 0) + gen.created);
    }
  }

  if (losers.length) {
    log.info(`負け型 ${losers.length} 枚（CTR ${c.optimizer.loserCtrPct}% 以下）は再生産しません`);
  }
  result.note ||= `勝ち型を ${result.targetedArticles.length} 記事へ横展開し、${result.expandedPins} 枚を追加予約しました。`;
  log.ok(result.note);
  return result;
}
