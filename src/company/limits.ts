import { readJson } from "../lib/store";
import { todayISO } from "../lib/util";
import { CP, employees, errors, tasks, approvals } from "./store";

/**
 * 安全装置。config/limits.json を読み、上限を「守ってください」ではなく
 * 「守らせる」形で強制する。
 *
 * 重要: この判定は AI社員のプロンプトではなくコードに置く。
 * プロンプトに「20件を超えないでください」と書いても守られないことがあるが、
 * CLI が拒否すれば必ず守られる。
 */

export interface Limits {
  output: {
    maxArticlesPerDay: number;
    maxPinsPerDay: number;
    maxPinsPerArticleTotal: number;
    maxPinsPublishedPerDay: number;
    maxXPostsPerDay: number;
    maxOpenTasks: number;
    maxPendingApprovals: number;
    maxUnhandledErrors: number;
  };
  routine: {
    maxRunsPerDay: number;
    minMinutesBetweenRuns: number;
    maxMinutesPerRun: number;
    staleRunningTaskMinutes: number;
  };
  duplication: {
    articleHeadingOverlapMaxPct: number;
    requireUniquePrimaryKeyword: boolean;
    requireUniquePinImageHash: boolean;
    requireUniquePinCopyHash: boolean;
  };
  quality: {
    requireEvidenceUrlForNumbers: boolean;
    blockPublishOnBrokenLinks: boolean;
    maxEditorRounds: number;
    taskMaxAttempts: number;
    taskExpiryDays: number;
  };
  gates: Record<string, { requiresApproval: boolean; humanExecutes?: boolean }>;
  autonomy: Record<string, { autoAfter: Record<string, unknown> | null }>;
  approval: { expiryHours: number; rejectedCooldownDays: number };
  experiment: {
    maxConcurrent: number; minSamplePerVariant: number;
    minImpressionsPerPin: number; minRelativeDiffPct: number;
  };
  coldStart: {
    minPinsWithEnoughImpressions: number;
    minImpressionsPerPin: number;
    minConversionsForProgramJudgement: number;
  };
  killSwitch: { enabled: boolean; reason: string };
}

let cached: Limits | null = null;
export function limits(): Limits {
  if (!cached) {
    cached = readJson<Limits>(CP.limits, null as unknown as Limits);
    if (!cached) throw new Error("config/limits.json が見つかりません。`npm run co -- migrate` を実行してください。");
  }
  return cached;
}

/** テスト用にキャッシュを捨てる */
export function resetLimitsCache(): void {
  cached = null;
}

/* --------------------------------------------------------- 上限違反の表現 */

export class LimitExceeded extends Error {
  constructor(public limitName: string, public detail: string, public whatToDo: string) {
    super(`上限に達しています [${limitName}]: ${detail}`);
    this.name = "LimitExceeded";
  }
}

export class KillSwitchOn extends Error {
  constructor(reason: string) {
    super(`会社は停止中です。config/limits.json の killSwitch が有効です。理由: ${reason || "(未記入)"}`);
    this.name = "KillSwitchOn";
  }
}

/** すべての書き込み系コマンドの冒頭で呼ぶ。 */
export function assertNotKilled(): void {
  const k = limits().killSwitch;
  if (k.enabled) throw new KillSwitchOn(k.reason);
}

/* ------------------------------------------------------------ 個別の判定 */

/** 未処理のタスクが多すぎないか（掃除が先） */
export function assertCanCreateTask(): void {
  const l = limits();
  const open = tasks.all().filter((t) => ["blocked", "ready", "running"].includes(t.status));
  if (open.length >= l.output.maxOpenTasks) {
    throw new LimitExceeded(
      "output.maxOpenTasks",
      `未完了タスクが ${open.length} 件（上限 ${l.output.maxOpenTasks}）`,
      "新しい仕事を作る前に、既存のタスクを done / cancelled にしてください。" +
        "`npm run co -- task:list` で一覧が見られます。",
    );
  }
  const unhandled = errors.all().filter((e) => !e.handled);
  if (unhandled.length >= l.output.maxUnhandledErrors) {
    throw new LimitExceeded(
      "output.maxUnhandledErrors",
      `未処理のエラーが ${unhandled.length} 件（上限 ${l.output.maxUnhandledErrors}）`,
      "新しい仕事を作る前に、エラーを分類してください。" +
        "`npm run co -- error:list` で一覧、`error:handle <id> --resolution '...'` で処理済みにします。",
    );
  }
}

/** 承認依頼が溜まりすぎていないか（画面が溢れないように） */
export function assertCanRequestApproval(): void {
  const l = limits();
  const pending = approvals.all().filter((a) => a.status === "pending");
  if (pending.length >= l.output.maxPendingApprovals) {
    throw new LimitExceeded(
      "output.maxPendingApprovals",
      `承認待ちが ${pending.length} 件（上限 ${l.output.maxPendingApprovals}）`,
      "なおきさんの画面が溢れないよう、同時に出せる承認依頼は制限しています。" +
        "既存の承認が決裁されるか期限切れになるまで、新しい依頼は出せません。",
    );
  }
}

/**
 * 同じ提案を繰り返さない。STOP された提案は一定期間クールダウンする。
 * 「しつこいAI」は人間の承認をただの作業にしてしまうので、ここは厳しくする。
 */
export function assertNotRecentlyRejected(kind: string, targetRef: string | null): void {
  const l = limits();
  const cutoff = Date.now() - l.approval.rejectedCooldownDays * 86_400_000;
  const rejected = approvals.all().find((a) =>
    a.status === "stop" &&
    a.kind === kind &&
    (targetRef === null || a.taskIds.length === 0 || a.title.includes(targetRef)) &&
    a.decidedAt !== null &&
    new Date(a.decidedAt).getTime() > cutoff);
  if (rejected) {
    throw new LimitExceeded(
      "approval.rejectedCooldownDays",
      `同じ提案が ${rejected.decidedAt?.slice(0, 10)} に STOP されています（${rejected.title}）`,
      `${l.approval.rejectedCooldownDays} 日間は同じ提案を出せません。別の案を考えてください。` +
        (rejected.decisionNote ? `\n断られた理由: ${rejected.decisionNote}` : ""),
    );
  }
}

/** 社員ごとの実行回数の上限 */
export function assertCanRun(employeeId: string): void {
  const cfg = employees.all()[employeeId];
  if (!cfg) throw new Error(`知らない社員です: ${employeeId}`);
  if (!cfg.active) {
    throw new LimitExceeded(
      `employees.${employeeId}.active`,
      `${employeeId} はこのフェーズではまだ稼働しません`,
      "分析対象のデータが存在しないうちは起動しません（→ DESIGN_REVIEW.md §6）。" +
        "有効にするには data/employees.json の active を true にしてください。",
    );
  }
  const today = todayISO();
  if (cfg.maxRunsPerDay !== undefined) {
    const n = employees.runsOn(employeeId, today);
    if (n >= cfg.maxRunsPerDay) {
      throw new LimitExceeded(
        `employees.${employeeId}.maxRunsPerDay`,
        `${employeeId} は本日すでに ${n} 回動いています（上限 ${cfg.maxRunsPerDay}）`,
        "明日まで待ってください。急ぐ場合は data/employees.json の上限を上げてください。",
      );
    }
  }
  if (cfg.maxRunsPerWeek !== undefined) {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const n = employees.runsSince(employeeId, since);
    if (n >= cfg.maxRunsPerWeek) {
      throw new LimitExceeded(
        `employees.${employeeId}.maxRunsPerWeek`,
        `${employeeId} は直近7日で ${n} 回動いています（上限 ${cfg.maxRunsPerWeek}）`,
        "リサーチは頻繁にやっても在庫が増えるだけです。既存の案件を使い切ってください。",
      );
    }
  }
}

/** その行為に人間の承認が必要か */
export function requiresApproval(gate: string): boolean {
  return limits().gates[gate]?.requiresApproval ?? true; // 知らないゲートは安全側（承認必須）に倒す
}

/**
 * コールドスタート期間中か。
 * true のあいだ、AI は「どれが良いか」を判断してはいけない。
 * データを作るために、機械的にローテーションで出す。
 */
export function isColdStart(pinsWithEnoughImpressions: number): boolean {
  return pinsWithEnoughImpressions < limits().coldStart.minPinsWithEnoughImpressions;
}
