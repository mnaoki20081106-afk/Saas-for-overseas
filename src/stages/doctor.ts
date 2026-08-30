import fs from "node:fs";
import { config, env } from "../lib/config";
import { log } from "../lib/log";
import { P } from "../lib/paths";
import { articles, humanTasks, pins, programs } from "../lib/store";
import { getBrowser, closeBrowser } from "../pins/render";
import { verifyKey } from "../lib/claude";

interface Check { name: string; ok: boolean; detail: string; blocks: string }

export interface DoctorResult { checks: Check[]; ready: boolean; automationPct: number }

export async function doctor(): Promise<DoctorResult> {
  log.step("環境チェック — いま何が自動で動いて、何が止まっているか");
  const c = config();
  const checks: Check[] = [];

  const push = (name: string, ok: boolean, detail: string, blocks: string) =>
    checks.push({ name, ok, detail, blocks });

  // キーの有無ではなく、実際に通るかを確かめる（countTokens は無料）
  const key = await verifyKey();
  push(
    "Anthropic API キー",
    key.ok,
    key.ok ? key.detail : `${key.detail} → いまは DRY_RUN（サンプル出力）で動作します`,
    "案件リサーチ / 記事生成 / ピン文案",
  );

  push(
    "Pinterest API",
    env.pinterest.configured,
    env.pinterest.configured
      ? env.pinterest.accessToken ? "アクセストークン直指定（期限切れに注意）" : "リフレッシュトークン方式（自動更新されます）"
      : "未設定 → ピンは生成・予約されますが投稿は保留になります",
    "ピンの自動投稿 / 数値取得 / 勝ち型検出",
  );

  const networks = [
    ["Impact", env.impact.configured],
    ["ShareASale", env.shareasale.configured],
    ["PartnerStack", env.partnerstack.configured],
  ] as const;
  const anyNetwork = networks.some(([, ok]) => ok);
  push(
    "アフィリエイトネットワーク API",
    anyNetwork,
    anyNetwork
      ? `接続済み: ${networks.filter(([, ok]) => ok).map(([n]) => n).join(", ")}`
      : "未設定 → 売上の自動集計だけができません（記事とピンは動きます）",
    "売上の自動集計 / 実測の継続月数",
  );

  const baseOk = !c.site.baseUrl.includes("example.");
  push(
    "サイト URL",
    baseOk,
    baseOk ? c.site.baseUrl : `${c.site.baseUrl} ← config/config.json の site.baseUrl を自分の GitHub Pages の URL に変えてください`,
    "ピンのリンク先 / canonical / sitemap",
  );

  push(
    "Pinterest のサイト所有権確認",
    Boolean(c.site.pinterestVerifyCode),
    c.site.pinterestVerifyCode
      ? "確認コードを埋め込み済み"
      : "未設定 → Pinterest の Claim website で出るコードを config の site.pinterestVerifyCode に入れてください（未設定でも投稿はできますが、リンクの信頼度が下がります）",
    "ピンの表示優先度 / リンクの信頼度",
  );

  let chromiumOk = false;
  let chromiumDetail = "";
  try {
    const b = await getBrowser();
    chromiumDetail = `起動できました（${b.version()}）`;
    chromiumOk = true;
    await closeBrowser();
  } catch (err) {
    chromiumDetail = (err as Error).message.split("\n")[0];
  }
  push("Chromium（ピン画像の描画）", chromiumOk, chromiumDetail, "ピン画像の生成");

  const dataOk = fs.existsSync(P.data);
  push("データディレクトリ", dataOk, dataOk ? "data/ あり" : "初回実行時に作成されます", "-");

  for (const ch of checks) {
    if (ch.ok) log.ok(`${ch.name}: ${ch.detail}`);
    else log.warn(`${ch.name}: ${ch.detail}`);
  }

  const openTasks = humanTasks.open();
  const weights: Record<string, number> = {
    "Anthropic API キー": 45,
    "Pinterest API": 28,
    "アフィリエイトネットワーク API": 10,
    "サイト URL": 8,
    "Pinterest のサイト所有権確認": 4,
    "Chromium（ピン画像の描画）": 5,
  };
  const automationPct = Math.round(
    checks.reduce((s, ch) => s + (ch.ok ? weights[ch.name] ?? 0 : 0), 0),
  );

  console.log("");
  log.info(`いまの自動化率: ${automationPct}% / 100%`);
  log.info(`案件 ${programs.all().length} 件 · 記事 ${articles.all().length} 本 · ピン ${pins.all().length} 枚`);
  if (openTasks.length) {
    log.human(`未完了の人間タスク ${openTasks.length} 件（合計 約${openTasks.reduce((s, t) => s + t.minutes, 0)}分）→ TODO-HUMAN.md`);
  } else {
    log.ok("人間タスクはありません");
  }

  return { checks, ready: checks.every((ch) => ch.ok), automationPct };
}
