import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { config, env, affiliateLinks } from "../lib/config";
import { structured, withFixture } from "../lib/claude";
import { log } from "../lib/log";
import { humanTasks, programs } from "../lib/store";
import { P } from "../lib/paths";
import type { HumanTask, Program } from "../lib/types";
import { nowISO } from "../lib/util";

/**
 * このプロジェクトで「どうしても人間しかできないこと」を洗い出し、
 * コピペで終わるところまで下書きしておくステージ。
 *
 * 自動化できない理由は 3 つだけ:
 *   (a) 本人確認・契約・税務情報の入力(法律上、代理でできない)
 *   (b) 各社の審査(相手企業の人間が判断する)
 *   (c) API キーの初回発行(認証情報の発行は本人操作が必須)
 * それ以外は全部このリポジトリが自動でやる。
 */

const ApplicationDraft = z.object({
  whyPromote: z.string().describe("Answer to 'How will you promote us?' — 80-120 words, specific, mentions Pinterest + long-form comparison content"),
  audienceDescription: z.string().describe("Answer to 'Describe your audience' — 50-80 words"),
  monthlyTrafficAnswer: z.string().describe("Honest answer for a new site that does not overstate traffic, 30-50 words"),
  promotionalMethods: z.array(z.string()).describe("Checkbox-style list, e.g. 'Content / blog', 'Social media (Pinterest)'"),
  shortBio: z.string().describe("40-60 word bio for the partner profile"),
});

function credentialTasks(): HumanTask[] {
  const tasks: HumanTask[] = [];

  const add = (t: Omit<HumanTask, "status" | "createdAt">) =>
    tasks.push({ ...t, status: "open", createdAt: nowISO() });

  if (!env.anthropicKey) {
    add({
      id: "cred-anthropic",
      kind: "credential",
      title: "Anthropic API キーを取得して GitHub Secrets に登録する",
      whyItCannotBeAutomated: "API キーの発行は本人のアカウント操作でしか行えません（1回だけ）。",
      minutes: 10,
      url: "https://console.anthropic.com/settings/keys",
      steps: [
        "https://console.anthropic.com/ にログイン（アカウントが無ければ作成）",
        "Billing で最低 $20 ほどクレジットを購入（記事1本あたり概ね $1〜3 の想定）",
        "Settings → API keys → Create Key。表示されたキーをコピー（再表示できません）",
        "GitHub のこのリポジトリ → Settings → Secrets and variables → Actions → New repository secret",
        "Name に ANTHROPIC_API_KEY、Secret に貼り付けて Add secret",
      ],
      blocks: ["記事生成", "案件リサーチ", "ピン文案生成"],
    });
  }

  const c = config();
  if (c.site.baseUrl.includes("example.")) {
    add({
      id: "setup-pages",
      kind: "account_setup",
      title: "GitHub Pages を有効にして、サイトの URL を設定する",
      whyItCannotBeAutomated: "リポジトリ設定の変更は所有者の操作が必要です（1回だけ）。",
      minutes: 5,
      steps: [
        "このリポジトリ → Settings → Pages → Build and deployment の Source を「GitHub Actions」にする",
        "同じく Settings → Actions → General → Workflow permissions を「Read and write permissions」にする",
        "公開 URL（例: https://<ユーザー名>.github.io/<リポジトリ名>）を控える",
        "Settings → Secrets and variables → Actions → Variables タブ → New repository variable",
        "Name に SITE_BASE_URL、Value にその URL を入れて保存",
        "（ローカルで動かす場合は config/config.json の site.baseUrl も同じ値に）",
        "ついでに site.name / site.tagline / site.description を自分のサイト名に変えておくと良いです",
      ],
      blocks: ["記事の公開", "ピンのリンク先", "sitemap と canonical"],
    });
  }

  if (!env.pinterest.configured) {
    add({
      id: "cred-pinterest",
      kind: "credential",
      title: "Pinterest のビジネスアカウントと API アプリを作る",
      whyItCannotBeAutomated: "アカウント作成と OAuth 承認は本人操作が必須です（1回だけ）。",
      minutes: 30,
      url: "https://developers.pinterest.com/apps/",
      steps: [
        "pinterest.com/business/create でビジネスアカウントを作成（無料）。言語と地域は English / United States に",
        "Settings → Claimed accounts → Claim website で自分のサイト URL を入力し、HTML tag 方式を選ぶ",
        'そこに出る <meta name="p:domain_verify" content="XXXX"> の XXXX だけを config/config.json の site.pinterestVerifyCode に貼る',
        "npm run autopilot site:build を実行して push → サイトに反映されたら Pinterest 側で Verify を押す",
        "https://developers.pinterest.com/apps/ で App を作成",
        "App の Redirect URI に、`npm run autopilot pinterest:auth` が表示する URL をそのまま登録する（ローカルなら http://localhost:8788/callback、Codespaces なら自動で HTTPS の URL になります）",
        "App ID と App secret を控える",
        "PINTEREST_APP_ID=... PINTEREST_APP_SECRET=... npm run autopilot pinterest:auth を実行",
        "表示された URL をブラウザで開いて承認 → 端末に出た PINTEREST_REFRESH_TOKEN を控える",
        "GitHub Secrets に PINTEREST_APP_ID / PINTEREST_APP_SECRET / PINTEREST_REFRESH_TOKEN を登録",
      ],
      blocks: ["ピンの自動投稿", "ピンの数値取得", "勝ち型の自動検出"],
    });
  }

  if (!env.impact.configured && !env.shareasale.configured && !env.partnerstack.configured) {
    add({
      id: "cred-networks",
      kind: "credential",
      title: "アフィリエイトネットワークの API キーを登録する（成果の自動集計用）",
      whyItCannotBeAutomated: "各ネットワークの管理画面でしか発行できません。未登録でも記事とピンの自動化は動きます（売上集計だけ手入力になります）。",
      minutes: 20,
      steps: [
        "Impact: 管理画面 → Settings → API → Account SID と Auth Token を控えて IMPACT_ACCOUNT_SID / IMPACT_AUTH_TOKEN に登録",
        "ShareASale: Tools → Merchant Data Feeds → API → SHAREASALE_AFFILIATE_ID / SHAREASALE_API_TOKEN / SHAREASALE_API_SECRET",
        "PartnerStack: Settings → Integrations → API keys → PARTNERSTACK_API_KEY / PARTNERSTACK_API_SECRET",
        "どれか1つでも入れれば、その分だけ自動集計されます",
      ],
      blocks: ["売上の自動集計", "平均継続期間の実測", "週次レポートの収益セクション"],
    });
  }

  return tasks;
}

function applicationSteps(p: Program): string[] {
  const networkStep: Record<string, string> = {
    Impact: "Impact.com にパブリッシャー登録（無料）→ Brands で検索 → Apply",
    ShareASale: "ShareASale にアフィリエイト登録（無料）→ Merchants → Search → Join Program",
    CJ: "CJ Affiliate にパブリッシャー登録 → Advertisers → Apply",
    PartnerStack: "PartnerStack のプログラムページから直接サインアップ（審査が緩く早い）",
    Awin: "Awin にパブリッシャー登録（$5 のデポジットが必要、後で返金）→ Advertisers → Join",
    Direct: "公式サイトのアフィリエイトページから直接応募",
    Rewardful: "公式サイトのアフィリエイトページから直接応募（Rewardful のフォームが開きます）",
    FirstPromoter: "公式サイトのアフィリエイトページから直接応募（FirstPromoter のフォームが開きます）",
    Tapfiliate: "公式サイトのアフィリエイトページから直接応募",
    Unknown: "公式サイトの footer から Affiliates / Partners のリンクを探して応募",
  };
  return [
    networkStep[p.network] ?? networkStep.Unknown,
    `応募先: ${p.affiliateProgramUrl}`,
    "下の「回答の下書き」をフォームにコピペする",
    "サイト URL には自分の GitHub Pages の URL を入れる（記事が1本でも公開されていれば通りやすい）",
    "承認されたら、発行されたアフィリエイトリンクを控える",
    `承認後にこれを実行: npm run autopilot link:set ${p.slug} "<アフィリエイトリンク>"`,
    "→ 次回のサイトビルドで、全記事のリンクが自動的に差し替わります",
  ];
}

const SYSTEM = `You write affiliate program applications that get approved. You are honest about being a
new site — reviewers approve honest small publishers with a clear plan far more often than inflated claims.
You never claim traffic numbers, never promise placements you cannot deliver, and never use marketing fluff.`;

async function draftApplication(p: Program): Promise<z.infer<typeof ApplicationDraft>> {
  const c = config();
  return withFixture(
    () => ({
      whyPromote: `We publish long-form, experience-based comparison articles for ${c.niche.audience}, and distribute them through Pinterest, where we build category boards around specific buying problems. For ${p.name} we plan a dedicated review plus at least two comparison articles against ${p.mainCompetitors.slice(0, 2).join(" and ")}, each with a clear disclosure and a genuine assessment of who the tool is not for. Our traffic is evergreen rather than news-driven, so a published article keeps sending qualified trial signups for months.`,
      audienceDescription: `${c.niche.audience}. They are hands-on operators, usually the person who both chooses and pays for the tool, and they read comparisons before starting a trial.`,
      monthlyTrafficAnswer: "This is a new site, so traffic is still small and growing. Our distribution is Pinterest plus organic search on evergreen comparison queries, and we would rather show you real numbers as they build than quote a figure we cannot back up.",
      promotionalMethods: ["Content / blog", "Social media (Pinterest)", "SEO", "Comparison and review content"],
      shortBio: `We run ${c.site.name}, an independent site that compares subscription software for small teams. We buy and use the tools we write about, and we publish the cases where a tool is the wrong choice.`,
    }),
    () =>
      structured(ApplicationDraft, {
        system: SYSTEM,
        user: `Draft the answers for an affiliate program application.

Program: ${p.name} (${p.category})
Program page: ${p.affiliateProgramUrl}
Network: ${p.network}
Their main competitors: ${p.mainCompetitors.join(", ")}
Buyer pains we will write about: ${p.targetPains.join("; ")}

Our site: ${c.site.name} — ${c.site.description}
Our audience: ${c.niche.audience}
Our distribution: evergreen long-form comparison articles + Pinterest boards.
Our honest status: brand-new site, small but growing traffic.

Write answers a reviewer would approve. Be specific about what we will publish about ${p.name}.
Do not invent traffic numbers.`,
        label: `応募文の下書き: ${p.name}`,
        effort: "medium",
        maxTokens: 4000,
      }),
  );
}

export interface HumanTaskResult { created: number; open: number; markdownPath: string }

export async function refreshHumanTasks(maxApplications = 3): Promise<HumanTaskResult> {
  log.step("人間しかできない作業を洗い出して、コピペで終わる状態まで下書きする");

  let created = 0;
  for (const t of credentialTasks()) {
    if (!humanTasks.all().some((x) => x.id === t.id)) created++;
    humanTasks.upsert(t);
  }

  // 既に登録済みのアフィリエイトリンクがあるプログラムは approved 扱いにする
  const links = affiliateLinks();
  for (const p of programs.all()) {
    if (links[p.slug] && p.status !== "approved") {
      programs.setStatus(p.slug, "approved");
      humanTasks.close(`apply-${p.slug}`);
      log.ok(`${p.name}: アフィリエイトリンク登録済み → approved`);
    }
  }

  const needApply = programs
    .all()
    .filter((p) => p.status === "candidate" || p.status === "awaiting_apply")
    .filter((p) => !links[p.slug])
    .slice(0, maxApplications);

  for (const p of needApply) {
    const id = `apply-${p.slug}`;
    const existing = humanTasks.all().find((t) => t.id === id);
    if (existing?.prefilledAnswers) continue;

    const draft = await draftApplication(p);
    humanTasks.upsert({
      id,
      kind: "affiliate_application",
      title: `${p.name} のアフィリエイトプログラムに応募する（${p.network}）`,
      whyItCannotBeAutomated:
        "相手企業の審査担当者が人間なので、応募フォームの送信と本人確認・税務情報の入力だけは自動化できません。回答文は全部こちらで書いてあります。",
      minutes: 12,
      url: p.affiliateProgramUrl,
      steps: applicationSteps(p),
      prefilledAnswers: {
        "How will you promote us? / プロモーション方法": draft.whyPromote,
        "Describe your audience / 読者層": draft.audienceDescription,
        "Monthly traffic / 月間トラフィック": draft.monthlyTrafficAnswer,
        "Promotional methods / 手法（チェックボックス）": draft.promotionalMethods.join(" / "),
        "Bio / プロフィール": draft.shortBio,
        "Website URL": config().site.baseUrl,
      },
      blocks: [`${p.name} の報酬発生（記事とピンは応募前でも先に作れます）`],
      status: "open",
      createdAt: nowISO(),
    });
    programs.setStatus(p.slug, "awaiting_apply");
    created++;
    log.human(`${p.name} の応募文を下書きしました（所要 約12分）`);
  }

  const markdownPath = writeChecklist();
  const open = humanTasks.open().length;
  log.ok(`未完了の人間タスク: ${open} 件 → ${path.relative(P.root, markdownPath)}`);
  return { created, open, markdownPath };
}

export function writeChecklist(): string {
  const open = humanTasks.open();
  const done = humanTasks.all().filter((t) => t.status === "done");
  const totalMin = open.reduce((s, t) => s + t.minutes, 0);

  const lines: string[] = [
    "# あなたがやること（これ以外は全部自動）",
    "",
    `最終更新: ${nowISO()}`,
    "",
    `未完了 **${open.length} 件 / 合計 約${totalMin}分**。ここが空になれば、あとはリポジトリが勝手に回り続けます。`,
    "",
    "---",
    "",
  ];

  if (open.length === 0) {
    lines.push("## ✅ 今やることはありません", "", "GitHub Actions が自動で記事とピンを作り続けます。週次レポートだけ見てください。", "");
  }

  const order: Record<string, number> = { credential: 0, account_setup: 1, affiliate_application: 2, link_paste: 3, decision: 4 };
  for (const t of [...open].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9))) {
    lines.push(`## ⬜ ${t.title}`, "");
    lines.push(`- 所要時間: **約 ${t.minutes} 分**`);
    if (t.url) lines.push(`- リンク: ${t.url}`);
    lines.push(`- 自動化できない理由: ${t.whyItCannotBeAutomated}`);
    if (t.blocks.length) lines.push(`- これが終わるまで止まるもの: ${t.blocks.join(" / ")}`);
    lines.push("", "### 手順", "");
    t.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    if (t.prefilledAnswers) {
      lines.push("", "### 回答の下書き（そのままコピペしてください）", "");
      for (const [k, v] of Object.entries(t.prefilledAnswers)) {
        lines.push(`**${k}**`, "", "```text", v, "```", "");
      }
    }
    lines.push("", `<sub>完了したら: \`npm run autopilot task:done ${t.id}\`</sub>`, "", "---", "");
  }

  if (done.length) {
    lines.push("", "## 完了済み", "");
    for (const t of done) lines.push(`- ✅ ${t.title}（${t.doneAt?.slice(0, 10)}）`);
  }

  const out = path.join(P.root, "TODO-HUMAN.md");
  fs.writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
  return out;
}
