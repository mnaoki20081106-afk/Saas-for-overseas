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

export type ArticleStatus = "brief" | "drafted" | "published" | "needs_review";

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
}

export type PinStatus = "queued" | "scheduled" | "published" | "failed" | "skipped";

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
}
