import { config } from "../../lib/config";
import { publishGate } from "../../lib/guard";
import { articles, humanTasks, metrics, pins, programs, runlog, state } from "../../lib/store";
import { todayISO, usd } from "../../lib/util";
import { isColdStart, limits } from "../limits";
import { kv, section } from "../report";
import { approvals, decisions, drafts, employees, errors, ideas, research, reviews, tasks } from "../store";

/**
 * 会社の現在の状態を1画面で出す。
 *
 * これは AI社員が実行開始時に最初に読むものであり、
 * 同時に人間が「いま何が起きているか」を見るものでもある。
 * したがって出力は日本語で、専門用語を避ける。
 */
export function companyStatus(): void {
  const c = config();
  const l = limits();
  const st = state.get();
  const today = todayISO();

  const allPins = pins.all();
  const measuredPins = allPins.filter(
    (p) => (p.metrics?.impressions ?? 0) >= l.coldStart.minImpressionsPerPin,
  ).length;
  const cold = isColdStart(measuredPins);

  console.log(`\n# ${c.site.name} — 会社の状態  (${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC)`);

  if (l.killSwitch.enabled) {
    console.log("\n🛑 **会社は停止中です。** 何も実行しないでください。");
    console.log(`   理由: ${l.killSwitch.reason || "(未記入)"}`);
    console.log("   再開は、なおきさんが管理画面（/admin/）から行います。\n");
    return;
  }

  const gate = publishGate();
  section("公開ゲート", gate.ok
    ? "開いています。作ったものは（承認を得れば）公開できます。"
    : `🚧 閉じています — ${gate.reason}\n${gate.howToFix.map((s) => `  ${s}`).join("\n")}`);

  section("フェーズ", [
    kv([
      ["いまのフェーズ", `${st.phase ?? "bootstrap"}（${cold ? "コールドスタート中" : "データ蓄積済み"}）`],
      ["判定できるピン", `${measuredPins} 枚 / 必要 ${l.coldStart.minPinsWithEnoughImpressions} 枚（${l.coldStart.minImpressionsPerPin} 表示以上）`],
    ]),
    "",
    cold
      ? "⚠ コールドスタート中です。**「どれが良いか」を判断してはいけません。**\n" +
        "  記事タイプ・テンプレート・配色・切り口を機械的にローテーションして、データを作ってください。\n" +
        "  企画の basedOn.confidence は必ず low、sampleSize は実際の数（0 でよい）を正直に書いてください。"
      : "データが貯まっています。実績に基づいて判断してよい段階です。",
  ]);

  const active = programs.all().filter((p) => p.status !== "rejected" && p.status !== "paused");
  const approved = programs.all().filter((p) => p.status === "approved");
  section("案件", kv([
    ["登録数", `${programs.all().length} 件（有効 ${active.length} / 承認済み ${approved.length}）`],
    ["リサーチ候補", `${research.all().length} 件（採用 ${research.all().filter((r) => r.verdict === "accepted").length}）`],
    ["最終リサーチ", st.lastResearchAt ?? "まだ一度も実行していません"],
  ]));
  if (approved.length === 0) {
    console.log("\n  ⚠ **承認済みのアフィリエイト案件が0件です。** この状態では、記事を何本書いても収益は発生しません。");
    console.log("     なおきさんがアフィリエイトプログラムに応募して承認をもらう必要があります（人間しかできません）。");
  }

  section("コンテンツ", kv([
    ["企画", `${ideas.all().filter((i) => i.status === "proposed").length} 件が提案中`],
    ["下書き", `${drafts.list().length} 本（content/drafts/）`],
    ["公開記事", `${articles.all().filter((a) => a.status === "published").length} 本 / 要確認 ${articles.all().filter((a) => a.status === "needs_review").length} 本`],
    ["検品記録", `${reviews.all().length} 件`],
  ]));

  const byStatus = new Map<string, number>();
  for (const p of allPins) byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);
  section("ピン", kv([
    ["合計", `${allPins.length} 枚（${[...byStatus].map(([k, v]) => `${k} ${v}`).join(" / ") || "なし"}）`],
    ["本日の投稿上限", `${l.output.maxPinsPublishedPerDay} 枚`],
  ]));

  const m = metrics.get();
  const last = m.history[m.history.length - 1];
  section("数字", last
    ? kv([
      ["最終計測", m.updatedAt.slice(0, 10)],
      ["表示数", last.impressions.toLocaleString()],
      ["外部クリック", `${last.outboundClicks.toLocaleString()}（CTR ${last.ctrPct}%）`],
      ["継続報酬", `${usd(last.monthlyRecurringUsd)}/月・有効サブスク ${last.activeSubscriptions} 件`],
    ])
    : "まだ一度も計測していません。投稿が始まってから 2〜3ヶ月は数字が動かないのが正常です。");

  const open = tasks.all().filter((t) => ["blocked", "ready", "running"].includes(t.status));
  const ready = open.filter((t) => t.status === "ready");
  const parked = tasks.all().filter((t) => t.status === "parked");
  section("タスク", [
    kv([
      ["未完了", `${open.length} 件 / 上限 ${l.output.maxOpenTasks}`],
      ["着手可能", `${ready.length} 件`],
      ["棚上げ（要判断）", `${parked.length} 件`],
    ]),
    ...(ready.length
      ? ["", "着手可能なタスク:",
        ...ready.slice(0, 10).map((t) => `  ${t.id}  [${t.kind}] ${t.assignee} → ${t.targetRef ?? "-"}`)]
      : []),
  ]);

  const pending = approvals.all().filter((a) => a.status === "pending");
  section("承認", [
    kv([
      ["承認待ち", `${pending.length} 件 / 同時上限 ${l.output.maxPendingApprovals}`],
      ["本日の決裁", `${approvals.all().filter((a) => a.decidedAt?.startsWith(today)).length} 件`],
    ]),
    ...(pending.length
      ? ["", "待っているもの:", ...pending.map((a) => `  ${a.id}  ${a.title}（期限 ${a.expiresAt.slice(0, 16).replace("T", " ")} UTC）`)]
      : []),
  ]);

  const unhandled = errors.all().filter((e) => !e.handled);
  section("失敗", unhandled.length
    ? [
      `未処理 ${unhandled.length} 件 / 上限 ${l.output.maxUnhandledErrors}`,
      ...unhandled.slice(0, 5).map((e) => `  ${e.id} [${e.where}] ${e.message.slice(0, 100)}`),
      unhandled.length >= l.output.maxUnhandledErrors
        ? "\n  ⚠ 上限に達しています。掃除するまで新しいタスクは作れません。" : "",
    ]
    : "未処理の失敗はありません。");

  const openHuman = humanTasks.open();
  section("なおきさんの作業", openHuman.length
    ? [
      `未完了 ${openHuman.length} 件（合計 約${openHuman.reduce((s, t) => s + t.minutes, 0)}分）→ TODO-HUMAN.md`,
      ...openHuman.map((t) => `  ・${t.title}（約${t.minutes}分）`),
    ]
    : "ありません。");

  const emp = employees.all();
  section("組織（3層構造・4人）", [
    "第1層  オーナー（なおきさん）  GO / STOP・経営判断・換金の判断",
    "         ↑↓ 対話するのはここだけ",
    ...Object.entries(emp)
      .sort((a, b) => a[1].layer - b[1].layer)
      .map(([id, cfg]) => {
        const runs = employees.runsOn(id, today);
        const cap = cfg.maxRunsPerDay !== undefined ? `${runs}/${cfg.maxRunsPerDay} 回` : `${runs} 回`;
        const sub = cfg.hasSubordinates ? "" : "・部下なし（自分で手を動かす）";
        return `第${cfg.layer}層  ${cfg.role} ${cfg.displayName}` +
          `  ${cfg.active ? "稼働中" : "停止中"}  本日 ${cap}${sub}` +
          `\n         道具: ${cfg.owns.join(", ")}`;
      }),
  ]);

  const lastRun = runlog.all()[0];
  section("直近の実行", lastRun
    ? `${lastRun.at.slice(0, 16).replace("T", " ")} [${lastRun.command}] ${lastRun.ok ? "成功" : "失敗"}\n  ${lastRun.summary}`
    : "記録なし");

  section("決定の履歴", decisions.all().length
    ? decisions.all().slice(-5).reverse().map((d) => `- ${d.at.slice(0, 10)} [${d.kind}] ${d.summary}`).join("\n")
    : "まだありません。");

  console.log("");
}
