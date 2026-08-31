import fs from "node:fs";
import { log } from "../../lib/log";
import { nowISO, todayISO, uid } from "../../lib/util";
import { assertCanCreateTask, limits } from "../limits";
import { Task, TaskKind, EmployeeId, validate } from "../schemas";
import type { EmployeeId as EmployeeIdT, TaskKind as TaskKindT, Task as TaskT } from "../schemas";
import { approvals, tasks } from "../store";

/**
 * 社内タスクキュー。
 *
 * ここが「AI社員が会話せずに連携する」ための唯一の窓口です。
 * 誰が何をやるか、前提が揃っているか、何回失敗したかを、すべてここが持ちます。
 *
 * 重要な設計:
 *   - 冪等キーで重複を弾く（同じ仕事を2回作れない）
 *   - attempts は AI が申告せず、co が採番する（自己申告だと再実行でリセットされる）
 *   - 落ちたセッションの running タスクを自動で回収する
 */

/**
 * 誰がその種類の仕事をするか。AI が勝手に担当を決められないようにする。
 *
 * 担当は 諭吉 / 英世 / 一葉 / 梅子 / Actions だけです。
 * 3人（英世・一葉・梅子）は部下を持たないので、下に振り直すことはできません。
 *
 * ★ 検品（edit_article / qa_release）は、書いた人ではなく **梅子** に渡ります。
 *   自分が書いた文章を自分で検品すると、無意識に擁護してしまうためです。
 */
const DEFAULT_ASSIGNEE: Record<TaskKindT, EmployeeIdT> = {
  research: "hideyo",         // CMO 英世（自分で調べる）
  plan_article: "yukichi",    // CEO 諭吉（企画は諭吉が決める）
  write_article: "ichiyo",    // CTO 一葉（自分で書く）
  edit_article: "umeko",      // ★CQO 梅子（書いていない人が読む）
  design_pins: "hideyo",      // CMO 英世（自分でピン文案を作る）
  qa_release: "umeko",        // ★CQO 梅子（事実・出典・リンクの照合）
  publish_article: "actions", // 実行は GitHub Actions（オーナーの GO の後）
  publish_pins: "actions",
  post_x: "actions",
  collect_metrics: "actions",
  analyze: "yukichi",         // CEO 諭吉（分析して次を決める）
  fix_error: "yukichi",
};

/**
 * 検品の仕事は、この担当以外に割り当てられません（`co` が拒否します）。
 *
 * 書き手（一葉）と検品者（梅子）を別人格に保つための安全装置です。
 * 手順書に書くだけでは守られないので、コードで止めています。
 */
const INSPECTION_ONLY_ASSIGNEE: Partial<Record<TaskKindT, EmployeeIdT>> = {
  edit_article: "umeko",
  qa_release: "umeko",
};

/** その仕事は外に出るか（＝人間の承認が要るか） */
const GATE_FOR_KIND: Partial<Record<TaskKindT, string>> = {
  publish_article: "publishArticle",
  publish_pins: "publishPins",
  post_x: "postToX",
};

export function idempotencyKeyFor(kind: TaskKindT, targetRef: string | null, date = todayISO()): string {
  return `${kind}:${targetRef ?? "-"}:${date}`;
}

/**
 * 落ちたセッションが残した running タスクを回収する。
 * 呼ぶたびに実行する（cron ではなく、次に誰かが来たときに掃除する方式）。
 */
export function reclaimStaleTasks(): number {
  const l = limits();
  const cutoff = Date.now() - l.routine.staleRunningTaskMinutes * 60_000;
  const list = tasks.all();
  let reclaimed = 0;

  for (const t of list) {
    if (t.status === "running" && t.startedAt && new Date(t.startedAt).getTime() < cutoff) {
      t.status = t.attempts >= t.maxAttempts ? "parked" : "ready";
      t.startedAt = null;
      t.lastError = `${l.routine.staleRunningTaskMinutes} 分以上 running のままだったため回収しました（セッションが落ちた可能性）`;
      reclaimed++;
    }
    // 期限切れのタスクは自動で取り下げる（無限に残らないように）
    if (["blocked", "ready"].includes(t.status) && new Date(t.expiresAt).getTime() < Date.now()) {
      t.status = "cancelled";
      t.finishedAt = nowISO();
      t.lastError = "期限切れ（作成から規定日数が経過したため自動で取り下げました）";
      reclaimed++;
    }
  }
  if (reclaimed) tasks.save(list);
  return reclaimed;
}

/** 依存タスクが全部 done なら blocked → ready にする */
export function unblockTasks(): number {
  const list = tasks.all();
  const doneIds = new Set(list.filter((t) => t.status === "done").map((t) => t.id));
  const goIds = new Set(approvals.all().filter((a) => a.status === "go").map((a) => a.id));
  let unblocked = 0;

  for (const t of list) {
    if (t.status !== "blocked") continue;
    const depsMet = t.dependsOn.every((id) => doneIds.has(id));
    const approvalMet = t.requiresApprovalId === null || goIds.has(t.requiresApprovalId);
    if (depsMet && approvalMet) {
      t.status = "ready";
      unblocked++;
    }
  }
  if (unblocked) tasks.save(list);
  return unblocked;
}

export interface AddTaskInput {
  kind: TaskKindT;
  targetRef?: string | null;
  assignee?: EmployeeIdT;
  priority?: number;
  input?: Record<string, unknown>;
  dependsOn?: string[];
  requiresApprovalId?: string | null;
  createdBy?: EmployeeIdT;
}

export class DuplicateTaskError extends Error {
  constructor(public existing: TaskT) {
    super(
      `同じ仕事がすでにあります: ${existing.id} [${existing.status}] ${existing.idempotencyKey}\n` +
      "同じ日に同じ対象へ同じ種類の仕事は作れません（重複生成の防止）。\n" +
      "既存のタスクを進めるか、対象を変えてください。",
    );
    this.name = "DuplicateTaskError";
  }
}

export function addTask(input: AddTaskInput): TaskT {
  assertCanCreateTask();
  const l = limits();
  const kind = validate(TaskKind, input.kind, "task:add kind");
  const targetRef = input.targetRef ?? null;
  const key = idempotencyKeyFor(kind, targetRef);

  // 同じ冪等キーの仕事が「生きている」なら作らせない。
  // cancelled / failed のものは作り直してよい（対処したうえでの再挑戦）。
  const existing = tasks.all().find(
    (t) => t.idempotencyKey === key && ["blocked", "ready", "running", "done"].includes(t.status),
  );
  if (existing) throw new DuplicateTaskError(existing);

  // ★ 検品の独立性を、コードで強制する。
  //
  //   自分が書いた文章を自分で検品すると、無意識に擁護してしまいます。
  //   これは能力ではなく構造の問題なので、手順書ではなくここで止めます。
  //   検品（edit_article / qa_release）は書き手ではなく梅子にしか渡せません。
  const forced = INSPECTION_ONLY_ASSIGNEE[kind];
  if (forced && input.assignee && input.assignee !== forced) {
    throw new Error(
      `[${kind}] は検品の仕事なので、${forced} 以外には割り当てられません。\n` +
      `指定された担当: ${input.assignee}\n` +
      "検品は、本文を書いていない梅子だけが行います。\n" +
      "書いた人が自分で検品すると、無意識に自分を擁護してしまうためです。\n" +
      "これは能力ではなく構造の問題で、手順や気合では直りません。\n" +
      "どう直すか: --assignee を外してください（自動で梅子に渡ります）。\n" +
      "理由の詳細: skills/quality-gate.md",
    );
  }

  const gate = GATE_FOR_KIND[kind];
  const needsApproval = gate ? (l.gates[gate]?.requiresApproval ?? true) : false;
  if (needsApproval && !input.requiresApprovalId) {
    throw new Error(
      `[${kind}] は外部に出る仕事なので、人間の承認が必要です。\n` +
      "先に `co approval:request <file.json>` で承認依頼を作り、\n" +
      "その承認ID を --approval <id> で渡してください。",
    );
  }

  const task: TaskT = {
    id: uid("task"),
    idempotencyKey: key,
    kind,
    assignee: input.assignee ?? DEFAULT_ASSIGNEE[kind],
    // 承認待ち or 依存ありなら blocked から始める
    status: (input.requiresApprovalId || (input.dependsOn?.length ?? 0) > 0) ? "blocked" : "ready",
    priority: input.priority ?? 3,
    targetRef,
    input: input.input ?? {},
    output: null,
    requiresApprovalId: input.requiresApprovalId ?? null,
    dependsOn: input.dependsOn ?? [],
    attempts: 0,
    maxAttempts: l.quality.taskMaxAttempts,
    createdAt: nowISO(),
    startedAt: null,
    finishedAt: null,
    expiresAt: new Date(Date.now() + l.quality.taskExpiryDays * 86_400_000).toISOString(),
    lastError: null,
    createdBy: validate(EmployeeId, input.createdBy ?? "yukichi", "task:add createdBy"),
  };

  validate(Task, task, "task:add");
  tasks.add(task);
  return task;
}

export function listTasks(filter: { assignee?: string; status?: string } = {}): TaskT[] {
  reclaimStaleTasks();
  unblockTasks();
  return tasks.all()
    .filter((t) => (filter.assignee ? t.assignee === filter.assignee : true))
    .filter((t) => (filter.status ? t.status === filter.status : true))
    .sort((a, b) => a.priority - b.priority || (a.createdAt < b.createdAt ? -1 : 1));
}

/** 次にやるべき1件を返す（AI社員はこれを見て動く） */
export function nextTask(assignee?: string): TaskT | null {
  return listTasks({ assignee, status: "ready" })[0] ?? null;
}

export function startTask(id: string): TaskT {
  const list = tasks.all();
  const t = list.find((x) => x.id === id);
  if (!t) throw new Error(`タスクが見つかりません: ${id}`);
  if (t.status !== "ready") {
    throw new Error(
      `タスク ${id} は ${t.status} なので着手できません。` +
      (t.status === "blocked" ? "承認待ちか、前提のタスクが終わっていません。" : ""),
    );
  }
  // ★attempts は co が採番する。AI に自己申告させると、セッションが落ちて
  //   再実行されたときにリセットされ、無限ループになる。
  t.attempts += 1;
  t.status = "running";
  t.startedAt = nowISO();
  tasks.save(list);
  return t;
}

export function finishTask(id: string, outputFile?: string): TaskT {
  const list = tasks.all();
  const t = list.find((x) => x.id === id);
  if (!t) throw new Error(`タスクが見つかりません: ${id}`);
  let output: Record<string, unknown> | null = null;
  if (outputFile) {
    if (!fs.existsSync(outputFile)) throw new Error(`出力ファイルがありません: ${outputFile}`);
    output = JSON.parse(fs.readFileSync(outputFile, "utf8")) as Record<string, unknown>;
  }
  t.status = "done";
  t.output = output;
  t.finishedAt = nowISO();
  t.lastError = null;
  tasks.save(list);
  unblockTasks();
  return t;
}

export function failTask(id: string, error: string): TaskT {
  const list = tasks.all();
  const t = list.find((x) => x.id === id);
  if (!t) throw new Error(`タスクが見つかりません: ${id}`);
  t.lastError = error.slice(0, 1000);
  if (t.attempts >= t.maxAttempts) {
    // これ以上は自動で試さない。CEO の判断に回す。
    t.status = "parked";
    t.finishedAt = nowISO();
    log.warn(`${id} は ${t.attempts} 回失敗したので棚上げしました。CEO が判断してください。`);
  } else {
    t.status = "ready";
    t.startedAt = null;
  }
  tasks.save(list);
  return t;
}

export function cancelTask(id: string, reason: string): TaskT {
  const list = tasks.all();
  const t = list.find((x) => x.id === id);
  if (!t) throw new Error(`タスクが見つかりません: ${id}`);
  t.status = "cancelled";
  t.finishedAt = nowISO();
  t.lastError = reason;
  tasks.save(list);
  return t;
}

export function renderTaskList(list: TaskT[]): string {
  if (list.length === 0) return "（なし）";
  return list.map((t) => {
    const bits = [
      t.id,
      `[${t.status}]`,
      t.kind.padEnd(16),
      `→ ${t.assignee}`,
      t.targetRef ? `対象: ${t.targetRef}` : "",
      t.attempts > 0 ? `試行 ${t.attempts}/${t.maxAttempts}` : "",
      t.requiresApprovalId ? `承認 ${t.requiresApprovalId}` : "",
      t.dependsOn.length ? `依存 ${t.dependsOn.join(",")}` : "",
    ].filter(Boolean);
    const line = bits.join("  ");
    return t.lastError ? `${line}\n     └ ${t.lastError.slice(0, 160)}` : line;
  }).join("\n");
}
