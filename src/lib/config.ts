import fs from "node:fs";
import dotenv from "dotenv";
import { P } from "./paths";
import { readJson } from "./store";

dotenv.config({ path: `${P.root}/.env`, quiet: true });

export interface AppConfig {
  site: {
    name: string; tagline: string; baseUrl: string; author: string;
    locale: string; description: string; gaMeasurementId: string;
    pinterestVerifyCode: string;
  };
  niche: { audience: string; categories: string[]; geoFocus: string[]; excludeJapanese: boolean };
  content: {
    articlesPerRun: number; wordsMin: number; wordsMax: number;
    internalLinksMin: number; toneNotes: string; bannedPhrases: string[];
  };
  pins: {
    perArticle: number; width: number; height: number; publishPerDay: number;
    minMinutesBetweenPins: number; postingHoursUtc: number[]; boardStrategy: string;
  };
  programs: {
    targetActive: number; discoverPerRun: number; minMonthlyCommissionUsd: number;
    minAvgRetentionMonths: number; requireRecurring: boolean; allowedNetworks: string[];
  };
  optimizer: {
    winnerCtrPct: number; minImpressionsForJudgement: number;
    expansionPinsPerWinner: number; loserCtrPct: number; maxExpansionsPerRun: number;
  };
  compliance: {
    requireDisclosure: boolean; affiliateDisclosure: string;
    pinDisclosureSuffix: string; linkRel: string;
  };
  growth: { monthlyRevenueMilestonesUsd: number[]; introducerThresholdUsd: number };
  models: {
    profile: string;
    presets: Record<string, Record<string, string>>;
  };
}

export interface ScoringConfig {
  weights: Record<string, number>;
  hardFilters: {
    mustBeRecurring: boolean; minMonthlyCommissionUsd: number;
    minAvgRetentionMonths: number; maxJapaneseCompetition: number;
  };
  notes: string;
}

let cached: AppConfig | null = null;
export function config(): AppConfig {
  if (!cached) cached = readJson<AppConfig>(P.config, null as unknown as AppConfig);
  if (!cached) throw new Error("config/config.json が見つかりません");
  const envVerify = process.env.PINTEREST_VERIFY_CODE;
  if (envVerify) cached.site.pinterestVerifyCode = envVerify;
  const envBase = process.env.SITE_BASE_URL?.replace(/\/+$/, "");
  if (envBase) cached.site.baseUrl = envBase;
  cached.site.baseUrl = cached.site.baseUrl.replace(/\/+$/, "");
  return cached;
}

let cachedScoring: ScoringConfig | null = null;
export function scoring(): ScoringConfig {
  if (!cachedScoring) cachedScoring = readJson<ScoringConfig>(P.scoring, null as unknown as ScoringConfig);
  return cachedScoring;
}

export function affiliateLinks(): Record<string, string> {
  const raw = readJson<{ links?: Record<string, string> }>(P.affiliateLinks, { links: {} });
  return raw.links ?? {};
}

export function setAffiliateLink(slug: string, url: string): void {
  const raw = readJson<Record<string, unknown>>(P.affiliateLinks, { links: {} });
  const links = (raw.links as Record<string, string>) ?? {};
  links[slug] = url;
  raw.links = links;
  fs.writeFileSync(P.affiliateLinks, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
}

/* ------------------------------------------------------------------- env */
/**
 * 工程ごとに使うモデルを返す。
 * CLAUDE_MODEL が設定されていれば、それが全工程を上書きする。
 */
export function modelFor(stage: string): string {
  const override = process.env.CLAUDE_MODEL;
  if (override) return override;
  const m = config().models;
  const preset = m.presets[m.profile] ?? m.presets.balanced ?? {};
  return preset[stage] ?? "claude-opus-5";
}

export const env = {
  get anthropicKey(): string | undefined {
    return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  },
  /** doctor の疎通確認などで使う代表モデル */
  get model(): string { return process.env.CLAUDE_MODEL || modelFor("article"); },
  get baseUrl(): string | undefined { return process.env.ANTHROPIC_BASE_URL; },
  get usingCustomEndpoint(): boolean { return Boolean(process.env.ANTHROPIC_BASE_URL); },
  get dryRun(): boolean {
    if (process.env.DRY_RUN === "0" || process.env.DRY_RUN === "false") return false;
    if (process.env.DRY_RUN) return true;
    return !env.anthropicKey;
  },
  pinterest: {
    get appId(): string | undefined { return process.env.PINTEREST_APP_ID; },
    get appSecret(): string | undefined { return process.env.PINTEREST_APP_SECRET; },
    get refreshToken(): string | undefined { return process.env.PINTEREST_REFRESH_TOKEN; },
    get accessToken(): string | undefined { return process.env.PINTEREST_ACCESS_TOKEN; },
    get sandbox(): boolean { return process.env.PINTEREST_SANDBOX === "1"; },
    get configured(): boolean {
      return Boolean(process.env.PINTEREST_ACCESS_TOKEN ||
        (process.env.PINTEREST_REFRESH_TOKEN && process.env.PINTEREST_APP_ID && process.env.PINTEREST_APP_SECRET));
    },
  },
  impact: {
    get sid(): string | undefined { return process.env.IMPACT_ACCOUNT_SID; },
    get token(): string | undefined { return process.env.IMPACT_AUTH_TOKEN; },
    get configured(): boolean { return Boolean(process.env.IMPACT_ACCOUNT_SID && process.env.IMPACT_AUTH_TOKEN); },
  },
  shareasale: {
    get affiliateId(): string | undefined { return process.env.SHAREASALE_AFFILIATE_ID; },
    get token(): string | undefined { return process.env.SHAREASALE_API_TOKEN; },
    get secret(): string | undefined { return process.env.SHAREASALE_API_SECRET; },
    get configured(): boolean {
      return Boolean(process.env.SHAREASALE_AFFILIATE_ID && process.env.SHAREASALE_API_TOKEN && process.env.SHAREASALE_API_SECRET);
    },
  },
  partnerstack: {
    get key(): string | undefined { return process.env.PARTNERSTACK_API_KEY; },
    get secret(): string | undefined { return process.env.PARTNERSTACK_API_SECRET; },
    get configured(): boolean { return Boolean(process.env.PARTNERSTACK_API_KEY && process.env.PARTNERSTACK_API_SECRET); },
  },
};
