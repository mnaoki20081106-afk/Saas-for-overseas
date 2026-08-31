import { z } from "zod";

/**
 * 会社のデータ構造の定義。
 *
 * ここが「Claude API の構造化出力機能」の代わりです。
 * 従来は Anthropic API の output_config.format に zod スキーマを渡して JSON の形を
 * 保証していましたが、それは API 固有の機能でした。移行後は AI社員が書いた JSON を
 * この定義でコマンドとして検証します。落ちればエラーが表示され、AI が直します。
 *
 * つまり「形の保証」は API 機能ではなく、このリポジトリのコードが担保します。
 */

const iso = z.string().describe("ISO8601 の日時文字列");
const isoOrNull = z.string().nullable();

/**
 * この会社にいる人。
 *
 *   yukichi … CEO 諭吉。オーナーと対話する唯一の役職
 *   hideyo  … CMO 英世。案件リサーチと Pinterest（部下なし）
 *   ichiyo  … CTO 一葉。記事の構成と執筆（部下なし）
 *   umeko   … CQO 梅子。検品（部下なし）
 *
 * ★ 梅子は「書いていない人」です。
 *   一葉が書いた記事を、企画の意図を知らない状態で読みます。
 *   自分が書いた文章を自分で検品すると無意識に擁護してしまうため、
 *   検品は必ず書き手と別の人格が行います。
 *
 * 人ではないもの:
 *   actions … GitHub Actions（投稿・公開・数値取得を実行する）
 *   cli     … co コマンド自身（自動記録用）
 *   human   … オーナー
 */
export const EMPLOYEE_IDS = [
  "yukichi", "hideyo", "ichiyo", "umeko",
  "actions", "cli", "human",
] as const;
export const EmployeeId = z.enum(EMPLOYEE_IDS);
export type EmployeeId = z.infer<typeof EmployeeId>;

/* -------------------------------------------------------------------- task */

export const TASK_KINDS = [
  "research", "plan_article", "write_article", "edit_article", "design_pins",
  "qa_release", "publish_article", "publish_pins", "post_x", "collect_metrics",
  "analyze", "fix_error",
] as const;
export const TaskKind = z.enum(TASK_KINDS);
export type TaskKind = z.infer<typeof TaskKind>;

export const TASK_STATUSES = [
  "blocked", "ready", "running", "done", "failed", "parked", "cancelled",
] as const;
export const TaskStatus = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const Task = z.object({
  id: z.string(),
  /** "<kind>:<targetRef>:<yyyy-mm-dd>" — 同じキーのタスクは二重に作れない */
  idempotencyKey: z.string(),
  kind: TaskKind,
  assignee: EmployeeId,
  status: TaskStatus,
  priority: z.number().int().min(1).max(5),
  targetRef: z.string().nullable(),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()).nullable(),
  requiresApprovalId: z.string().nullable(),
  dependsOn: z.array(z.string()),
  attempts: z.number().int().min(0),
  maxAttempts: z.number().int().min(1),
  createdAt: iso,
  startedAt: isoOrNull,
  finishedAt: isoOrNull,
  expiresAt: iso,
  lastError: z.string().nullable(),
  createdBy: EmployeeId,
});
export type Task = z.infer<typeof Task>;

/* ---------------------------------------------------------------- approval */

export const APPROVAL_KINDS = [
  "daily_plan", "publish_article", "publish_pins", "post_x",
  "strategy_change", "limit_change", "autonomy_upgrade", "escalation",
] as const;
export const ApprovalKind = z.enum(APPROVAL_KINDS);
export type ApprovalKind = z.infer<typeof ApprovalKind>;

export const ApprovalStatus = z.enum(["pending", "go", "stop", "expired"]);

/**
 * 承認依頼。人間が読む部分は全部日本語で、専門用語を使わないこと。
 * 「なおきは技術的な判断をしない」が最上位の設計原則なので、
 * 判断に必要な材料（何が起きるか・なぜか・いくらになりそうか・断ったらどうなるか）を
 * 必ず添える。スキーマで必須にすることで、AI が書き忘れられないようにしている。
 */
export const Approval = z.object({
  id: z.string(),
  kind: ApprovalKind,
  status: ApprovalStatus,

  title: z.string().min(1).describe("日本語。何をするのかが1行で分かること"),
  whatWillHappen: z.array(z.string().min(1)).min(1).describe("日本語。実行内容の箇条書き"),
  whyThis: z.string().min(1).describe("日本語。なぜこれを選んだか。根拠の数字を含める"),
  expected: z.object({
    programName: z.string().nullable(),
    monthlyCommissionUsd: z.number().nullable(),
    retentionMonths: z.number().nullable(),
    ltvUsd: z.number().nullable(),
    estimatedCtrPct: z.number().nullable(),
    estimatedConversionPct: z.number().nullable(),
    estimatedRevenueUsdMin: z.number().nullable(),
    estimatedRevenueUsdMax: z.number().nullable(),
    basis: z.string().min(1).describe(
      "推定の根拠。データがないなら『まだ根拠となるデータがありません』と正直に書く",
    ),
  }),
  costUsd: z.number().min(0),
  risks: z.array(z.string()),
  ifYouSayNo: z.string().min(1).describe("日本語。断った場合どうなるか"),

  taskIds: z.array(z.string()),
  createdAt: iso,
  expiresAt: iso,
  decidedAt: isoOrNull,
  decidedBy: z.enum(["human", "auto"]).nullable(),
  decisionNote: z.string().nullable(),
});
export type Approval = z.infer<typeof Approval>;

/** AI が承認依頼を出すときに書く部分（id や日時は co が採番する） */
export const ApprovalRequest = Approval.omit({
  id: true, status: true, createdAt: true, expiresAt: true,
  decidedAt: true, decidedBy: true, decisionNote: true,
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

/* ---------------------------------------------------------------- decision */

export const Decision = z.object({
  id: z.string(),
  at: iso,
  by: EmployeeId,
  kind: z.enum(["prioritise", "skip", "escalate", "experiment", "abandon", "config_change"]),
  summary: z.string().min(1).describe("日本語1行"),
  reasoning: z.string().min(1).describe("なぜそう決めたか。参照した数値を必ず含める"),
  evidence: z.array(z.object({
    source: z.string().describe('見たデータ。例: "data/kpis.json#2026-08-30"'),
    value: z.string(),
  })),
  alternatives: z.array(z.string()).describe("検討して選ばなかった選択肢"),
  relatedTaskIds: z.array(z.string()),
  outcome: z.string().nullable().describe("後日、結果が出たら追記する（学習用）"),
  outcomeAt: isoOrNull,
});
export type Decision = z.infer<typeof Decision>;

export const DecisionInput = Decision.omit({ id: true, at: true, outcome: true, outcomeAt: true })
  .extend({ outcome: z.string().nullable().default(null) });

/* ---------------------------------------------------------------- research */

export const NETWORKS = [
  "Impact", "ShareASale", "CJ", "PartnerStack", "Direct",
  "Rewardful", "FirstPromoter", "Tapfiliate", "Awin", "Unknown",
] as const;

export const Evidence = z.object({
  field: z.string().describe("どの項目の根拠か。例: 'commissionRatePct'"),
  url: z.string().url(),
  quote: z.string().min(1).describe("そのページに実際に書かれていた文（要約ではなく引用）"),
});

export const ResearchCandidate = z.object({
  id: z.string(),
  discoveredAt: iso,
  name: z.string().min(1),
  homepage: z.string().url(),
  affiliateProgramUrl: z.string().url(),
  network: z.enum(NETWORKS),
  category: z.string().min(1).describe("小文字。例: 'email marketing'"),

  pricingFromUsd: z.number().nullable(),
  commissionModel: z.enum(["recurring", "one-time", "hybrid", "unknown"]),
  commissionRatePct: z.number().nullable(),
  cookieDays: z.number().nullable(),
  estMonthlyCommissionUsd: z.number().nullable(),
  estAvgRetentionMonths: z.number().nullable(),
  estLtvUsd: z.number().nullable(),

  targetMarket: z.array(z.string()),
  mainCompetitors: z.array(z.string()),
  existingEnglishArticles: z.number().nullable().describe("実際に検索して数えた件数"),
  englishCoverageQuality: z.enum(["thin", "outdated", "moderate", "saturated"]).nullable(),
  searchDemand: z.enum(["low", "medium", "high", "unknown"]),
  pinterestFit: z.number().min(1).max(10).describe("視覚的に説明できる商材か"),
  approvalDifficulty: z.number().min(1).max(10).describe("1 = すぐ通る"),

  japaneseCompetition: z.number().min(1).max(10),
  englishCompetition: z.number().min(1).max(10),
  reliability: z.number().min(1).max(10),

  whyGoodFit: z.string().min(1),
  targetPains: z.array(z.string()).min(1),

  evidence: z.array(Evidence),
  unverified: z.array(z.string()).describe("出典が取れなかった項目名。推測で埋めずにここへ"),

  score: z.number().nullable(),
  verdict: z.enum(["accepted", "rejected", "deferred"]),
  rejectReason: z.string().nullable(),
});
export type ResearchCandidate = z.infer<typeof ResearchCandidate>;

/** AI が提出する部分（id / discoveredAt / score / verdict は co が決める） */
export const ResearchSubmission = z.object({
  candidates: z.array(
    ResearchCandidate.omit({
      id: true, discoveredAt: true, score: true, verdict: true, rejectReason: true,
    }),
  ).min(1),
});
export type ResearchSubmission = z.infer<typeof ResearchSubmission>;

/* ------------------------------------------------------------------- idea */

export const ARTICLE_TYPES = ["comparison", "alternatives", "best-for-pain", "deep-review"] as const;

export const ContentIdea = z.object({
  id: z.string(),
  createdAt: iso,
  status: z.enum(["proposed", "approved", "writing", "published", "rejected"]),

  programSlug: z.string(),
  supportingProgramSlugs: z.array(z.string()),
  articleType: z.enum(ARTICLE_TYPES),
  workingTitle: z.string().min(1),
  primaryKeyword: z.string().min(1),
  secondaryKeywords: z.array(z.string()),
  searchIntent: z.string().min(1),
  targetWordsMin: z.number().int().min(500),
  targetWordsMax: z.number().int().min(500),
  competitorWordCounts: z.array(z.number()).describe("実際に測った上位記事の語数。測っていなければ空"),
  pinterestAngles: z.array(z.string()).describe("Designer への申し送り"),

  /** ★自己改善の中核。データがない時期は confidence: low / sampleSize: 0 を正直に書く */
  basedOn: z.array(z.object({
    signal: z.string().min(1),
    source: z.string().min(1),
    confidence: z.enum(["low", "medium", "high"]),
    sampleSize: z.number().int().min(0),
  })).min(1),

  expectedCtrPct: z.number().nullable(),
  expectedConversionPct: z.number().nullable(),
  cannibalizationCheck: z.object({
    similarSlugs: z.array(z.string()),
    maxOverlapPct: z.number().min(0).max(100),
  }),
});
export type ContentIdea = z.infer<typeof ContentIdea>;

export const IdeaSubmission = z.object({
  ideas: z.array(ContentIdea.omit({ id: true, createdAt: true, status: true, cannibalizationCheck: true })).min(1),
});

/* ----------------------------------------------------------------- review */

export const Finding = z.object({
  category: z.string().min(1),
  severity: z.enum(["blocker", "major", "minor"]),
  quote: z.string().min(1).describe("該当箇所の引用。指摘の再現性のために必須"),
  problem: z.string().min(1),
  suggestion: z.string().min(1),
  fixed: z.boolean(),
});

export const Review = z.object({
  id: z.string(),
  targetType: z.enum(["article", "pin", "release"]),
  targetRef: z.string(),
  /**
   * 検品の「種類」。どちらも CQO 梅子が行います（書き手とは別人格）。
   *   editor … 文章として自然か（読み物としての質）
   *   qa     … 事実・出典・リンク・メタデータが正しいか
   * 段階を分けているのは、文章の検品と事実の照合では見る目が違うためです。
   */
  reviewer: z.enum(["editor", "qa"]),
  /** ★AI が自己申告しない。co が「既存レビュー件数 + 1」で採番する */
  round: z.number().int().min(1),
  at: iso,
  verdict: z.enum(["pass", "fix", "reject", "needs_human"]),
  findings: z.array(Finding),
  readerImpression: z.string().nullable().describe(
    "Editor のみ:『読むのをやめたくなった段落』とその理由。なければ 'なし'",
  ),
  checklistResults: z.record(z.string(), z.enum(["pass", "fail", "na"])),
});
export type Review = z.infer<typeof Review>;

export const ReviewSubmission = Review.omit({ id: true, round: true, at: true });
export type ReviewSubmission = z.infer<typeof ReviewSubmission>;

/* ------------------------------------------------------------------- pins */

export const TEMPLATE_IDS = ["bold-stat", "split-card", "checklist", "versus", "editorial"] as const;

export const PinDraft = z.object({
  templateId: z.enum(TEMPLATE_IDS),
  title: z.string().min(1).max(95),
  description: z.string().min(80).max(400).describe(
    "開示は co が先頭に自動で付けるので、自分で書かないこと。affiliate / sponsored / ad の語も使わない",
  ),
  overlayTop: z.string().max(28),
  overlayMain: z.string().max(60),
  overlayBottom: z.string().max(90),
  altText: z.string().min(1).max(120),
  angleType: z.string().min(1).describe(
    "切り口の種別。例: price-objection / hidden-limit / switching-cost / concrete-number / team-size / specific-workflow / unspoken / free-plan-trap / who-should-not-buy / head-to-head",
  ),
});

export const PinSubmission = z.object({
  articleSlug: z.string(),
  pins: z.array(PinDraft).min(1),
});
export type PinSubmission = z.infer<typeof PinSubmission>;

/* ------------------------------------------------------------- experiment */

export const Experiment = z.object({
  id: z.string(),
  createdAt: iso,
  status: z.enum(["running", "concluded", "abandoned"]),
  scope: z.enum(["pin", "article"]),
  hypothesis: z.string().min(1),
  variable: z.string().min(1).describe("★変える変数は1つだけ"),
  variants: z.array(z.object({ name: z.string(), description: z.string() })).min(2),
  requiredSampleSize: z.number().int().min(1),
  metric: z.enum(["ctrPct", "conversionPct", "revenuePerPin"]),
  assignments: z.array(z.object({ targetRef: z.string(), variant: z.string() })),
  result: z.array(z.object({
    variant: z.string(), sampleSize: z.number(), metricValue: z.number(),
  })).nullable(),
  conclusion: z.string().nullable(),
  appliedTo: z.string().nullable(),
  concludedAt: isoOrNull,
});
export type Experiment = z.infer<typeof Experiment>;

/* --------------------------------------------------------------- kpi/error */

export const KpiSnapshot = z.object({
  date: z.string(),
  traffic: z.object({
    impressions: z.number(), saves: z.number(), outboundClicks: z.number(),
    pinCtrPct: z.number(), sessions: z.number().nullable(), goClicks: z.number().nullable(),
  }),
  revenue: z.object({
    affiliateClicks: z.number(), freeTrials: z.number(), paidConversions: z.number(),
    conversionPct: z.number(), mrrUsd: z.number(), activeSubscriptions: z.number(),
    avgRetentionMonths: z.number().nullable(),
  }),
  efficiency: z.object({
    publishedArticles: z.number(), publishedPins: z.number(),
    revenuePerArticleUsd: z.number(), revenuePerPinUsd: z.number(),
    routineRunsToday: z.number(),
  }),
  breakdown: z.object({
    byProgram: z.record(z.string(), z.number()),
    byCategory: z.record(z.string(), z.number()),
    byArticleType: z.record(z.string(), z.number()),
    byTemplate: z.record(z.string(), z.number()),
  }),
  health: z.object({
    pendingApprovals: z.number(), medianApprovalWaitDays: z.number().nullable(),
    qaFailRatePct: z.number(), taskFailRatePct: z.number(),
    unapprovedPublishCount: z.number(),
  }),
  notes: z.array(z.string()),
});
export type KpiSnapshot = z.infer<typeof KpiSnapshot>;

export const ErrorRecord = z.object({
  id: z.string(),
  at: iso,
  where: EmployeeId,
  taskId: z.string().nullable(),
  kind: z.enum(["api", "validation", "limit", "network", "logic", "external", "unknown"]),
  message: z.string(),
  detail: z.string().nullable(),
  recoverable: z.boolean(),
  handled: z.boolean(),
  handledAt: isoOrNull,
  resolution: z.string().nullable(),
});
export type ErrorRecord = z.infer<typeof ErrorRecord>;

/* ------------------------------------------------------------- 検証ヘルパ */

export interface ValidationFailure {
  path: string;
  message: string;
}

export class ValidationError extends Error {
  constructor(public label: string, public failures: ValidationFailure[]) {
    super(`${label}: ${failures.length} 件のスキーマ違反`);
    this.name = "ValidationError";
  }
}

/**
 * zod で検証し、失敗したら「どこが」「なぜ」ダメかを AI が直せる形で投げる。
 * ここが従来の output_config.format の代わり。
 */
export function validate<T extends z.ZodType>(schema: T, value: unknown, label: string): z.infer<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const failures = result.error.issues.map((i) => ({
    path: i.path.length ? i.path.join(".") : "(ルート)",
    message: i.message,
  }));
  throw new ValidationError(label, failures);
}
