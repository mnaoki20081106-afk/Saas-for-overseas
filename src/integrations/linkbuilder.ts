import { env } from "../lib/config";
import { log } from "../lib/log";
import type { Program } from "../lib/types";

/**
 * アフィリエイトURL（トラッキングリンク）の自動発行。
 *
 * ★「提携申請」と「リンク発行」は別物です
 *
 *   提携申請 … 相手企業の担当者が人間として審査する。本人確認と税務情報も要る。
 *              **4社とも自動化できません。** なおきさんが自分でやる作業です。
 *              （自動化を試みることは各社の規約違反にもなります）
 *
 *   リンク発行 … 承認されたあと、「このページ用の追跡URLをください」と頼む作業。
 *              **ここは自動化できます。** このファイルがそれをやります。
 *
 * ★ネットワークごとの自動化の度合い（2026-09 時点で確認）
 *
 *   Impact       … 完全自動。Campaigns API が承認済みプログラムと、そのまま使える
 *                  トラッキングリンクを返す。ページ指定は TrackingLinks API。
 *   Awin         … 完全自動。Link Builder API に広告主IDと行き先URLを渡すと返ってくる。
 *                  ★ShareASale は 2025-10-06 に閉鎖され Awin に統合されました。
 *   PartnerStack … パートナー側のAPIが公開されていない。ダッシュボードから
 *                  紹介リンクを1回コピーすれば、以降のページ指定は自動で組めます。
 *   Rewardful   … APIはマーチャント専用。ただしリンクは `?via=<トークン>` を
 *                  付けるだけなので、トークンを1回控えれば以降は全部自動で組めます。
 */

export interface LinkResult {
  url: string;
  /** どうやって作ったか。監査用に必ず残す */
  method: "impact-api" | "awin-api" | "partnerstack-template" | "rewardful-template";
  note?: string;
}

export class LinkBuildError extends Error {
  constructor(message: string, public howToFix: string[]) {
    super(message);
    this.name = "LinkBuildError";
  }
}

/* ------------------------------------------------------------------ Impact */

export interface ImpactCampaign {
  campaignId: string;
  campaignName: string;
  advertiserName: string;
  /** そのまま使えるトラッキングリンク（Campaigns API が返す） */
  trackingLink: string | null;
  deeplinkEnabled: boolean;
}

function impactAuth(): string {
  if (!env.impact.configured) {
    throw new LinkBuildError("Impact の認証情報がありません。", [
      "GitHub Secrets に IMPACT_ACCOUNT_SID と IMPACT_AUTH_TOKEN を登録してください。",
      "impact.com の管理画面 → Settings → API から取得できます。",
    ]);
  }
  return Buffer.from(`${env.impact.sid}:${env.impact.token}`).toString("base64");
}

async function impactGet<T>(path: string, query: Record<string, string> = {}): Promise<T> {
  const url = new URL(`https://api.impact.com/Mediapartners/${env.impact.sid}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${impactAuth()}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new LinkBuildError(`Impact API が ${res.status} を返しました: ${text.slice(0, 300)}`, [
      res.status === 401
        ? "IMPACT_ACCOUNT_SID / IMPACT_AUTH_TOKEN が違う可能性があります。"
        : "しばらく待ってから、もう一度実行してください。",
    ]);
  }
  return JSON.parse(text) as T;
}

/**
 * 承認済みプログラムの一覧を取る。
 * 返ってくる TrackingLink はそのまま使えるので、多くの場合これだけで足ります。
 */
export async function impactCampaigns(): Promise<ImpactCampaign[]> {
  const raw = await impactGet<Record<string, unknown>>("/Campaigns", { PageSize: "200" });
  const list = (raw.Campaigns ?? raw.campaigns ?? []) as Record<string, unknown>[];
  return list.map((c) => ({
    campaignId: String(c.CampaignId ?? c.Id ?? ""),
    campaignName: String(c.CampaignName ?? c.Name ?? ""),
    advertiserName: String(c.AdvertiserName ?? c.CampaignName ?? ""),
    trackingLink: (c.TrackingLink as string) ?? null,
    // API は文字列の "true"/"false" を返すことがあるので、両方を受ける
    deeplinkEnabled: String(c.DeeplinkEnabled ?? c.AllowsDeeplinking ?? "true") !== "false",
  })).filter((c) => c.campaignId);
}

/** ページを指定してトラッキングリンクを作る（トップページでよければ Campaigns の TrackingLink で足ります） */
export async function impactTrackingLink(campaignId: string, deepLink?: string): Promise<string> {
  const body = new URLSearchParams({ Type: "Regular", ...(deepLink ? { DeepLink: deepLink } : {}) });
  const res = await fetch(
    `https://api.impact.com/Mediapartners/${env.impact.sid}/Programs/${encodeURIComponent(campaignId)}/TrackingLinks`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${impactAuth()}`,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new LinkBuildError(`Impact のリンク発行が ${res.status} で失敗しました: ${text.slice(0, 300)}`, [
      "そのプログラムで本当に承認されているか、impact.com の管理画面で確認してください。",
      "ディープリンクが無効なプログラムでは、行き先ページを指定できません。",
    ]);
  }
  const json = JSON.parse(text) as Record<string, unknown>;
  const url = (json.TrackingURL ?? json.TrackingUrl ?? json.Uri) as string | undefined;
  if (!url) {
    throw new LinkBuildError("Impact の応答にトラッキングURLが入っていませんでした。", [
      `返ってきた内容: ${text.slice(0, 200)}`,
      "Impact の仕様が変わった可能性があります。諭吉に報告してください。",
    ]);
  }
  return url;
}

/* -------------------------------------------------------------------- Awin */

/**
 * Awin の Link Builder API。広告主IDと行き先URLを渡すとトラッキングリンクが返る。
 * トークンは https://ui.awin.com/awin-api で自分で発行します。
 */
export async function awinLink(advertiserId: string, destinationUrl: string): Promise<string> {
  if (!env.awin.configured) {
    throw new LinkBuildError("Awin の認証情報がありません。", [
      "GitHub Secrets に AWIN_API_TOKEN と AWIN_PUBLISHER_ID を登録してください。",
      "トークンは https://ui.awin.com/awin-api で自分で発行できます。",
    ]);
  }
  const res = await fetch(
    `https://api.awin.com/publishers/${env.awin.publisherId}/linkbuilder/generate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.awin.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ advertiserId: Number(advertiserId), destinationUrl }),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new LinkBuildError(`Awin のリンク発行が ${res.status} で失敗しました: ${text.slice(0, 300)}`, [
      res.status === 401 ? "AWIN_API_TOKEN が失効している可能性があります。発行し直してください。" : "",
      "その広告主と提携済みか、Awin の管理画面で確認してください。",
      "行き先URLは、その広告主のドメインでなければ拒否されます。",
    ].filter(Boolean));
  }
  const json = JSON.parse(text) as Record<string, unknown>;
  const url = (json.url ?? json.trackingLink ?? json.link) as string | undefined;
  if (!url) {
    throw new LinkBuildError("Awin の応答にリンクが入っていませんでした。", [
      `返ってきた内容: ${text.slice(0, 200)}`,
      "Awin の仕様が変わった可能性があります。諭吉に報告してください。",
    ]);
  }
  return url;
}

/* ----------------------------------------------- PartnerStack / Rewardful */

/**
 * PartnerStack: パートナー側のAPIが公開されていないので、
 * ダッシュボードからコピーした紹介リンクを土台にして組み立てます。
 * ベンダーがサイト全体トラッキング（ディープリンク）を有効にしている場合のみ、
 * 行き先ページを指定できます。無効ならベースのリンクをそのまま使います。
 */
export function partnerstackLink(
  baseUrl: string,
  destinationPath?: string,
  deepLinkParam?: string,
): LinkResult {
  // ★既定では、コピーしてきたリンクをそのまま使います。
  //
  //   PartnerStack のディープリンクの受け渡し方はベンダーごとに違い、公開仕様がありません。
  //   知らないクエリを勝手に足すと、リンクごと壊れることがあります。
  //   **行き先が少しずれるより、リンクが死ぬほうがはるかに損です。**
  //   ページ指定をしたいときは、そのベンダーの受け渡し方を1回だけ調べて
  //   partnerstackDeepLinkParam に入れてください（例: "target" / "url"）。
  if (!destinationPath || destinationPath === "/" || !deepLinkParam) {
    return {
      url: baseUrl,
      method: "partnerstack-template",
      note: destinationPath && !deepLinkParam
        ? "ページ指定は無視しました（PartnerStack は受け渡し方がベンダーごとに違い、勝手に足すとリンクが壊れるため）。指定したい場合は partnerstackDeepLinkParam を設定してください。"
        : undefined,
    };
  }
  const u = new URL(baseUrl);
  u.searchParams.set(deepLinkParam, destinationPath);
  return {
    url: u.toString(),
    method: "partnerstack-template",
    note: "ページ指定を付けました。**1回は実際にクリックして、正しいページに飛ぶことを確かめてください。**",
  };
}

/**
 * Rewardful: `?via=<トークン>` を付けるだけ。
 * トークンを1回控えれば、そのマーチャントの全ページのリンクが作れます。
 */
export function rewardfulLink(homepage: string, via: string, destinationPath?: string): LinkResult {
  const u = new URL(homepage);
  if (destinationPath) u.pathname = destinationPath;
  u.searchParams.set("via", via);
  return { url: u.toString(), method: "rewardful-template" };
}

/* ------------------------------------------------------------- 振り分け役 */

export interface BuildOutcome {
  slug: string;
  ok: boolean;
  url?: string;
  method?: LinkResult["method"];
  /** 自動化できなかったとき、なおきさんが何をすればよいか */
  reason?: string;
  howToFix?: string[];
  note?: string;
}

/**
 * 1件のプログラムについて、アフィリエイトURLを作る。
 *
 * 作れなかった場合も throw せず、「なぜ作れないか」と「どうすれば作れるか」を返します。
 * 1件のつまずきで全体が止まらないようにするためです。
 */
export async function buildLinkFor(p: Program): Promise<BuildOutcome> {
  const ref = p.linkRef ?? {};
  const dest = ref.destinationPath;

  try {
    switch (p.network) {
      case "Impact": {
        if (!ref.impactCampaignId) {
          return {
            slug: p.slug, ok: false,
            reason: "Impact の Campaign ID がまだ分かりません。",
            howToFix: ["`co links:sync` を実行すると、承認済みプログラムから名前で自動照合します。",
              "名前が一致しないときは、Impact の管理画面で Campaign ID を確認してください。"],
          };
        }
        const url = dest
          ? await impactTrackingLink(ref.impactCampaignId, new URL(dest, p.homepage).toString())
          : await impactTrackingLink(ref.impactCampaignId);
        return { slug: p.slug, ok: true, url, method: "impact-api" };
      }

      case "Awin":
      case "ShareASale": {
        if (!ref.awinAdvertiserId) {
          return {
            slug: p.slug, ok: false,
            reason: "Awin の広告主ID（awinmid）がまだ分かりません。",
            howToFix: ["Awin の管理画面 → 提携中の広告主 → Advertiser ID を控えてください。",
              p.network === "ShareASale"
                ? "★ShareASale は 2025-10-06 に閉鎖され、Awin に統合されました。Awin 側で扱ってください。"
                : ""].filter(Boolean),
          };
        }
        const url = await awinLink(ref.awinAdvertiserId, new URL(dest ?? "/", p.homepage).toString());
        return { slug: p.slug, ok: true, url, method: "awin-api" };
      }

      case "PartnerStack": {
        if (!ref.partnerstackBaseUrl) {
          return {
            slug: p.slug, ok: false,
            reason: "PartnerStack はパートナー側のAPIが無いので、紹介リンクを1回だけ手で控える必要があります。",
            howToFix: ["PartnerStack のダッシュボード → その企業のプログラム → 紹介リンクをコピー",
              "管理画面の「案件」タブに貼ってください。**貼るのは1回だけ**で、以降は自動です。"],
          };
        }
        const r = partnerstackLink(ref.partnerstackBaseUrl, dest, ref.partnerstackDeepLinkParam);
        return { slug: p.slug, ok: true, url: r.url, method: r.method, note: r.note };
      }

      case "Rewardful": {
        if (!ref.rewardfulVia) {
          return {
            slug: p.slug, ok: false,
            reason: "Rewardful の via トークンがまだ分かりません（APIはマーチャント専用のため取得できません）。",
            howToFix: ["承認メールに載っている自分のリンク（例: https://example.com/?via=abc123）の",
              "`via=` の後ろの部分を、管理画面の「案件」タブに貼ってください。",
              "**貼るのは1回だけ**で、以降はどのページのリンクも自動で作れます。"],
          };
        }
        const r = rewardfulLink(p.homepage, ref.rewardfulVia, dest);
        return { slug: p.slug, ok: true, url: r.url, method: r.method };
      }

      default:
        return {
          slug: p.slug, ok: false,
          reason: `${p.network} は自動発行に対応していません。`,
          howToFix: ["発行されたアフィリエイトURLを、管理画面の「案件」タブに貼ってください。"],
        };
    }
  } catch (err) {
    if (err instanceof LinkBuildError) {
      return { slug: p.slug, ok: false, reason: err.message, howToFix: err.howToFix };
    }
    return { slug: p.slug, ok: false, reason: String((err as Error).message ?? err) };
  }
}

/** 名前を比べるための正規化。誤マッチで別会社のリンクを貼らないよう、厳しめに揃える。 */
export function normalizeName(s: string): string {
  return s.toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|software|app|io|com)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function logOutcome(o: BuildOutcome): void {
  if (o.ok) {
    log.ok(`${o.slug}: ${o.method} でリンクを発行しました`);
    if (o.note) log.info(`  ${o.note}`);
  } else {
    log.warn(`${o.slug}: 自動発行できませんでした — ${o.reason}`);
    for (const h of o.howToFix ?? []) log.info(`  ${h}`);
  }
}
