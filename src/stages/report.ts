import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "../lib/config";
import { structured, withFixture } from "../lib/claude";
import { log } from "../lib/log";
import { P } from "../lib/paths";
import { articles, humanTasks, metrics as metricsStore, pins as pinStore, programs, state } from "../lib/store";
import { findWinners, templateRanking } from "./optimize";
import { nowISO, pct, usd } from "../lib/util";

/* --------------------------------------------------------------- 週次レポート */

export interface ReportResult { path: string; summary: string }

export function buildReport(): ReportResult {
  log.step("STEP 7 / 週次レポートを書き出す");
  const c = config();
  const m = metricsStore.get();
  const allPins = pinStore.all();
  const allArticles = articles.all();
  const { winners, losers } = findWinners();

  const published = allPins.filter((p) => p.status === "published");
  const scheduled = allPins.filter((p) => p.status === "scheduled");
  const failed = allPins.filter((p) => p.status === "failed");

  const impressions = published.reduce((s, p) => s + (p.metrics?.impressions ?? 0), 0);
  const clicks = published.reduce((s, p) => s + (p.metrics?.outboundClicks ?? 0), 0);
  const ctr = pct(clicks, impressions);

  const mrr = m.affiliate.reduce((s, a) => s + a.monthlyRecurringUsd, 0);
  const active = m.affiliate.reduce((s, a) => s + Math.max(a.activeSubscriptions, a.paidConversions), 0);
  const measuredRetention = m.affiliate
    .map((a) => a.avgRetentionMonths)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const avgRetention = measuredRetention.length
    ? measuredRetention.reduce((s, n) => s + n, 0) / measuredRetention.length
    : null;

  // まだ成果データが無い段階でも「今の資産で理論上いくらになるか」を出す
  const pipelineLtv = programs
    .all()
    .filter((p) => p.status === "approved")
    .reduce((s, p) => s + p.estMonthlyCommissionUsd * p.estAvgRetentionMonths, 0);

  const prev = m.history.length > 1 ? m.history[m.history.length - 2] : null;
  const delta = (now: number, before: number | undefined): string => {
    if (before === undefined || before === 0) return "";
    const d = now - before;
    return d === 0 ? "" : ` (${d > 0 ? "+" : ""}${Math.round(d * 100) / 100})`;
  };

  const lines: string[] = [
    `# 週次レポート — ${nowISO().slice(0, 10)}`,
    "",
    "## いま何が積み上がっているか",
    "",
    "| 指標 | 数値 |",
    "| --- | --- |",
    `| 公開記事 | ${allArticles.filter((a) => a.status === "published").length} 本 |`,
    `| 要確認で未公開の記事 | ${allArticles.filter((a) => a.status === "needs_review").length} 本 |`,
    `| 投稿済みピン | ${published.length} 枚 |`,
    `| 予約待ちピン | ${scheduled.length} 枚 |`,
    `| ピン表示数（直近30日） | ${impressions.toLocaleString()}${delta(impressions, prev?.impressions)} |`,
    `| ピン→記事クリック | ${clicks.toLocaleString()}${delta(clicks, prev?.outboundClicks)} |`,
    `| **クリック率（追うべき指標）** | **${ctr}%**${delta(ctr, prev?.ctrPct)} |`,
    `| 継続報酬（月額） | ${usd(mrr)} |`,
    `| 有効サブスク数 | ${active} 件 |`,
    `| 平均継続期間（実測） | ${avgRetention ? `${avgRetention.toFixed(1)} ヶ月` : "計測待ち"} |`,
    `| 承認済み案件の想定LTV合計 | ${usd(Math.round(pipelineLtv))} |`,
    "",
  ];

  lines.push("## 勝ち型（CTR " + c.optimizer.winnerCtrPct + "% 以上）", "");
  if (winners.length === 0) {
    lines.push(
      `まだ勝ち型はありません（判定には ${c.optimizer.minImpressionsForJudgement} 表示以上が必要）。`,
      "ピンが表示数を集めるまで数週間かかるのが普通です。ここは待つのが正解。",
      "",
    );
  } else {
    lines.push("| CTR | 表示 | テンプレ | 見出し |", "| --- | --- | --- | --- |");
    for (const w of winners.slice(0, 10)) {
      lines.push(`| ${w.ctrPct}% | ${w.impressions.toLocaleString()} | ${w.pin.templateId} | ${w.pin.overlayMain} |`);
    }
    lines.push("", "→ この型は自動で別カテゴリへ横展開済みです。", "");
  }

  const ranking = templateRanking();
  if (ranking.length) {
    lines.push("## テンプレート別の実績", "", "| テンプレ | 枚数 | CTR |", "| --- | --- | --- |");
    for (const r of ranking) lines.push(`| ${r.templateId} | ${r.pins} | ${r.ctrPct}% |`);
    lines.push("");
  }

  if (losers.length) {
    lines.push("## 効いていない型", "", `CTR ${c.optimizer.loserCtrPct}% 以下が ${losers.length} 枚。これらの型は今後生成しません。`, "");
  }

  if (m.affiliate.length) {
    lines.push("## 案件別の成果", "", "| 案件 | 成約 | 月額報酬 | 累計 | 実測継続 |", "| --- | --- | --- | --- | --- |");
    for (const a of [...m.affiliate].sort((x, y) => y.monthlyRecurringUsd - x.monthlyRecurringUsd)) {
      const name = programs.bySlug(a.programSlug)?.name ?? a.programSlug;
      lines.push(`| ${name} | ${a.paidConversions} | ${usd(a.monthlyRecurringUsd)} | ${usd(a.lifetimeUsd)} | ${a.avgRetentionMonths ?? "-"} |`);
    }
    lines.push("");

    // 1つのASPへの依存度が高いと、その会社の規約・報酬率変更で収入が一気に落ちるリスクがある
    const byNetwork = new Map<string, number>();
    for (const a of m.affiliate) byNetwork.set(a.network, (byNetwork.get(a.network) ?? 0) + a.monthlyRecurringUsd);
    const totalMrr = [...byNetwork.values()].reduce((s, v) => s + v, 0);
    if (totalMrr > 0) {
      const sorted = [...byNetwork.entries()].sort((x, y) => y[1] - x[1]);
      const topShare = sorted[0][1] / totalMrr;
      lines.push("## ASP（ネットワーク）ごとの内訳", "", "| ネットワーク | 月額報酬 | 割合 |", "| --- | --- | --- |");
      for (const [net, v] of sorted) lines.push(`| ${net} | ${usd(v)} | ${pct(v, totalMrr)}% |`);
      lines.push("");
      if (topShare >= 0.7) {
        lines.push(
          `⚠️ **${sorted[0][0]} 1社への依存度が ${Math.round(topShare * 100)}% です。**`,
          "1つのASPの規約変更や報酬率変更をそのまま受けることになるので、" +
            "承認済み・応募中の案件を他のネットワークにも広げることを検討してください。",
          "",
        );
      }
    }
  }

  if (failed.length) {
    lines.push("## 投稿に失敗したピン", "", `${failed.length} 枚。\`npm run autopilot pins:requeue\` で再予約できます。`, "");
    for (const f of failed.slice(0, 5)) lines.push(`- ${f.id}: ${f.lastError?.slice(0, 160)}`);
    lines.push("");
  }

  const open = humanTasks.open();
  lines.push("## あなたがやること", "");
  if (open.length === 0) lines.push("**なし。** 全部自動で回っています。", "");
  else {
    lines.push(`${open.length} 件・合計約 ${open.reduce((s, t) => s + t.minutes, 0)} 分。詳細は [TODO-HUMAN.md](./TODO-HUMAN.md)。`, "");
    for (const t of open) lines.push(`- [ ] ${t.title}（約${t.minutes}分）`);
    lines.push("");
  }

  const needsReview = allArticles.filter((a) => a.status === "needs_review");
  if (needsReview.length) {
    lines.push("## 品質ゲートに引っかかった記事", "");
    for (const a of needsReview) {
      lines.push(`- \`${a.filePath}\` — ${a.qualityIssues.join(" / ")}`);
    }
    lines.push("");
  }

  const out = path.join(P.root, "REPORT.md");
  fs.writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
  state.patch({ lastReportAt: nowISO() });

  const summary = `記事 ${allArticles.length} 本 / ピン ${published.length} 枚投稿・${scheduled.length} 枚予約 / CTR ${ctr}% / 月額 ${usd(mrr)}`;
  log.ok(`REPORT.md を更新: ${summary}`);
  return { path: out, summary };
}

/* ----------------------------------------- STEP4: 実績を次の階段へ変換する */

const GrowthAssets = z.object({
  japanesePost: z.string().describe("A 900-1400 character Japanese post for X/note describing the result and the mechanism, in a plain, non-hyped voice. No fake numbers — use only the figures given."),
  introducerEmail: z.string().describe("A 150-200 word English cold email to a SaaS vendor proposing a high-ticket introducer/referral arrangement, referencing the real numbers given"),
  consultingOutline: z.array(z.string()).describe("6-9 bullet outline for a paid Japanese consulting offer based on the actual workflow used"),
});

/**
 * 「海外SaaS継続報酬 → ビジネス発信 → 高単価Introducer」の階段。
 * 実績が出たときだけ、その実数だけを使って発信素材を自動生成する。
 */
export async function buildGrowthAssets(force = false): Promise<string | null> {
  const c = config();
  const m = metricsStore.get();
  const mrr = m.affiliate.reduce((s, a) => s + a.monthlyRecurringUsd, 0);
  const active = m.affiliate.reduce((s, a) => s + Math.max(a.activeSubscriptions, a.paidConversions), 0);
  const st = state.get();

  const hit = c.growth.monthlyRevenueMilestonesUsd
    .filter((x) => mrr >= x && !st.milestonesHit.includes(x))
    .sort((a, b) => b - a)[0];

  if (!hit && !force) return null;
  log.step(`STEP 8 / 実績 ${usd(mrr)}/月 に到達 — 発信素材とIntroducer提案を生成`);

  const published = pinStore.all().filter((p) => p.status === "published").length;
  const articleCount = articles.all().filter((a) => a.status === "published").length;
  const facts = [
    `monthly recurring affiliate revenue: ${usd(mrr)}`,
    `active paying referrals: ${active}`,
    `published English articles: ${articleCount}`,
    `published Pinterest pins: ${published}`,
    `programs approved: ${programs.all().filter((p) => p.status === "approved").length}`,
    `top programs: ${m.affiliate.slice(0, 3).map((a) => programs.bySlug(a.programSlug)?.name ?? a.programSlug).join(", ") || "n/a"}`,
  ].join("\n- ");

  const assets = await withFixture(
    () => ({
      japanesePost: `（DRY_RUN のサンプル）海外SaaSのアフィリエイトを、英語記事 ${articleCount} 本と Pinterest ピン ${published} 枚だけで回した結果、継続報酬が月 ${usd(mrr)} になりました。ANTHROPIC_API_KEY を設定すると本文が生成されます。`,
      introducerEmail: "(DRY_RUN sample) Introducer proposal email placeholder.",
      consultingOutline: ["(DRY_RUN sample) consulting outline placeholder"],
    }),
    () =>
      structured(GrowthAssets, {
        system: `You write in a plain, evidence-first voice. You never inflate a number, never imply a
result is typical, and never promise income. You are writing for an operator who values being able
to check every claim. The Japanese post must read as a Japanese person's own writing, not a translation.`,
        user: `Turn these real, measured results into three assets.

## The only facts you may use (do not add or round up any number)
- ${facts}

## The mechanism actually used
1. Claude researches recurring-commission SaaS programs and filters them on $/month and retention.
2. Claude writes one evergreen English comparison article per run, quality-gated for banned phrases and length.
3. Claude designs 10 Pinterest pins per article across 5 image templates; the images are rendered programmatically.
4. Pins publish on a schedule via the Pinterest API.
5. Pin analytics feed a winner rule (outbound CTR >= ${c.optimizer.winnerCtrPct}%); winners are re-cut for other categories automatically.

## Assets to write
1. japanesePost — 日本語。X / note 用。誇張なし、数字はそのまま、再現手順が伝わること。煽り言葉は禁止。
2. introducerEmail — English. To a SaaS vendor's partnerships lead, proposing a high-ticket introducer
   arrangement (flat fee per closed account) on top of the standard affiliate program. Reference the
   real numbers. Short, concrete, easy to say yes to.
3. consultingOutline — 日本語の箇条書き。実際にやった工程だけを扱う有料コンサルの構成案。`,
        stage: "growth",
        label: "実績発信素材の生成",
        effort: "high",
        maxTokens: 8000,
      }),
  );

  const dir = path.join(P.docs, "growth");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `milestone-${hit ?? Math.round(mrr)}usd.md`);
  fs.writeFileSync(
    file,
    [
      `# 実績 ${usd(mrr)}/月 到達時の発信素材`,
      "",
      `生成日: ${nowISO()}`,
      "",
      "> 数字はすべて data/metrics.json の実測値です。書き換えないでください。",
      "",
      "## 1. 日本のビジネス界隈向けの発信（X / note）",
      "",
      assets.japanesePost,
      "",
      "## 2. 高単価 Introducer 提案メール（英語・SaaSベンダー宛）",
      "",
      "```text",
      assets.introducerEmail,
      "```",
      "",
      "## 3. 有料コンサルの構成案",
      "",
      ...assets.consultingOutline.map((b) => `- ${b}`),
      "",
    ].join("\n"),
    "utf8",
  );

  if (hit) state.patch({ milestonesHit: [...st.milestonesHit, hit] });
  log.ok(`発信素材を生成しました: ${path.relative(P.root, file)}`);
  return file;
}
