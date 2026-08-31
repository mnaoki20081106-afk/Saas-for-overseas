export type Network =
  | "Impact" | "ShareASale" | "CJ" | "PartnerStack" | "Direct"
  | "Rewardful" | "FirstPromoter" | "Tapfiliate" | "Awin" | "Unknown";

export type ProgramStatus =
  | "candidate"        // リサーチで見つかっただけ
  | "awaiting_apply"   // 応募待ち(人間タスク発行済み)
  | "applied"          // 応募済み・審査中
  | "approved"         // 承認済み・リンク登録済み
  | "rejected"
  | "paused";

export interface Program {
  slug: string;
  name: string;
  homepage: string;
  signupUrl: string;
  affiliateProgramUrl: string;
  network: Network;
  category: string;
  pricingFromUsd: number;
  commissionModel: "recurring" | "one-time" | "hybrid" | "unknown";
  commissionRatePct: number | null;
  estMonthlyCommissionUsd: number;
  estAvgRetentionMonths: number;
  cookieDays: number | null;
  japaneseCompetition: number;   // 1-10, 1 = 日本語の競合ほぼゼロ
  englishCompetition: number;    // 1-10
  reliability: number;           // 1-10
  whyGoodFit: string;
  targetPains: string[];
  mainCompetitors: string[];
  score: number;
  status: ProgramStatus;
  discoveredAt: string;
  evidence: string[];
  notes?: string;
}

export interface ArticleBrief {
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent: string;
  audience: string;
  painPoints: string[];
  angle: string;
  programSlugs: string[];
  outline: { heading: string; purpose: string; bullets: string[] }[];
  faq: { q: string; a: string }[];
}

/**
 * withdrawn = なおきさんが管理画面から取り下げた記事。
 * サイトから消えるが、データと本文は残す（間違って押したときに戻せるように）。
 */
export type ArticleStatus = "brief" | "drafted" | "published" | "needs_review" | "withdrawn";

export interface Article {
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  category: string;
  programSlugs: string[];
  filePath: string;
  words: number;
  status: ArticleStatus;
  createdAt: string;
  updatedAt: string;
  qualityIssues: string[];
  internalLinks: string[];
  brief?: ArticleBrief;

  /* ── なおきさんが管理画面から取り下げたときの記録 ── */
  withdrawnAt?: string | null;
  withdrawnReason?: string | null;
}

/**
 * draft = Designer が作っただけ。QA と人間の承認を通るまで予約もされない。
 * 既存の queued 以降の流れは変わらない。
 */
/**
 * skipped     = 投稿しない（なおきさんが予約を取り消した場合を含む）
 * taken_down  = 投稿済みだったが、なおきさんの指示で Pinterest から削除した
 */
export type PinStatus =
  | "draft" | "queued" | "scheduled" | "published" | "failed" | "skipped" | "taken_down";

export interface Pin {
  id: string;
  articleSlug: string;
  templateId: string;
  title: string;          // Pinterest title (<=100)
  description: string;    // Pinterest description (<=500)
  overlayTop: string;     // 画像に載せる文字
  overlayMain: string;
  overlayBottom: string;
  altText: string;
  boardName: string;
  imagePath: string;
  destinationUrl: string;
  status: PinStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  pinterestPinId: string | null;
  parentPinId: string | null;   // 横展開元の勝ち型
  generation: number;           // 0 = original, 1+ = 横展開
  lastError?: string;
  metrics?: PinMetrics;

  /* ── なおきさんが管理画面から取り消したときの記録 ── */
  /** 予約を取り消した時刻（まだ投稿していないピン） */
  cancelledAt?: string | null;
  /** 投稿済みのピンについて、Pinterest からの削除を依頼した時刻 */
  takedownRequestedAt?: string | null;
  /** 実際に Pinterest から削除できた時刻 */
  takenDownAt?: string | null;
  /** 取り消しの理由（なおきさんのメモ。空でもよい） */
  takedownReason?: string | null;

  /* ── 実験と重複検出のための変数（既存のピンには migrate で付与される） ── */
  /** 切り口の種別。price-objection / hidden-limit / switching-cost など */
  angleType?: string;
  /** 使った配色。何色が効いたかを後から分析するために記録する。 */
  paletteIndex?: number | null;
  hasNumber?: boolean;
  hasVersus?: boolean;
  hasCta?: boolean;
  /** 画像バイトの SHA-256。同じ画像の再投稿を防ぐ。 */
  imageHash?: string | null;
  /** overlayMain の正規化ハッシュ。同じ文案の再投稿を防ぐ。 */
  copyHash?: string | null;
  experimentId?: string | null;
  variant?: string | null;
  /**
   * ★これが無いピンは投稿されない。
   * 承認ゲートの実体。co で予約すれば必ず付き、手で書き換えれば guard が検出する。
   */
  approvalId?: string | null;
}

export interface PinMetrics {
  impressions: number;
  outboundClicks: number;
  saves: number;
  ctrPct: number;
  fetchedAt: string;
}

export interface AffiliateStat {
  programSlug: string;
  network: Network;
  clicks: number;
  freeTrials: number;
  paidConversions: number;
  activeSubscriptions: number;
  monthlyRecurringUsd: number;
  lifetimeUsd: number;
  avgRetentionMonths: number | null;
  periodStart: string;
  periodEnd: string;
  source: "api" | "manual" | "estimated";
}

export interface Metrics {
  updatedAt: string;
  pinMetrics: Record<string, PinMetrics>;
  affiliate: AffiliateStat[];
  history: {
    date: string;
    impressions: number;
    outboundClicks: number;
    ctrPct: number;
    monthlyRecurringUsd: number;
    activeSubscriptions: number;
  }[];
}

export type HumanTaskKind =
  | "credential" | "affiliate_application" | "account_setup" | "link_paste" | "decision";

export interface HumanTask {
  id: string;
  kind: HumanTaskKind;
  title: string;
  whyItCannotBeAutomated: string;
  minutes: number;
  url?: string;
  steps: string[];
  prefilledAnswers?: Record<string, string>;
  blocks: string[];
  status: "open" | "done";
  createdAt: string;
  doneAt?: string;
}

export interface PipelineState {
  lastResearchAt: string | null;
  lastArticleAt: string | null;
  lastPinPublishAt: string | null;
  lastAnalyticsAt: string | null;
  lastReportAt: string | null;
  publishedCategories: string[];
  cursor: number;
  milestonesHit: number[];
  /** 初めてピンを予約した日。新規アカウントの投稿数ランプアップの起点。 */
  campaignStartedAt: string | null;

  /* ── AI会社の運転に使う項目（既存の値には影響しない） ── */
  /** CEO が最後に動いた時刻。規定間隔未満の再実行を弾くために使う。 */
  lastCeoRunAt?: string | null;
  /** その日のルーチン実行回数。Claude Pro の利用枠を守るための上限判定に使う。 */
  routineRunsToday?: { date: string; count: number };
  /** bootstrap = 実績ゼロ（審査の通りやすさ重視）/ growth = LTV重視 / scale */
  phase?: "bootstrap" | "growth" | "scale";
  companyStartedAt?: string | null;
  lastKpiSnapshotAt?: string | null;
  /** 自律レベル昇格の判定用。承認が連続して GO された回数。 */
  /** マイグレーション用のスキーマ版数。 */
  schemaVersion?: number;
}
