import crypto from "node:crypto";
import { env } from "../lib/config";
import { log } from "../lib/log";
import { programs } from "../lib/store";
import type { AffiliateStat, Network } from "../lib/types";
import { daysAgoISO, todayISO } from "../lib/util";

/**
 * アフィリエイトネットワークから成果を取得する。
 *
 * ネットワークごとにレスポンス形式が違い、仕様変更も多いので、
 * 「取れなければ警告して 0 件を返す」方針。パイプライン全体は止めない。
 * API を1つも設定していなくても、記事とピンの自動化は完全に動く。
 */

function matchProgramSlug(name: string): string {
  const lower = name.toLowerCase();
  const hit = programs.all().find(
    (p) => lower.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(lower),
  );
  return hit?.slug ?? `unmatched:${name}`;
}

function emptyStat(slug: string, network: Network, start: string, end: string): AffiliateStat {
  return {
    programSlug: slug, network, clicks: 0, freeTrials: 0, paidConversions: 0,
    activeSubscriptions: 0, monthlyRecurringUsd: 0, lifetimeUsd: 0,
    avgRetentionMonths: null, periodStart: start, periodEnd: end, source: "api",
  };
}

/* ------------------------------------------------------------------ Impact */

interface ImpactAction {
  CampaignName?: string; State?: string; Payout?: string;
  ActionTrackerName?: string; EventDate?: string; ActionDate?: string;
}

async function fetchImpact(days: number): Promise<AffiliateStat[]> {
  if (!env.impact.configured) return [];
  const start = daysAgoISO(days);
  const end = todayISO();
  const auth = Buffer.from(`${env.impact.sid}:${env.impact.token}`).toString("base64");

  const url = new URL(`https://api.impact.com/Mediapartners/${env.impact.sid}/Actions`);
  url.searchParams.set("ActionDateStart", `${start}T00:00:00Z`);
  url.searchParams.set("ActionDateEnd", `${end}T23:59:59Z`);
  url.searchParams.set("PageSize", "1000");

  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } });
  if (!res.ok) {
    log.warn(`Impact API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return [];
  }
  const json = (await res.json()) as { Actions?: ImpactAction[] };
  const byProgram = new Map<string, AffiliateStat>();

  for (const a of json.Actions ?? []) {
    const slug = matchProgramSlug(a.CampaignName ?? "unknown");
    const stat = byProgram.get(slug) ?? emptyStat(slug, "Impact", start, end);
    const payout = Number.parseFloat(a.Payout ?? "0") || 0;
    const tracker = (a.ActionTrackerName ?? "").toLowerCase();
    if (tracker.includes("trial") || tracker.includes("lead") || tracker.includes("signup")) {
      stat.freeTrials += 1;
    } else {
      stat.paidConversions += 1;
      stat.monthlyRecurringUsd += payout;
    }
    stat.lifetimeUsd += payout;
    byProgram.set(slug, stat);
  }
  return [...byProgram.values()];
}

/* -------------------------------------------------------------- ShareASale */

/**
 * @deprecated ShareASale は 2025-10-06 に閉鎖され、Awin に統合されました。
 *
 * アカウント・トラッキングリンク・提携関係はすべて Awin へ自動移行済みです。
 * `api.shareasale.com` はもう応答しません。この関数は、過去に
 * SHAREASALE_* を設定していた場合に静かに0件を返すだけの残骸です。
 *
 * 新しく使うときは Awin 側（AWIN_API_TOKEN / AWIN_PUBLISHER_ID）を設定してください。
 * リンクの自動発行は src/integrations/linkbuilder.ts の awinLink() が行います。
 */
async function fetchShareASale(days: number): Promise<AffiliateStat[]> {
  if (!env.shareasale.configured) return [];
  log.warn("ShareASale は 2025-10-06 に閉鎖され Awin に統合されました。SHAREASALE_* は外し、AWIN_API_TOKEN / AWIN_PUBLISHER_ID を設定してください。");
  return [];
  const start = daysAgoISO(days);
  const end = todayISO();
  const action = "activity";
  const timestamp = new Date().toUTCString();
  const sig = crypto
    .createHash("sha256")
    .update(`${env.shareasale.token}:${timestamp}:${action}:${env.shareasale.secret}`)
    .digest("hex");

  const url = new URL("https://api.shareasale.com/w.cfm");
  url.searchParams.set("affiliateId", env.shareasale.affiliateId!);
  url.searchParams.set("token", env.shareasale.token!);
  url.searchParams.set("version", "3.0");
  url.searchParams.set("action", action);
  url.searchParams.set("dateStart", start.replace(/-/g, "/"));
  url.searchParams.set("dateEnd", end.replace(/-/g, "/"));

  const res = await fetch(url, {
    headers: { "x-ShareASale-Date": timestamp, "x-ShareASale-Authentication": sig },
  });
  const text = await res.text();
  if (!res.ok || text.startsWith("Error")) {
    log.warn(`ShareASale API: ${text.slice(0, 200)}`);
    return [];
  }

  // パイプ区切り。1行目がヘッダ。
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split("|").map((h) => h.trim().toLowerCase());
  const iMerchant = header.findIndex((h) => h.includes("merchant"));
  const iCommission = header.findIndex((h) => h.includes("commission"));
  const byProgram = new Map<string, AffiliateStat>();

  for (const line of lines.slice(1)) {
    const cols = line.split("|");
    const merchant = (cols[iMerchant] ?? "").trim();
    if (!merchant) continue;
    const slug = matchProgramSlug(merchant);
    const stat = byProgram.get(slug) ?? emptyStat(slug, "ShareASale", start, end);
    const amount = Number.parseFloat(cols[iCommission] ?? "0") || 0;
    stat.paidConversions += 1;
    stat.monthlyRecurringUsd += amount;
    stat.lifetimeUsd += amount;
    byProgram.set(slug, stat);
  }
  return [...byProgram.values()];
}

/* ------------------------------------------------------------ PartnerStack */

interface PsTransaction {
  amount?: number; currency?: string; product_key?: string;
  group_key?: string; customer_key?: string; created_at?: number;
}

async function fetchPartnerStack(days: number): Promise<AffiliateStat[]> {
  if (!env.partnerstack.configured) return [];
  const start = daysAgoISO(days);
  const end = todayISO();
  const auth = Buffer.from(`${env.partnerstack.key}:${env.partnerstack.secret}`).toString("base64");

  const res = await fetch("https://api.partnerstack.com/api/v2/transactions?limit=500", {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (!res.ok) {
    log.warn(`PartnerStack API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return [];
  }
  const json = (await res.json()) as { data?: { items?: PsTransaction[] } };
  const since = Date.now() - days * 86_400_000;
  const byProgram = new Map<string, AffiliateStat>();
  const customers = new Map<string, Set<string>>();

  for (const t of json.data?.items ?? []) {
    if (t.created_at && t.created_at < since) continue;
    const slug = matchProgramSlug(t.group_key ?? t.product_key ?? "unknown");
    const stat = byProgram.get(slug) ?? emptyStat(slug, "PartnerStack", start, end);
    const amount = (t.amount ?? 0) / 100; // PartnerStack はセント単位
    stat.paidConversions += 1;
    stat.monthlyRecurringUsd += amount;
    stat.lifetimeUsd += amount;
    if (t.customer_key) {
      const set = customers.get(slug) ?? new Set<string>();
      set.add(t.customer_key);
      customers.set(slug, set);
    }
    byProgram.set(slug, stat);
  }
  for (const [slug, set] of customers) {
    const stat = byProgram.get(slug);
    if (stat) stat.activeSubscriptions = set.size;
  }
  return [...byProgram.values()];
}

/* ------------------------------------------------------------- aggregation */

export interface AffiliateFetchResult {
  stats: AffiliateStat[];
  sourcesUsed: string[];
  sourcesMissing: string[];
}

export async function fetchAffiliateStats(days = 30): Promise<AffiliateFetchResult> {
  const jobs: { name: string; configured: boolean; run: () => Promise<AffiliateStat[]> }[] = [
    { name: "Impact", configured: env.impact.configured, run: () => fetchImpact(days) },
    { name: "ShareASale", configured: env.shareasale.configured, run: () => fetchShareASale(days) },
    { name: "PartnerStack", configured: env.partnerstack.configured, run: () => fetchPartnerStack(days) },
  ];

  const stats: AffiliateStat[] = [];
  const used: string[] = [];
  const missing: string[] = [];

  for (const job of jobs) {
    if (!job.configured) {
      missing.push(job.name);
      continue;
    }
    try {
      const rows = await job.run();
      stats.push(...rows);
      used.push(job.name);
      log.ok(`${job.name}: ${rows.length} プログラム分の成果を取得`);
    } catch (err) {
      log.warn(`${job.name} の取得に失敗: ${(err as Error).message}`);
    }
  }

  // 実測の継続月数（LTV / 月額報酬）を埋める
  for (const s of stats) {
    const p = programs.bySlug(s.programSlug);
    if (p && s.monthlyRecurringUsd > 0) {
      s.avgRetentionMonths = Math.round((s.lifetimeUsd / s.monthlyRecurringUsd) * 10) / 10;
    } else if (p) {
      s.avgRetentionMonths = p.estAvgRetentionMonths;
    }
  }

  return { stats, sourcesUsed: used, sourcesMissing: missing };
}
