import { affiliateLinks, env, setAffiliateLink } from "../../lib/config";
import { log } from "../../lib/log";
import { programs } from "../../lib/store";
import {
  buildLinkFor, impactCampaigns, logOutcome, normalizeName,
  type BuildOutcome, type ImpactCampaign,
} from "../../integrations/linkbuilder";
import { reportError } from "../report";

/**
 * アフィリエイトURLを自動で発行して config/affiliate-links.json に書き込む。
 *
 * ★この会社で「人間にしかできない」のは提携申請だけです。
 *   申請が通ったあとのリンク発行は、ここが肩代わりします。
 *
 * 安全のための決めごと:
 *   - **AI が URL を推測して書くことは絶対にしません。** 書き込むのは
 *     ネットワークのAPIが返したものか、公式に決まっている形式で組んだものだけです。
 *   - 名前の自動照合は「正規化して完全一致」のときだけ。曖昧一致はしません。
 *     別会社のリンクを貼ると、収益が他人に入るうえ規約違反になるためです。
 *   - すでに登録済みのリンクは上書きしません（--force で明示したときだけ）。
 */

export interface SyncOptions {
  /** 登録済みのリンクも作り直す */
  force?: boolean;
  /** 書き込まずに、何が起きるかだけ見る */
  dryRun?: boolean;
  /** このスラッグだけ */
  only?: string;
}

export interface SyncResult {
  issued: number;
  skipped: number;
  failed: number;
  matched: number;
  outcomes: BuildOutcome[];
}

/**
 * Impact の承認済みプログラムと、こちらの案件を名前で突き合わせて
 * Campaign ID を埋める。**完全一致のときだけ**書き込みます。
 */
async function matchImpactCampaigns(dryRun: boolean): Promise<number> {
  if (!env.impact.configured) return 0;

  let campaigns: ImpactCampaign[];
  try {
    campaigns = await impactCampaigns();
  } catch (err) {
    log.warn(`Impact の承認済みプログラム一覧が取れませんでした: ${(err as Error).message}`);
    return 0;
  }
  if (campaigns.length === 0) {
    log.info("Impact で承認済みのプログラムはまだ0件です。");
    return 0;
  }
  log.info(`Impact で承認済みのプログラム: ${campaigns.length} 件`);

  const byName = new Map<string, ImpactCampaign[]>();
  for (const c of campaigns) {
    const key = normalizeName(c.advertiserName || c.campaignName);
    byName.set(key, [...(byName.get(key) ?? []), c]);
  }

  const list = programs.all();
  let matched = 0;
  for (const p of list) {
    if (p.network !== "Impact" || p.linkRef?.impactCampaignId) continue;
    const hits = byName.get(normalizeName(p.name)) ?? [];
    if (hits.length === 0) continue;
    if (hits.length > 1) {
      // 同じ名前の候補が複数。ここで選ぶと事故になるので、人に決めてもらう。
      log.warn(`${p.slug}: Impact に同じ名前の候補が ${hits.length} 件あります。自動では選びません。`);
      for (const h of hits) log.info(`  候補: ${h.campaignId} — ${h.campaignName}`);
      continue;
    }
    const c = hits[0];
    log.ok(`${p.slug} ⇄ Impact の「${c.campaignName}」(ID ${c.campaignId}) を突き合わせました`);
    if (!dryRun) p.linkRef = { ...(p.linkRef ?? {}), impactCampaignId: c.campaignId };
    matched++;
  }
  if (matched > 0 && !dryRun) programs.save(list);
  return matched;
}

export async function syncLinks(opts: SyncOptions = {}): Promise<SyncResult> {
  log.step("アフィリエイトURLを自動発行します（提携申請は対象外・あれは人間の仕事です）");

  const result: SyncResult = { issued: 0, skipped: 0, failed: 0, matched: 0, outcomes: [] };
  result.matched = await matchImpactCampaigns(Boolean(opts.dryRun));

  const existing = affiliateLinks();
  const targets = programs.all().filter((p) => {
    if (opts.only) return p.slug === opts.only;
    // 承認済み＝提携が通ったものだけ。申請前のものにリンクは発行できません。
    return p.status === "approved";
  });

  if (targets.length === 0) {
    log.human("リンクを発行できる案件がまだありません。");
    log.info("  提携が承認された案件（status: approved）が対象です。");
    log.info("  応募はなおきさんにしかできません。管理画面の「案件」タブから応募してください。");
    return result;
  }

  for (const p of targets) {
    if (existing[p.slug] && !opts.force) {
      log.info(`${p.slug}: すでに登録済みなので触りません（作り直すなら --force）`);
      result.skipped++;
      continue;
    }
    const outcome = await buildLinkFor(p);
    result.outcomes.push(outcome);
    logOutcome(outcome);

    if (outcome.ok && outcome.url) {
      if (!opts.dryRun) setAffiliateLink(p.slug, outcome.url);
      result.issued++;
    } else {
      result.failed++;
    }
  }

  if (opts.dryRun) log.warn("--dry-run なので、何も書き込んでいません。");
  log.ok(`発行 ${result.issued} 件 / 据え置き ${result.skipped} 件 / 未発行 ${result.failed} 件`);

  if (result.issued > 0 && !opts.dryRun) {
    log.human("リンクを登録しました。次のサイト再生成で、全記事のリンクが自動で差し替わります。");
  }
  if (result.failed > 0) {
    log.human(`${result.failed} 件はまだ発行できません。上に出ている手順を1回だけやれば、以降は自動になります。`);
  }
  return result;
}

/** いま何が自動で、何が手作業なのかを一覧で出す。 */
export function explainAutomation(): void {
  const lines = [
    "",
    "# アフィリエイトURLの自動化はどこまでできるか",
    "",
    "「提携申請」と「リンク発行」は別の作業です。**自動化できるのは後者だけです。**",
    "",
    "| ネットワーク | 提携申請 | 承認済み一覧の取得 | リンク発行 | 必要なもの |",
    "| --- | --- | --- | --- | --- |",
    "| Impact | ✗ 人間 | ✓ 自動 | **✓ 完全自動** | IMPACT_ACCOUNT_SID / IMPACT_AUTH_TOKEN |",
    "| Awin（旧ShareASale） | ✗ 人間 | ✓ 自動 | **✓ 完全自動** | AWIN_API_TOKEN / AWIN_PUBLISHER_ID |",
    "| PartnerStack | ✗ 人間 | ✗ APIなし | △ リンクを1回コピー→以降自動 | 紹介リンク（1回だけ） |",
    "| Rewardful | ✗ 人間 | ✗ マーチャント専用API | △ トークンを1回コピー→以降自動 | via トークン（1回だけ） |",
    "",
    "★ ShareASale は 2025-10-06 に閉鎖され、Awin に統合されました。",
    "  api.shareasale.com はもう動きません。Awin 側で扱ってください。",
    "",
    "★ 提携申請の自動化はしません。相手企業の審査担当は人間で、本人確認と",
    "  税務情報の入力が要ります。自動化を試みること自体が各社の規約違反になります。",
    "",
    "## いまの設定",
    "",
    `- Impact: ${env.impact.configured ? "✓ 設定済み" : "✗ 未設定"}`,
    `- Awin  : ${env.awin.configured ? "✓ 設定済み" : "✗ 未設定"}`,
    "- PartnerStack / Rewardful: 管理画面の「案件」タブから、案件ごとに1回だけ登録します",
    "",
    "## 使い方",
    "",
    "```bash",
    "npm run co -- links:sync --dry-run   # 何が起きるか見るだけ",
    "npm run co -- links:sync             # 発行して config/affiliate-links.json に書き込む",
    "```",
    "",
  ];
  console.log(lines.join("\n"));
}

export async function syncLinksSafely(opts: SyncOptions = {}): Promise<SyncResult> {
  try {
    return await syncLinks(opts);
  } catch (err) {
    reportError(err, "cli");
    throw err;
  }
}
