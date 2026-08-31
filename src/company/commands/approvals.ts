import fs from "node:fs";
import { log } from "../../lib/log";
import { state } from "../../lib/store";
import { nowISO, todayISO, usd } from "../../lib/util";
import { assertCanRequestApproval, assertNotRecentlyRejected, limits } from "../limits";
import { Approval, ApprovalRequest, validate } from "../schemas";
import type { Approval as ApprovalT } from "../schemas";
import { approvals, tasks } from "../store";
import { unblockTasks } from "./tasks";

/**
 * 人間への承認依頼。
 *
 * 設計原則: なおきさんに技術的な判断を要求しない。
 * 押すのは GO か STOP だけ。そのために、判断に必要な材料
 * （何が起きるか / なぜか / いくらになりそうか / 断ったらどうなるか）を
 * スキーマで必須にしてある。AI が書き忘れると、そもそも依頼を作れない。
 *
 * 期限切れは「実行しない」に倒す。承認が取れないまま勝手に動くことは絶対にない。
 */

/** 期限切れの承認依頼を expired にする。読むたびに実行する。 */
export function expireApprovals(): number {
  const list = approvals.all();
  let expired = 0;
  const now = Date.now();
  for (const a of list) {
    if (a.status === "pending" && new Date(a.expiresAt).getTime() < now) {
      a.status = "expired";
      expired++;
    }
  }
  if (expired) {
    approvals.save(list);
    // 承認が取れなかったタスクは実行しない。取り下げる。
    const expiredIds = new Set(list.filter((a) => a.status === "expired").map((a) => a.id));
    const taskList = tasks.all();
    let cancelled = 0;
    for (const t of taskList) {
      if (t.requiresApprovalId && expiredIds.has(t.requiresApprovalId) && t.status === "blocked") {
        t.status = "cancelled";
        t.finishedAt = nowISO();
        t.lastError = "承認が期限内に得られなかったため実行しませんでした";
        cancelled++;
      }
    }
    if (cancelled) tasks.save(taskList);
  }
  return expired;
}

export function requestApproval(file: string): ApprovalT {
  if (!fs.existsSync(file)) {
    throw new Error(
      `ファイルがありません: ${file}\n` +
      "承認依頼の JSON を先に書いてください。項目は `co approval:template` で確認できます。",
    );
  }
  expireApprovals();
  assertCanRequestApproval();

  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  const req = validate(ApprovalRequest, raw, "approval:request");

  // 同じ提案を繰り返さない（STOP されたものはクールダウンする）
  assertNotRecentlyRejected(req.kind, req.expected.programName);

  const l = limits();
  const approval: ApprovalT = {
    ...req,
    id: `apv_${todayISO()}-${String(approvals.all().filter((a) => a.createdAt.startsWith(todayISO())).length + 1).padStart(2, "0")}`,
    status: "pending",
    createdAt: nowISO(),
    expiresAt: new Date(Date.now() + l.approval.expiryHours * 3600_000).toISOString(),
    decidedAt: null,
    decidedBy: null,
    decisionNote: null,
  };
  validate(Approval, approval, "approval:request");
  approvals.add(approval);
  return approval;
}

export function decideApproval(
  id: string, decision: "go" | "stop", note: string | null, by: "human" | "auto" = "human",
): ApprovalT {
  const list = approvals.all();
  const a = list.find((x) => x.id === id);
  if (!a) throw new Error(`承認依頼が見つかりません: ${id}`);
  if (a.status !== "pending") {
    throw new Error(`${id} はすでに ${a.status} です。決裁し直すことはできません。`);
  }
  a.status = decision;
  a.decidedAt = nowISO();
  a.decidedBy = by;
  a.decisionNote = note;
  approvals.save(list);

  if (decision === "go") {
    unblockTasks();
    // 自律レベル昇格の判定に使うカウンタ
    const st = state.get();
    state.patch({ consecutiveApprovedPublishes: (st.consecutiveApprovedPublishes ?? 0) + 1 });
  } else {
    // STOP されたら、その承認に紐づくタスクは実行しない
    const taskList = tasks.all();
    let cancelled = 0;
    for (const t of taskList) {
      if (t.requiresApprovalId === id && ["blocked", "ready"].includes(t.status)) {
        t.status = "cancelled";
        t.finishedAt = nowISO();
        t.lastError = `承認が却下されました${note ? `: ${note}` : ""}`;
        cancelled++;
      }
    }
    if (cancelled) tasks.save(taskList);
    state.patch({ consecutiveApprovedPublishes: 0 });
    log.info(`${cancelled} 件のタスクを取り下げました`);
  }
  return a;
}

/** 承認カードを人間が読む形で描く（ターミナルと管理画面で同じ内容にするための元） */
export function renderApproval(a: ApprovalT): string {
  const e = a.expected;
  const money = (v: number | null) => (v === null ? "不明" : usd(v));
  const pctOf = (v: number | null) => (v === null ? "不明" : `${v}%`);

  const lines = [
    "┌────────────────────────────────────────────────",
    `│ ${a.title}`,
    `│ ${a.id}   状態: ${statusLabel(a.status)}`,
    "├────────────────────────────────────────────────",
    "│ 【やること】",
    ...a.whatWillHappen.map((w) => `│   ・${w}`),
    "│",
    "│ 【なぜこれか】",
    ...wrap(a.whyThis, 46).map((l) => `│   ${l}`),
    "│",
    "│ 【お金の見込み】",
    ...(e.programName ? [`│   案件        : ${e.programName}`] : []),
    `│   月額報酬    : ${money(e.monthlyCommissionUsd)}`,
    `│   想定継続    : ${e.retentionMonths === null ? "不明" : `${e.retentionMonths} ヶ月`}`,
    `│   想定LTV     : ${money(e.ltvUsd)}`,
    `│   推定CTR     : ${pctOf(e.estimatedCtrPct)}`,
    `│   推定成約率  : ${pctOf(e.estimatedConversionPct)}`,
    `│   推定収益    : ${e.estimatedRevenueUsdMin === null ? "不明" : `${money(e.estimatedRevenueUsdMin)} 〜 ${money(e.estimatedRevenueUsdMax)}`}`,
    `│   かかる費用  : ${usd(a.costUsd)}`,
    "│",
    "│ 【この見込みの根拠】",
    ...wrap(e.basis, 46).map((l) => `│   ${l}`),
    ...(a.risks.length ? ["│", "│ 【気をつける点】", ...a.risks.map((r) => `│   ・${r}`)] : []),
    "│",
    "│ 【断った場合】",
    ...wrap(a.ifYouSayNo, 46).map((l) => `│   ${l}`),
    "├────────────────────────────────────────────────",
    `│ 期限: ${a.expiresAt.slice(0, 16).replace("T", " ")} UTC まで`,
    ...(a.status === "pending"
      ? ["│", "│        [  GO  ]          [  STOP  ]", "│",
        `│  ターミナル: npm run co -- approval:decide ${a.id} go`,
        "│  iPad     : /admin/ を開いてボタンを押す"]
      : [`│ 決裁: ${a.decidedAt?.slice(0, 16).replace("T", " ")} UTC (${a.decidedBy})${a.decisionNote ? ` — ${a.decisionNote}` : ""}`]),
    "└────────────────────────────────────────────────",
  ];
  return lines.join("\n");
}

function statusLabel(s: string): string {
  return { pending: "承認待ち", go: "GO（承認済み）", stop: "STOP（却下）", expired: "期限切れ（実行しません）" }[s] ?? s;
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const ch of text) {
    // 日本語は全角なので2文字ぶんとして数える
    const w = ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
    if (line.length + w > width || ch === "\n") {
      out.push(line);
      line = ch === "\n" ? "" : ch;
    } else {
      line += ch;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

/** AI が承認依頼を書くときの雛形 */
export const APPROVAL_TEMPLATE = {
  kind: "daily_plan",
  title: "（日本語1行。何をするのかが分かること）",
  whatWillHappen: ["（実行内容を箇条書きで）"],
  whyThis: "（なぜこれを選んだか。根拠の数字を必ず含める。データがないならその旨を正直に書く）",
  expected: {
    programName: null,
    monthlyCommissionUsd: null,
    retentionMonths: null,
    ltvUsd: null,
    estimatedCtrPct: null,
    estimatedConversionPct: null,
    estimatedRevenueUsdMin: null,
    estimatedRevenueUsdMax: null,
    basis: "（推定の根拠。まだデータがないなら『まだ根拠となるデータがありません。データを作るための1本です』と書く）",
  },
  costUsd: 0,
  risks: [],
  ifYouSayNo: "（断った場合どうなるか。日本語）",
  taskIds: [],
};
