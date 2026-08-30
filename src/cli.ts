#!/usr/bin/env -S node --enable-source-maps
import { setAffiliateLink } from "./lib/config";
import { log } from "./lib/log";
import { ensureDirs } from "./lib/paths";
import { articles, humanTasks, pins as pinStore, programs, runlog } from "./lib/store";
import { closeBrowser } from "./pins/render";
import { runResearch } from "./stages/research";
import { refreshHumanTasks, writeChecklist } from "./stages/humantasks";
import { writeOneArticle } from "./stages/content";
import { generatePinsForArticle, schedule, schedulingSummary } from "./stages/pins";
import { publishDuePins, requeueFailedPins } from "./stages/publish";
import { collectAnalytics } from "./stages/analytics";
import { runOptimizer } from "./stages/optimize";
import { buildGrowthAssets, buildReport } from "./stages/report";
import { buildSite } from "./site/build";
import { doctor } from "./stages/doctor";
import { runBootstrap, runDaily, runWeekly } from "./orchestrator";
import {
  authorizeUrl, exchangeCode, PINTEREST_SCOPES, waitForCallback,
} from "./integrations/pinterest";
import type { ProgramStatus } from "./lib/types";
import { nowISO } from "./lib/util";

const HELP = `
海外SaaSアフィリエイト自動化パイプライン

  npm run autopilot <コマンド>

── まず最初に ──────────────────────────────────
  doctor                 いま何が自動で動いて何が止まっているかを表示
  bootstrap [n]          初回セットアップ（リサーチ + 記事 n 本 + ピン一式）。既定 3
  tasks                  人間しかできない作業を洗い出して TODO-HUMAN.md を更新

── 毎日 / 毎週（GitHub Actions が自動で叩きます） ──
  daily                  リサーチ判定 → 記事1本 → ピン10枚 → 投稿 → サイト再生成
  weekly                 数値取得 → 勝ち型検出 → 横展開 → レポート

── 個別に動かす ────────────────────────────────
  research               継続報酬型SaaS案件をリサーチしてスコアリング
  article                英語記事を1本書く（設計→執筆→品質ゲート）
  pins [article-slug]    ピン10枚を生成して予約（省略時は最新記事）
  pins:publish [--limit N] [--force]   予約時刻を過ぎたピンを投稿
  pins:requeue           投稿に失敗したピンを再予約
  pins:list              予約状況を表示
  analytics [days]       Pinterest とアフィリエイトの数値を取得。既定 30 日
  optimize               勝ち型を検出して別カテゴリへ横展開
  site:build             public/ に静的サイトを生成
  report                 REPORT.md を更新
  growth [--force]       実績から発信素材とIntroducer提案を生成

── 設定 ────────────────────────────────────────
  pinterest:auth         Pinterest のリフレッシュトークンを取得（初回のみ）
  link:set <slug> <url>  承認されたアフィリエイトリンクを登録（全記事に自動反映）
  program:status <slug> <candidate|applied|approved|rejected|paused>
  task:done <id>         人間タスクを完了にする
  status                 いまの状態をまとめて表示
`;

function arg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

async function main(): Promise<void> {
  ensureDirs();
  const [command = "help", ...rest] = process.argv.slice(2);

  switch (command) {
    case "doctor":
      await doctor();
      break;

    case "bootstrap":
      await runBootstrap(Number(rest[0]) || 3);
      break;

    case "daily":
      await runDaily();
      break;

    case "weekly":
      await runWeekly();
      break;

    case "research":
      await runResearch();
      break;

    case "tasks":
      await refreshHumanTasks(Number(rest[0]) || 3);
      break;

    case "article": {
      const r = await writeOneArticle();
      if (r) log.ok(`→ ${r.article.filePath}`);
      break;
    }

    case "pins": {
      const slug = rest[0] ?? articles.all().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]?.slug;
      if (!slug) {
        log.error("記事がありません。先に `npm run autopilot article` を実行してください。");
        process.exitCode = 1;
        break;
      }
      await generatePinsForArticle(slug);
      log.info(schedulingSummary());
      break;
    }

    case "pins:publish": {
      const limit = arg(rest, "--limit");
      await publishDuePins({
        limit: limit ? Number(limit) : undefined,
        force: rest.includes("--force"),
      });
      break;
    }

    case "pins:requeue":
      requeueFailedPins();
      break;

    case "pins:list": {
      const all = pinStore.all();
      const byStatus = new Map<string, number>();
      for (const p of all) byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);
      log.info([...byStatus].map(([k, v]) => `${k}: ${v}`).join(" / ") || "ピンはまだありません");
      for (const p of all.filter((x) => x.status === "scheduled").sort((a, b) => (a.scheduledAt! < b.scheduledAt! ? -1 : 1)).slice(0, 20)) {
        log.info(`  ${p.scheduledAt?.slice(0, 16).replace("T", " ")} UTC  [${p.templateId}] ${p.overlayMain}`);
      }
      log.info(schedulingSummary());
      break;
    }

    case "pins:reschedule": {
      const all = pinStore.all();
      const pending = all.filter((p) => p.status === "queued" || p.status === "scheduled");
      const rest2 = all.filter((p) => !pending.includes(p));
      const rescheduled = schedule(pending.map((p) => ({ ...p, status: "queued", scheduledAt: null })));
      pinStore.save([...rest2, ...rescheduled]);
      log.ok(`${rescheduled.length} 枚を再スケジュールしました`);
      log.info(schedulingSummary());
      break;
    }

    case "analytics":
      await collectAnalytics(Number(rest[0]) || 30);
      break;

    case "optimize":
      await runOptimizer();
      break;

    case "site:build":
      buildSite();
      break;

    case "report":
      buildReport();
      writeChecklist();
      break;

    case "growth":
      await buildGrowthAssets(rest.includes("--force"));
      break;

    case "pinterest:auth": {
      const port = Number(process.env.PINTEREST_CALLBACK_PORT) || 8788;
      const redirectUri = process.env.PINTEREST_REDIRECT_URI ?? `http://localhost:${port}/callback`;
      log.step("Pinterest の認可を1回だけ行います");
      log.info(`必要なスコープ: ${PINTEREST_SCOPES}`);
      log.info("Pinterest の App 設定で、Redirect URI に次を登録しておいてください:");
      log.info(`  ${redirectUri}`);
      console.log("\nこの URL をブラウザで開いてください:\n");
      console.log(`  ${authorizeUrl(redirectUri)}\n`);
      const { code } = await waitForCallback(port);
      const token = await exchangeCode(code, redirectUri);
      console.log("\n以下を GitHub の Secrets（Settings → Secrets and variables → Actions）に登録してください:\n");
      console.log(`PINTEREST_REFRESH_TOKEN=${token.refresh_token}\n`);
      log.ok("取得できました。アクセストークンは以後このリフレッシュトークンから自動発行されます。");
      break;
    }

    case "link:set": {
      const [slug, url] = rest;
      if (!slug || !url) {
        log.error("使い方: npm run autopilot link:set <program-slug> <affiliate-url>");
        process.exitCode = 1;
        break;
      }
      if (!programs.bySlug(slug)) log.warn(`data/programs.json に ${slug} が見つかりません（登録は続行します）`);
      setAffiliateLink(slug, url);
      programs.setStatus(slug, "approved");
      humanTasks.close(`apply-${slug}`);
      log.ok(`${slug} のアフィリエイトリンクを登録しました。次のサイトビルドで全記事に反映されます。`);
      buildSite();
      writeChecklist();
      break;
    }

    case "program:status": {
      const [slug, status] = rest;
      const valid: ProgramStatus[] = ["candidate", "awaiting_apply", "applied", "approved", "rejected", "paused"];
      if (!slug || !valid.includes(status as ProgramStatus)) {
        log.error(`使い方: npm run autopilot program:status <slug> <${valid.join("|")}>`);
        process.exitCode = 1;
        break;
      }
      programs.setStatus(slug, status as ProgramStatus);
      log.ok(`${slug} → ${status}`);
      break;
    }

    case "task:done": {
      const id = rest[0];
      if (!id) {
        log.error("使い方: npm run autopilot task:done <task-id>");
        process.exitCode = 1;
        break;
      }
      humanTasks.close(id);
      writeChecklist();
      log.ok(`${id} を完了にしました`);
      break;
    }

    case "status": {
      const prog = programs.all();
      const arts = articles.all();
      const allPins = pinStore.all();
      console.log("");
      log.info(`案件         : ${prog.length} 件（承認済み ${prog.filter((p) => p.status === "approved").length}）`);
      log.info(`記事         : ${arts.length} 本（要確認 ${arts.filter((a) => a.status === "needs_review").length}）`);
      log.info(`ピン         : ${allPins.length} 枚（投稿済み ${allPins.filter((p) => p.status === "published").length} / 予約 ${allPins.filter((p) => p.status === "scheduled").length} / 失敗 ${allPins.filter((p) => p.status === "failed").length}）`);
      log.info(`人間タスク   : 未完了 ${humanTasks.open().length} 件`);
      log.info(schedulingSummary());
      const last = runlog.all()[0];
      if (last) log.info(`最終実行     : ${last.at.slice(0, 16).replace("T", " ")} [${last.command}] ${last.summary}`);
      console.log("");
      break;
    }

    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      break;

    default:
      console.log(HELP);
      log.error(`不明なコマンド: ${command}`);
      process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    log.error((err as Error).message);
    if (process.env.DEBUG) console.error(err);
    runlog.add({ at: nowISO(), command: process.argv.slice(2).join(" "), ok: false, summary: (err as Error).message });
    process.exitCode = 1;
  })
  .finally(() => closeBrowser());
