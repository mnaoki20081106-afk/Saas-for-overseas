import { log } from "../lib/log";
import { DuplicateError } from "./dedupe";
import { LimitExceeded, KillSwitchOn } from "./limits";
import { ValidationError } from "./schemas";
import { errors } from "./store";
import { nowISO, uid } from "../lib/util";
import type { EmployeeId } from "./schemas";

/**
 * AI社員に向けたエラーの出し方。
 *
 * ふつうのエラーメッセージは「何が起きたか」しか書きませんが、
 * ここでは「どう直すか」まで必ず書きます。AI がそれを読んで自分で修正できる形にするためです。
 * これが従来の構造化出力（output_config.format）のリトライループの代わりになります。
 */

export function explain(err: unknown): { title: string; lines: string[]; kind: string } {
  if (err instanceof ValidationError) {
    return {
      kind: "validation",
      title: `${err.label}: 提出したデータが規定の形になっていません（${err.failures.length} 件）`,
      lines: [
        ...err.failures.map((f) => `  ・${f.path} — ${f.message}`),
        "",
        "上の項目だけを直して、同じコマンドをもう一度実行してください。",
        "値が分からない項目は、推測で埋めずに null を入れて unverified に項目名を足してください。",
      ],
    };
  }
  if (err instanceof DuplicateError) {
    return {
      kind: "logic",
      title: `重複しています（${err.hits.length} 件）`,
      lines: [
        ...err.hits.flatMap((h) => [`  ・[${h.kind}] ${h.detail}`]),
        "",
        "同じものを作り直さないでください。別の切り口・別のキーワードにするか、",
        "この仕事自体をやめて、既存のものを使ってください。",
      ],
    };
  }
  if (err instanceof LimitExceeded) {
    return {
      kind: "limit",
      title: err.message,
      lines: ["", err.whatToDo],
    };
  }
  if (err instanceof KillSwitchOn) {
    return {
      kind: "limit",
      title: err.message,
      lines: [
        "",
        "会社は停止中です。何も実行せずに終了してください。",
        "再開はなおきさんが管理画面（/admin/）から行います。",
      ],
    };
  }
  const e = err as Error;
  return { kind: "unknown", title: e?.message ?? String(err), lines: [] };
}

/** エラーを画面に出し、errors.json にも記録する（AI が記録し忘れることを許さない） */
export function reportError(err: unknown, where: EmployeeId, taskId: string | null = null): void {
  const info = explain(err);
  log.error(info.title);
  info.lines.forEach((l) => console.log(l));

  try {
    errors.add({
      id: uid("err"),
      at: nowISO(),
      where,
      taskId,
      kind: info.kind as "validation" | "logic" | "limit" | "unknown",
      message: info.title,
      detail: info.lines.join("\n") || null,
      recoverable: info.kind !== "unknown",
      handled: false,
      handledAt: null,
      resolution: null,
    });
  } catch {
    // エラーの記録に失敗しても、元のエラー報告は失わせない
    log.warn("errors.json への記録に失敗しました");
  }
}

/** AI が読む「見出し付きのブロック」を出す。context 系コマンドの体裁を揃えるため。 */
export function section(title: string, body: string | string[]): void {
  const text = Array.isArray(body) ? body.join("\n") : body;
  console.log(`\n## ${title}\n`);
  console.log(text);
}

export function kv(pairs: [string, unknown][]): string {
  return pairs.map(([k, v]) => `- ${k}: ${v === null || v === undefined || v === "" ? "(なし)" : v}`).join("\n");
}
