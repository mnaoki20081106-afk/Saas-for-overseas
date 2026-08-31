#!/usr/bin/env -S node --enable-source-maps
import { log } from "../lib/log";
import { ensureDirs } from "../lib/paths";
import { runlog } from "../lib/store";
import { nowISO } from "../lib/util";
import { assertNotKilled } from "./limits";
import { reportError } from "./report";
import { approvals, decisions, errors, ensureCompanyDirs } from "./store";
import { migrate } from "./commands/migrate";
import { companyStatus } from "./commands/status";
import { runCheck } from "./commands/check";
import {
  addTask, cancelTask, failTask, finishTask, listTasks, nextTask,
  reclaimStaleTasks, renderTaskList, startTask, unblockTasks,
} from "./commands/tasks";
import {
  APPROVAL_TEMPLATE, decideApproval, expireApprovals, renderApproval, requestApproval,
} from "./commands/approvals";
import { addDecision, handleError, pruneErrors, recordOutcome, renderDecisions, renderErrors } from "./commands/records";
import { RESEARCH_TEMPLATE, researcherContext, researcherSubmit } from "./commands/researcher";
import { writerContext, writerCheck, writerSubmit } from "./commands/writer";
import { REVIEW_TEMPLATE, editorContext, editorSubmit } from "./commands/editor";
import { PIN_TEMPLATE, designerContext, designerSubmit, renderMissingPins } from "./commands/designer";
import { qaCheck } from "./commands/qa";
import { releaseArticle, scheduleApprovedPins } from "./commands/release";
import { closeBrowser } from "../pins/render";
import type { EmployeeId, TaskKind } from "./schemas";

/**
 * `co` — AI会社の司令台。
 *
 * AI社員は data/ を直接編集しません。必ずこの CLI を通します。
 * その理由は3つです。
 *   1. スキーマ検証（従来の Claude API の構造化出力の代わり）
 *   2. 上限と重複の強制（お願いではなく、拒否する）
 *   3. 失敗の自動記録（AI が書き忘れることを許さない）
 *
 * 使い方: npm run co -- <コマンド>
 */

const HELP = `
AI会社の司令台

  npm run co -- <コマンド>

── まず最初に ──────────────────────────────────
  status                    会社の現在の状態（AI社員は毎回これを最初に読む）
  migrate                   データ構造を最新にする（追加のみ・冪等）
  check [--strict]          データと安全装置を検査する（guard.yml が使う）

── タスク ──────────────────────────────────────
  task:list [--assignee X] [--status Y]   タスク一覧
  task:next [--assignee X]                次にやる1件
  task:add --kind K [--target T] [--approval APV] [--depends A,B] [--priority N]
  task:start <id>                         着手する（試行回数は co が数える）
  task:done <id> [--output file.json]     完了
  task:fail <id> --error "..."            失敗（上限を超えたら自動で棚上げ）
  task:cancel <id> --reason "..."         取り下げ

── 承認（人間とのやりとり） ────────────────────
  approval:list [--all]                   承認依頼の一覧
  approval:show <id>                      1件を承認カードの形で表示
  approval:template                       依頼を書くための雛形JSONを出力
  approval:request <file.json>            承認依頼を出す
  approval:decide <id> <go|stop> [--note "..."]   決裁する（人間の操作）

── 記録 ────────────────────────────────────────
  decision:add <file.json>                意思決定を記録する（CEOは毎回必須）
  decision:list [--limit N]               決定の履歴
  decision:outcome <id> --result "..."    後日、結果を書き足す（学習用）
  error:list [--all]                      失敗の一覧
  error:handle <id> --resolution "..."    処理済みにする
  error:prune [--days N]                  古い処理済みエラーを捨てる

── AI社員の仕事 ────────────────────────────────
  researcher:context                      調査の前提を読む
  researcher:template                     提出用JSONの雛形
  researcher:submit <file.json>           調査結果を提出（足切り・スコアリング）

  writer:context <ideaId>                 執筆に必要な情報を読む
  writer:check <slug>                     品質ゲート（既存の checkQuality と同一基準）
  writer:submit <slug>                    提出 → Editor のタスクが作られる

  editor:context <slug>                   検品する（本文だけが渡される）
  editor:template                         提出用JSONの雛形
  editor:submit <file.json>               検品結果を提出（pass なら記事へ昇格）

  designer:context <slug>                 ピンを設計する
  designer:template                       提出用JSONの雛形
  designer:submit <file.json>             ピン文案を提出（draft として登録）

  qa:check <slug>                         最終検品（自動判定10項目 + AI判定4項目）

── 公開（承認が GO のときだけ通る） ────────────
  release:article <slug> --approval <id>  記事を公開対象にする
  release:pins <slug> --approval <id>     ピンに承認IDを刻んで予約する
                                          ★これを通らないピンは投稿されません

── 機械的な処理（Actions が実行する） ──────────
  pins:render                             画像のないピンを Chromium で描画
`;

type Handler = (args: string[]) => Promise<number> | number;

/** 読み取り専用のコマンド。killSwitch が有効でも実行してよい。 */
const READ_ONLY = new Set([
  "status", "check", "help", "--help", "-h",
  "task:list", "task:next", "approval:list", "approval:show", "approval:template",
  "decision:list", "error:list",
  "researcher:context", "researcher:template",
  "writer:context", "writer:check",
  "editor:context", "editor:template",
  "designer:context", "designer:template",
  "qa:check",
]);

/**
 * データファイルの自動作成をこちらでやらないコマンド。
 * migrate は「どのファイルを新しく作ったか」を自分で報告するため、
 * 先回りして作ってしまうとログが嘘になる。
 */
const SELF_INITIALISING = new Set(["migrate"]);

/* ------------------------------------------------------------ 引数の解釈 */

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

function requireFlag(args: string[], name: string): string {
  const v = flag(args, name);
  if (!v) throw new Error(`--${name} が必要です`);
  return v;
}

function requirePositional(args: string[], index: number, label: string): string {
  const v = args[index];
  if (!v || v.startsWith("--")) throw new Error(`${label} を指定してください`);
  return v;
}

/* -------------------------------------------------------------- コマンド */

const COMMANDS: Record<string, Handler> = {
  migrate() {
    migrate();
    return 0;
  },

  status() {
    companyStatus();
    return 0;
  },

  check(args) {
    const result = runCheck();
    const strict = args.includes("--strict");
    return result.errors > 0 || (strict && result.warnings > 0) ? 1 : 0;
  },

  /* ---------------------------------------------------------- tasks */

  "task:list"(args) {
    const reclaimed = reclaimStaleTasks();
    if (reclaimed) log.warn(`${reclaimed} 件のタスクを回収・期限切れ処理しました`);
    unblockTasks();
    const list = listTasks({ assignee: flag(args, "assignee"), status: flag(args, "status") });
    console.log(renderTaskList(list));
    return 0;
  },

  "task:next"(args) {
    const t = nextTask(flag(args, "assignee"));
    if (!t) {
      console.log("着手できるタスクはありません。");
      console.log("（承認待ちで止まっている場合は `co approval:list` を見てください）");
      return 0;
    }
    console.log(renderTaskList([t]));
    console.log(`\n入力:\n${JSON.stringify(t.input, null, 2)}`);
    console.log(`\n着手する: npm run co -- task:start ${t.id}`);
    return 0;
  },

  "task:add"(args) {
    const depends = flag(args, "depends");
    const task = addTask({
      kind: requireFlag(args, "kind") as TaskKind,
      targetRef: flag(args, "target") ?? null,
      assignee: flag(args, "assignee") as EmployeeId | undefined,
      priority: flag(args, "priority") ? Number(flag(args, "priority")) : undefined,
      requiresApprovalId: flag(args, "approval") ?? null,
      dependsOn: depends ? depends.split(",").map((s) => s.trim()).filter(Boolean) : [],
      input: flag(args, "input") ? (JSON.parse(flag(args, "input")!) as Record<string, unknown>) : {},
      createdBy: (flag(args, "by") as EmployeeId | undefined) ?? "yukichi",
    });
    log.ok(`タスクを作成: ${task.id} [${task.status}] ${task.kind} → ${task.assignee}`);
    if (task.status === "blocked") {
      log.info(task.requiresApprovalId
        ? `承認 ${task.requiresApprovalId} が GO になるまで着手できません`
        : `依存タスク（${task.dependsOn.join(", ")}）が終わるまで着手できません`);
    }
    return 0;
  },

  "task:start"(args) {
    const t = startTask(requirePositional(args, 0, "タスクID"));
    log.ok(`着手: ${t.id}（試行 ${t.attempts}/${t.maxAttempts}）`);
    console.log(`\n入力:\n${JSON.stringify(t.input, null, 2)}`);
    return 0;
  },

  "task:done"(args) {
    const t = finishTask(requirePositional(args, 0, "タスクID"), flag(args, "output"));
    log.ok(`完了: ${t.id}`);
    const unblocked = unblockTasks();
    if (unblocked) log.info(`${unblocked} 件のタスクが着手可能になりました`);
    return 0;
  },

  "task:fail"(args) {
    const t = failTask(requirePositional(args, 0, "タスクID"), requireFlag(args, "error"));
    log.info(`${t.id} → ${t.status}（試行 ${t.attempts}/${t.maxAttempts}）`);
    return 0;
  },

  "task:cancel"(args) {
    const t = cancelTask(requirePositional(args, 0, "タスクID"), requireFlag(args, "reason"));
    log.ok(`取り下げ: ${t.id}`);
    return 0;
  },

  /* ------------------------------------------------------- approvals */

  "approval:list"(args) {
    const expired = expireApprovals();
    if (expired) log.warn(`${expired} 件の承認依頼が期限切れになりました（実行しません）`);
    const all = args.includes("--all");
    const list = approvals.all().filter((a) => (all ? true : a.status === "pending"));
    if (list.length === 0) {
      console.log(all ? "承認依頼はありません。" : "承認待ちはありません。（--all で決裁済みも表示）");
      return 0;
    }
    for (const a of list) console.log(`${renderApproval(a)}\n`);
    return 0;
  },

  "approval:show"(args) {
    const id = requirePositional(args, 0, "承認ID");
    const a = approvals.all().find((x) => x.id === id);
    if (!a) throw new Error(`承認依頼が見つかりません: ${id}`);
    console.log(renderApproval(a));
    return 0;
  },

  "approval:template"() {
    console.log(JSON.stringify(APPROVAL_TEMPLATE, null, 2));
    return 0;
  },

  "approval:request"(args) {
    const a = requestApproval(requirePositional(args, 0, "JSONファイル"));
    log.ok(`承認依頼を作成しました: ${a.id}`);
    console.log(`\n${renderApproval(a)}`);
    log.human("なおきさんの GO を待ちます。決裁されるまで、この仕事は実行されません。");
    return 0;
  },

  "approval:decide"(args) {
    const id = requirePositional(args, 0, "承認ID");
    const decision = requirePositional(args, 1, "go または stop");
    if (decision !== "go" && decision !== "stop") throw new Error("go か stop を指定してください");
    const a = decideApproval(id, decision, flag(args, "note") ?? null);
    log.ok(`${a.id} → ${decision === "go" ? "GO（実行します）" : "STOP（実行しません）"}`);
    return 0;
  },

  /* --------------------------------------------------------- records */

  "decision:add"(args) {
    const d = addDecision(requirePositional(args, 0, "JSONファイル"));
    log.ok(`決定を記録: ${d.id} — ${d.summary}`);
    return 0;
  },

  "decision:list"(args) {
    console.log(renderDecisions(decisions.all(), Number(flag(args, "limit") ?? 20)));
    return 0;
  },

  "decision:outcome"(args) {
    const d = recordOutcome(requirePositional(args, 0, "決定ID"), requireFlag(args, "result"));
    log.ok(`${d.id} に結果を記録しました`);
    return 0;
  },

  "error:list"(args) {
    const all = args.includes("--all");
    console.log(renderErrors(errors.all().filter((e) => (all ? true : !e.handled))));
    return 0;
  },

  "error:handle"(args) {
    const e = handleError(requirePositional(args, 0, "エラーID"), requireFlag(args, "resolution"));
    log.ok(`${e.id} を処理済みにしました`);
    return 0;
  },

  "error:prune"(args) {
    const removed = pruneErrors(Number(flag(args, "days") ?? 90));
    log.ok(`${removed} 件の古い記録を削除しました`);
    return 0;
  },

  /* ------------------------------------------------------- employees */

  "researcher:context"() {
    researcherContext();
    return 0;
  },

  "researcher:template"() {
    console.log(JSON.stringify(RESEARCH_TEMPLATE, null, 2));
    return 0;
  },

  "researcher:submit"(args) {
    researcherSubmit(requirePositional(args, 0, "JSONファイル"));
    return 0;
  },

  "writer:context"(args) {
    writerContext(requirePositional(args, 0, "企画ID"));
    return 0;
  },

  "writer:check"(args) {
    return writerCheck(requirePositional(args, 0, "記事のslug")).ok ? 0 : 1;
  },

  "writer:submit"(args) {
    writerSubmit(requirePositional(args, 0, "記事のslug"));
    return 0;
  },

  "editor:context"(args) {
    editorContext(requirePositional(args, 0, "記事のslug"));
    return 0;
  },

  "editor:template"() {
    console.log(JSON.stringify(REVIEW_TEMPLATE, null, 2));
    return 0;
  },

  "editor:submit"(args) {
    editorSubmit(requirePositional(args, 0, "JSONファイル"));
    return 0;
  },

  "designer:context"(args) {
    designerContext(requirePositional(args, 0, "記事のslug"));
    return 0;
  },

  "designer:template"() {
    console.log(JSON.stringify(PIN_TEMPLATE, null, 2));
    return 0;
  },

  async "designer:submit"(args) {
    await designerSubmit(requirePositional(args, 0, "JSONファイル"));
    return 0;
  },

  "qa:check"(args) {
    return qaCheck(requirePositional(args, 0, "記事のslug")).failed === 0 ? 0 : 1;
  },

  "release:article"(args) {
    releaseArticle(requirePositional(args, 0, "記事のslug"), requireFlag(args, "approval"));
    return 0;
  },

  "release:pins"(args) {
    scheduleApprovedPins(requirePositional(args, 0, "記事のslug"), requireFlag(args, "approval"));
    return 0;
  },

  async "pins:render"() {
    await renderMissingPins();
    return 0;
  },

  help() {
    console.log(HELP);
    return 0;
  },
};

async function main(): Promise<void> {
  ensureDirs();
  const [command = "help", ...rest] = process.argv.slice(2);

  const handler = COMMANDS[command];
  if (!handler) {
    console.log(HELP);
    log.error(`不明なコマンド: ${command}`);
    process.exitCode = 1;
    return;
  }

  if (!READ_ONLY.has(command)) {
    // 停止中は書き込み系を一切通さない
    assertNotKilled();
    if (!SELF_INITIALISING.has(command)) ensureCompanyDirs();
  }

  try {
    const code = await handler(rest);
    if (code !== 0) process.exitCode = code;
  } finally {
    // pins:render / designer:submit が Chromium を起動することがあるので、必ず閉じる
    await closeBrowser();
  }
}

main().catch(async (err) => {
  await closeBrowser().catch(() => undefined);
  reportError(err, "cli");
  try {
    runlog.add({
      at: nowISO(),
      command: `co ${process.argv.slice(2).join(" ")}`,
      ok: false,
      summary: (err as Error).message.slice(0, 300),
    });
  } catch { /* 記録に失敗しても元のエラー報告は失わせない */ }
  process.exitCode = 1;
});
