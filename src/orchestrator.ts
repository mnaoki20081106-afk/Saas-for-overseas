import { config, env } from "./lib/config";
import { log } from "./lib/log";
import { ensureDirs } from "./lib/paths";
import { articles, programs, runlog, state } from "./lib/store";
import { runResearch } from "./stages/research";
import { refreshHumanTasks, writeChecklist } from "./stages/humantasks";
import { writeOneArticle } from "./stages/content";
import { generatePinsForArticle, schedulingSummary } from "./stages/pins";
import { publishDuePins } from "./stages/publish";
import { buildSite } from "./site/build";
import { collectAnalytics } from "./stages/analytics";
import { runOptimizer } from "./stages/optimize";
import { buildGrowthAssets, buildReport } from "./stages/report";
import { closeBrowser } from "./pins/render";
import { nowISO } from "./lib/util";

const DAY = 86_400_000;

function olderThan(iso: string | null, days: number): boolean {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() > days * DAY;
}

/**
 * 毎日走らせる本体。
 * 案件が足りなければ探し、記事を1本書き、ピンを作って予約し、
 * 予約時刻を過ぎたピンを投稿し、サイトを作り直す。
 */
export async function runDaily(): Promise<string> {
  ensureDirs();
  const c = config();
  const notes: string[] = [];

  try {
    // 1. 案件が足りない or 1週間経っていたらリサーチ
    const active = programs.all().filter((p) => p.status !== "rejected" && p.status !== "paused");
    if (active.length < c.programs.targetActive || olderThan(state.get().lastResearchAt, 7)) {
      const r = await runResearch();
      state.patch({ lastResearchAt: nowISO() });
      notes.push(`案件リサーチ: 新規 ${r.added} 件`);
    } else {
      log.info(`案件は ${active.length} 件あるのでリサーチはスキップ`);
    }

    // 2. 人間しかできない作業を洗い出して下書きしておく
    const tasks = await refreshHumanTasks();
    notes.push(`人間タスク: 未完了 ${tasks.open} 件`);

    // 3. 記事を書く
    for (let i = 0; i < c.content.articlesPerRun; i++) {
      const written = await writeOneArticle();
      if (!written) break;
      notes.push(`記事: ${written.article.title}（${written.article.words} words${written.quality.ok ? "" : " ※要確認"}）`);

      // 4. その記事のピンを 10 枚作って予約
      const gen = await generatePinsForArticle(written.article.slug);
      notes.push(`ピン: ${gen.created} 枚を作成・予約`);
    }

    // 5. 予約時刻を過ぎたピンを投稿
    const pub = await publishDuePins();
    notes.push(`Pinterest 投稿: ${pub.published} 枚（残り ${pub.dueRemaining} 枚）`);

    // 6. サイトを作り直す
    const built = buildSite();
    notes.push(`サイト: ${built.pages} ページ / 中継リンク ${built.redirects} 本`);

    notes.push(schedulingSummary());
    writeChecklist();
  } finally {
    await closeBrowser();
  }

  const summary = notes.join(" / ");
  runlog.add({ at: nowISO(), command: "daily", ok: true, summary, details: notes });
  log.step("本日の自動実行が完了しました");
  notes.forEach((n) => log.ok(n));
  if (env.dryRun) log.warn("DRY_RUN で実行されました。ANTHROPIC_API_KEY を設定すると本番の文章が生成されます。");
  return summary;
}

/**
 * 週に1回走らせる本体。
 * 数値を取って、勝ち型を見つけて横展開し、レポートを書く。
 */
export async function runWeekly(): Promise<string> {
  ensureDirs();
  const notes: string[] = [];

  try {
    const a = await collectAnalytics(30);
    notes.push(`計測: 表示 ${a.impressions.toLocaleString()} / CTR ${a.ctrPct}% / 月額 $${a.monthlyRecurringUsd.toFixed(2)}`);

    const o = await runOptimizer();
    notes.push(`勝ち型 ${o.winners.length} 枚 → 横展開 ${o.expandedPins} 枚`);

    const growth = await buildGrowthAssets();
    if (growth) notes.push("マイルストーン到達: 発信素材を生成しました");

    const rep = buildReport();
    notes.push(rep.summary);

    buildSite();
    writeChecklist();
  } finally {
    await closeBrowser();
  }

  const summary = notes.join(" / ");
  runlog.add({ at: nowISO(), command: "weekly", ok: true, summary, details: notes });
  log.step("週次の自動実行が完了しました");
  notes.forEach((n) => log.ok(n));
  return summary;
}

/** 記事もピンも無い最初の1回だけ使う立ち上げ。 */
export async function runBootstrap(articleCount = 3): Promise<string> {
  ensureDirs();
  log.step(`初回セットアップ — 案件リサーチ + 記事 ${articleCount} 本 + ピン一式を一気に作ります`);
  const notes: string[] = [];

  try {
    const r = await runResearch();
    state.patch({ lastResearchAt: nowISO() });
    notes.push(`案件 ${r.accepted} 件を採用`);

    await refreshHumanTasks(5);

    for (let i = 0; i < articleCount; i++) {
      const written = await writeOneArticle();
      if (!written) break;
      const gen = await generatePinsForArticle(written.article.slug);
      notes.push(`${written.article.slug}: 記事 + ピン ${gen.created} 枚`);
    }

    const built = buildSite();
    notes.push(`サイト ${built.pages} ページ`);
    buildReport();
    writeChecklist();
  } finally {
    await closeBrowser();
  }

  log.step("初回セットアップ完了");
  log.info(`記事 ${articles.all().length} 本 / ${schedulingSummary()}`);
  log.human("TODO-HUMAN.md を開いて、そこに書かれた作業だけ済ませてください。");
  return notes.join(" / ");
}
