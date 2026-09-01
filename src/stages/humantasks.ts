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
      kind: "account_setup",
      title: "Pinterest のビジネスアカウントを作る",
      whyItCannotBeAutomated: "アカウント作成は本人操作が必須です（1回だけ）。",
      minutes: 15,
      url: "https://www.pinterest.com/",
      steps: [
        "【PC で行ってください】新規のビジネスアカウント作成はスマホアプリからはできません",
        "使うメールアドレスを決める。既に Pinterest で使っているアドレスは使えません（新規なら別アドレスを用意）",
        "⚠ pinterest.com を開くと、アクセス元の場所から自動判定されて jp.pinterest.com に転送されることがあります。" +
          "そのまま登録すると国が日本に設定されるおそれがあるため、URL 欄が jp.pinterest.com になっていないか必ず確認してください",
        "jp.pinterest.com になっていたら、ページ下部（フッター）の言語/国切り替えリンクを探して United States / English に変更するか、" +
          "ブラウザのシークレットウィンドウで https://www.pinterest.com/ を開き直してください",
        "www.pinterest.com の状態で、右上の「Sign up / 登録」→ 登録フォームの下にある「ビジネスアカウントを作成 / Create a business account」のリンクを押す",
        "（見つからない場合）business.pinterest.com を開いて右上の「Sign up」からでも同じ画面に入れます",
        "メールアドレス・パスワード・生年月日を入力して作成",
        "プロフィール（ビジネス名・ロゴ・ウェブサイトURL・国・言語）を入力。国は必ず United States、言語は English を選ぶ（英語圏に配信するため）",
        "⚠ 国の設定は登録後の変更が効かない、または扱いが不安定という報告があります。ここで妥協せず、必ず United States になっていることを確認してから次に進んでください",
        "広告を出すか聞かれたら「今はしない」で構いません",
        "※ 既に個人アカウントを持っている場合は、プロフィールメニューからビジネスアカウントへの切り替え・追加もできます（その場合も設定 → Personal information で国が United States になっているか確認）",
      ],
      blocks: ["ピンの投稿全般"],
    });

    add({
      id: "setup-pinterest-claim",
      kind: "account_setup",
      title: "Pinterest でサイトの所有権を確認する（Claim）",
      whyItCannotBeAutomated: "Pinterest の管理画面での操作が必要です。確認コードの埋め込み側は自動化済みです。",
      minutes: 10,
      steps: [
        "Pinterest 右上の v アイコン →「設定 / Settings」",
        "左メニューの「Pinterest にリンク / Link to Pinterest」→ Websites の「申請する / Claim」",
        "認証方法で「HTML タグを追加 / Add HTML tag」を選ぶ",
        '表示された <meta name="p:domain_verify" content="XXXX"> の XXXX の部分だけをコピー',
        "config/config.json の site.pinterestVerifyCode に貼る",
        "npm run autopilot site:build → git push → GitHub Actions が緑になるまで待つ",
        "Pinterest の画面に戻って自分のサイト URL を入れて「確認 / Verify」",
        "※ 確認できたかは 設定 →「リンク済みアカウント / Claimed accounts」で見られます",
      ],
      blocks: ["ピンの表示優先度", "リンクの信頼度", "アナリティクスの精度"],
    });

    add({
      id: "cred-pinterest-api",
      kind: "credential",
      title: "Pinterest API アプリを作り、Standard access まで通す",
      whyItCannotBeAutomated:
        "アプリ作成・OAuth 承認・審査申請は本人操作が必須です。さらに Trial access のまま API で作ったピンは『自分にしか見えない Sandbox ピン』になるため、流入源にするには Standard access の審査を通す必要があります（審査には録画の提出が必要で、数日〜数週間かかることがあります）。",
      minutes: 40,
      url: "https://developers.pinterest.com/apps/",
      steps: [
        "developers.pinterest.com/apps/ で App を作成（ビジネスアカウントでログイン）",
        "Trial access の審査を申請し、承認を待つ（App secret と Redirect URI は承認後に設定できるようになります）",
        "承認されたら App ID と App secret を控える",
        "`npm run autopilot pinterest:auth` を実行すると、登録すべき Redirect URI が表示されます",
        "その URL を App の Redirect URIs に一字一句そのまま登録",
        "もう一度 pinterest:auth を実行 → 表示された URL をブラウザで開いて承認 → PINTEREST_REFRESH_TOKEN を控える",
        "GitHub Secrets に PINTEREST_APP_ID / PINTEREST_APP_SECRET / PINTEREST_REFRESH_TOKEN を登録",
        "続けて Standard access を申請する（動画の提出が必要。自分ひとりで使う場合でも必要です）",
        "★★ 動画は『3点セット』で撮ること。①許可画面 ②コードをトークンに交換 ③APIで実際にピンを作る。この3つが1本に入っていないと落ちます（下の『審査動画の撮り方』を読んでから撮ってください）",
        "★ 審査待ちの間も止まりません: `npm run autopilot pins:export` で CSV と画像を書き出し、手動投稿か外部の予約ツール（Tailwind など）で回せます",
      ],
      blocks: ["ピンの自動投稿", "ピンの数値取得", "勝ち型の自動検出"],
      appendix: PINTEREST_VIDEO_GUIDE,
    });
  }

  if (!env.impact.configured && !env.shareasale.configured && !env.partnerstack.configured) {
    add({
      id: "cred-networks",
      kind: "credential",
      title: "アフィリエイトネットワークの API キーを登録する（★アフィリエイトURLの自動発行に使います）",
      whyItCannotBeAutomated: "各ネットワークの管理画面でしか発行できません。未登録でも記事とピンの自動化は動きますが、アフィリエイトURLを毎回手で貼ることになります。",
      minutes: 20,
      steps: [
        "Impact: 管理画面 → Settings → API → Account SID と Auth Token を控えて IMPACT_ACCOUNT_SID / IMPACT_AUTH_TOKEN に登録",
        "★Awin（旧ShareASale）: https://ui.awin.com/awin-api で自分でトークンを発行 → AWIN_API_TOKEN に登録。あわせて自分の Publisher ID を AWIN_PUBLISHER_ID に登録",
        "PartnerStack: Settings → Integrations → API keys → PARTNERSTACK_API_KEY / PARTNERSTACK_API_SECRET（売上集計用。URL発行には使えません）",
        "Rewardful: APIキーはマーチャント（相手企業）専用なので、こちらでは使えません。登録するものはありません",
        "どれか1つでも入れれば、その分だけ自動になります",
      ],
      blocks: ["アフィリエイトURLの自動発行", "売上の自動集計", "平均継続期間の実測", "週次レポートの収益セクション"],
      appendix: AFFILIATE_LINK_AUTOMATION,
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
        stage: "growth",
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

/**
 * アフィリエイトURLの自動化の説明。
 *
 * ★2026-09-01 に4社を実地で調べた結果です。
 *   「提携申請」と「リンク発行」は別作業で、自動化できるのは後者だけです。
 *   ここを混同すると「自動化できない」と誤解して、毎回手で貼ることになります。
 */
const AFFILIATE_LINK_AUTOMATION = [
  "### ★ アフィリエイトURLはどこまで自動になるか",
  "",
  "**「提携申請」と「リンク発行」は別の作業です。**",
  "",
  "- **提携申請** … 相手企業の担当者が人間として審査します。本人確認と税務情報も要ります。",
  "  **4社とも自動化できません。** なおきさんの作業です（自動化を試みること自体が規約違反になります）",
  "- **リンク発行** … 承認されたあと「このページ用の追跡URLをください」と頼む作業。**ここは自動にできます**",
  "",
  "| ネットワーク | 提携申請 | リンク発行 | なおきさんの手作業 |",
  "| --- | --- | --- | --- |",
  "| **Impact** | 人間 | **完全自動** | APIキーを1回登録するだけ |",
  "| **Awin**（旧ShareASale） | 人間 | **完全自動** | APIトークンを1回登録するだけ |",
  "| **PartnerStack** | 人間 | 半自動 | 案件ごとに紹介リンクを1回コピー |",
  "| **Rewardful** | 人間 | 半自動 | 案件ごとに via トークンを1回コピー |",
  "",
  "**Impact は承認済みプログラムの一覧まで自動で取れます。** 承認された案件を名前で",
  "自動照合し、リンクまで取ってきます。**なおきさんの操作はゼロです。**",
  "",
  "PartnerStack と Rewardful は、パートナー側のAPIが公開されていません。",
  "**ただし1回コピーすれば、以降そのマーチャントのリンクは全部自動で作れます。**",
  "貼る場所は管理画面の「案件」タブです。",
  "",
  "**★ ShareASale は 2025-10-06 に閉鎖され、Awin に統合されました。**",
  "ShareASale のアカウントとリンクは Awin へ自動移行されています。",
  "新しく使うなら Awin 側です。`api.shareasale.com` はもう動きません。",
  "",
  "```bash",
  "npm run co -- links:how               # いま何が自動で何が手作業かを見る",
  "npm run co -- links:sync --dry-run    # 何が起きるか確かめるだけ",
  "npm run co -- links:sync              # 発行して全記事のリンクに反映",
  "```",
].join("\n");

/**
 * Pinterest Standard access の審査動画の撮り方。
 *
 * ★ここを間違えたことが一度あります（2026-09-01）。
 *   「OAuth フローを画面録画」とだけ書いてあったため、許可画面から
 *   認可コードを受け取るところまでで終わる動画を提出してしまいました。
 *   Pinterest が求めているのは「アプリが API を使って動作を完了する録画」です。
 *   同じ失敗を繰り返さないよう、ここに撮る内容を固定します。
 */
const PINTEREST_VIDEO_GUIDE = [
  "### ★ 審査動画の撮り方（ここを間違えると落ちます）",
  "",
  "Pinterest が見たいのは **「アプリが Pinterest API を使って、実際に何かを完了するところ」** です。",
  "許可画面までを撮っただけでは足りません。**次の3つを1本の動画に入れてください。**",
  "",
  "| # | 撮るもの | 画面に何が映っていればよいか |",
  "| --- | --- | --- |",
  "| ① | 許可を求める画面 | `/pinterest-connect/` →「Pinterestに接続する」→ Pinterest の「アクセスを許可する」を押すところ |",
  "| ② | コードをトークンに交換するところ | GitHub → Actions →「Pinterest 認可コードをトークンに交換」→ Run workflow →<br>緑のチェックと「PINTEREST_REFRESH_TOKEN を Secrets に登録しました」の行 |",
  "| ③ | API で実際にピンを作るところ | Actions →「Autopilot / 3時間おき（予約したピンを投稿）」→ Run workflow →<br>ログの「投稿: ... → pin 12345」の行 → **Pinterest を開いて、そのピンが実在することを見せる** |",
  "",
  "③ は **Trial access のままで撮れます。** Trial でも API でピンは作れます",
  "（作ったピンが自分にしか見えないだけで、これは審査の妨げになりません）。",
  "",
  "**撮り方のコツ**",
  "",
  "- **縦のスマホ画面をそのまま出さない。** 左右が黒帯になって文字が読めません。",
  "  横向きで撮るか、縦のまま撮ったなら黒帯を切り落としてから出す",
  "- **端末の言語を英語にしてから撮る。** 審査する人は日本語を読みません。",
  "  難しければ、動画に英語の字幕を1行ずつ入れる",
  "- **秘密情報を映さない。** App Secret とアクセストークンは絶対に映さない",
  "  （App ID と Redirect URI は公開情報なので映って構いません）",
  "- 長さは1〜3分で十分。無言でも構いません",
  "",
  "**やってはいけないこと（落ちる理由になります）**",
  "",
  "- Pinterest の ID とパスワードを、自分のアプリの画面で入力する",
  "- すでにトークンを持っている状態から動画を始める（①が無いとみなされます）",
  "- 画面を撮らず、説明文だけで済ませる",
  "",
  "**③ を撮るには、投稿できるピンが1枚必要です。**",
  "いま記事もピンも0件なので、撮影の前に諭吉に「撮影用のピンを用意して」と言ってください。",
].join("\n");

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
    if (t.appendix) lines.push("", t.appendix);
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
