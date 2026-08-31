#!/usr/bin/env -S node --enable-source-maps
import { log } from "../lib/log";
import { ensureDirs } from "../lib/paths";
import { runlog } from "../lib/store";
import { nowISO } from "../lib/util";
import { assertNotKilled } from "./limits";
import { reportError } from "./report";
import { ensureCompanyDirs } from "./store";
import { migrate } from "./commands/migrate";
import { companyStatus } from "./commands/status";
import { runCheck } from "./commands/check";

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
  status                 会社の現在の状態を表示（AI社員は毎回これを最初に読む）
  migrate                データ構造を最新にする（追加のみ・冪等）
  check                  データと安全装置を検査する（guard.yml が使う）

── 使えるコマンドは実装が進むごとに増えます ────
  （Phase 1-B 以降: task / approval / decision / 各AI社員のコマンド）
`;

type Handler = (args: string[]) => Promise<number> | number;

/** 読み取り専用のコマンド。killSwitch が有効でも実行してよい。 */
const READ_ONLY = new Set(["status", "check", "help", "--help", "-h"]);

/**
 * データファイルの自動作成をこちらでやらないコマンド。
 * migrate は「どのファイルを新しく作ったか」を自分で報告するため、
 * 先回りして作ってしまうとログが嘘になる。
 */
const SELF_INITIALISING = new Set(["migrate"]);

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
    // --strict なら警告でも失敗させる（guard.yml の本番運用で使う）
    const strict = args.includes("--strict");
    return result.errors > 0 || (strict && result.warnings > 0) ? 1 : 0;
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

  const code = await handler(rest);
  if (code !== 0) process.exitCode = code;
}

main().catch((err) => {
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
