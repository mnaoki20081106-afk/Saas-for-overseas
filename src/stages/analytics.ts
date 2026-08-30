import { env } from "../lib/config";
import { log } from "../lib/log";
import { metrics as metricsStore, pins as pinStore, state } from "../lib/store";
import { pinAnalytics } from "../integrations/pinterest";
import { fetchAffiliateStats } from "../integrations/affiliates";
import type { Metrics, PinMetrics } from "../lib/types";
import { daysAgoISO, nowISO, pct, sleep, todayISO } from "../lib/util";

export interface AnalyticsResult {
  pinsMeasured: number;
  impressions: number;
  outboundClicks: number;
  ctrPct: number;
  monthlyRecurringUsd: number;
  activeSubscriptions: number;
  sourcesMissing: string[];
}

/**
 * 追いかける指標は「表示数」ではない:
 *   1. ピン → 記事のクリック率
 *   2. 記事 → 無料トライアル申込率
 *   3. 平均継続期間（解約までの月数）
 * 1 は Pinterest API、2 と 3 はアフィリエイトネットワークの API から取る。
 */
export async function collectAnalytics(days = 30): Promise<AnalyticsResult> {
  log.step("STEP 5 / 数値を取る（ピン→記事のクリック率 / 申込率 / 継続月数）");

  const m: Metrics = metricsStore.get();
  const start = daysAgoISO(days);
  const end = todayISO();

  const published = pinStore.all().filter((p) => p.status === "published" && p.pinterestPinId);
  let impressions = 0;
  let outboundClicks = 0;
  let measured = 0;

  if (!env.pinterest.configured) {
    log.warn("Pinterest 未設定のため、ピンの数値は取得できません（記事とピン生成は動きます）");
  } else {
    for (const pin of published) {
      try {
        const raw = await pinAnalytics(pin.pinterestPinId!, start, end);
        const pm: PinMetrics = {
          impressions: raw.impressions,
          outboundClicks: raw.outboundClicks,
          saves: raw.saves,
          ctrPct: pct(raw.outboundClicks, raw.impressions),
          fetchedAt: nowISO(),
        };
        m.pinMetrics[pin.id] = pm;
        pinStore.update(pin.id, { metrics: pm });
        impressions += pm.impressions;
        outboundClicks += pm.outboundClicks;
        measured++;
        await sleep(400);
      } catch (err) {
        log.warn(`ピン ${pin.id} の数値取得に失敗: ${(err as Error).message.slice(0, 140)}`);
      }
    }
    log.ok(`${measured} 枚のピンの数値を取得しました`);
  }

  const { stats, sourcesMissing } = await fetchAffiliateStats(days);
  m.affiliate = stats;

  const monthlyRecurringUsd = stats.reduce((s, a) => s + a.monthlyRecurringUsd, 0);
  const activeSubscriptions = stats.reduce((s, a) => s + Math.max(a.activeSubscriptions, a.paidConversions), 0);
  const ctrPct = pct(outboundClicks, impressions);

  m.history = [
    ...m.history.filter((h) => h.date !== todayISO()),
    { date: todayISO(), impressions, outboundClicks, ctrPct, monthlyRecurringUsd, activeSubscriptions },
  ].slice(-400);
  m.updatedAt = nowISO();
  metricsStore.save(m);
  state.patch({ lastAnalyticsAt: nowISO() });

  log.ok(`表示 ${impressions.toLocaleString()} / 外部クリック ${outboundClicks.toLocaleString()} / CTR ${ctrPct}%`);
  if (monthlyRecurringUsd > 0) {
    log.ok(`継続報酬 $${monthlyRecurringUsd.toFixed(2)}/月 · 有効サブスク ${activeSubscriptions} 件`);
  }
  if (sourcesMissing.length) {
    log.info(`未接続のネットワーク: ${sourcesMissing.join(", ")}（設定すると売上も自動集計されます）`);
  }

  return { pinsMeasured: measured, impressions, outboundClicks, ctrPct, monthlyRecurringUsd, activeSubscriptions, sourcesMissing };
}
