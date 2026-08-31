import fs from "node:fs";
import { nowISO, uid } from "../../lib/util";
import { Decision, DecisionInput, validate } from "../schemas";
import type { Decision as DecisionT, ErrorRecord } from "../schemas";
import { decisions, errors } from "../store";

/**
 * 意思決定ログと失敗ログ。
 *
 * decisions.json の狙いは「3ヶ月後に、あのときの判断は当たっていたのかを振り返れること」です。
 * そのために reasoning と evidence を必須にし、あとから outcome を埋められるようにしています。
 * 記録のない判断は、学習に使えません。
 */

export function addDecision(file: string): DecisionT {
  if (!fs.existsSync(file)) throw new Error(`ファイルがありません: ${file}`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  const input = validate(DecisionInput, raw, "decision:add");
  const decision: DecisionT = {
    ...input,
    id: uid("dec"),
    at: nowISO(),
    outcome: input.outcome ?? null,
    outcomeAt: null,
  };
  validate(Decision, decision, "decision:add");
  decisions.add(decision);
  return decision;
}

/** 後日、結果が分かったときに書き足す。ここが自己改善の材料になる。 */
export function recordOutcome(id: string, outcome: string): DecisionT {
  const updated = decisions.replace((d) => d.id === id, { outcome, outcomeAt: nowISO() });
  if (!updated) throw new Error(`決定が見つかりません: ${id}`);
  return updated;
}

export function renderDecisions(list: DecisionT[], limit = 20): string {
  if (list.length === 0) return "（まだありません）";
  return list.slice(-limit).reverse().map((d) => {
    const head = `${d.at.slice(0, 16).replace("T", " ")}  ${d.id}  [${d.kind}] ${d.summary}`;
    const why = `    理由: ${d.reasoning.slice(0, 200)}`;
    const ev = d.evidence.length
      ? `    根拠: ${d.evidence.map((e) => `${e.source} = ${e.value}`).join(" / ")}`
      : "    根拠: (なし)";
    const alt = d.alternatives.length ? `    他の選択肢: ${d.alternatives.join(" / ")}` : "";
    const out = d.outcome ? `    結果: ${d.outcome}` : "    結果: (まだ分からない)";
    return [head, why, ev, alt, out].filter(Boolean).join("\n");
  }).join("\n\n");
}

/* ----------------------------------------------------------------- errors */

export function handleError(id: string, resolution: string): ErrorRecord {
  const updated = errors.replace((e) => e.id === id, {
    handled: true, handledAt: nowISO(), resolution,
  });
  if (!updated) throw new Error(`エラー記録が見つかりません: ${id}`);
  return updated;
}

export function renderErrors(list: ErrorRecord[]): string {
  if (list.length === 0) return "（ありません）";
  return list.map((e) => {
    const head = `${e.at.slice(0, 16).replace("T", " ")}  ${e.id}  [${e.kind}] ${e.where}${e.taskId ? ` (${e.taskId})` : ""}`;
    const msg = `    ${e.message.slice(0, 300)}`;
    const res = e.handled ? `    → 処理済み: ${e.resolution}` : "    → 未処理";
    return [head, msg, res].join("\n");
  }).join("\n\n");
}

/**
 * 90日を過ぎた処理済みエラーを捨てる（→ DESIGN_REVIEW.md §9）。
 * 放っておくとファイルが太り続け、AI が読むコストになる。
 */
export function pruneErrors(days = 90): number {
  const cutoff = Date.now() - days * 86_400_000;
  const list = errors.all();
  const kept = list.filter((e) => !(e.handled && e.handledAt && new Date(e.handledAt).getTime() < cutoff));
  const removed = list.length - kept.length;
  if (removed) errors.save(kept);
  return removed;
}
