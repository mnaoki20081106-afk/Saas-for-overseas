# あなたがやること（これ以外は全部自動）

最終更新: 2026-09-01T08:05:16.197Z

未完了 **9 件 / 合計 約136分**。ここが空になれば、あとはリポジトリが勝手に回り続けます。

---

## ⬜ Anthropic API キーを取得して GitHub Secrets に登録する

- 所要時間: **約 10 分**
- リンク: https://console.anthropic.com/settings/keys
- 自動化できない理由: API キーの発行は本人のアカウント操作でしか行えません（1回だけ）。
- これが終わるまで止まるもの: 記事生成 / 案件リサーチ / ピン文案生成

### 手順

1. https://console.anthropic.com/ にログイン（アカウントが無ければ作成）
2. Billing で最低 $20 ほどクレジットを購入（記事1本あたり概ね $1〜3 の想定）
3. Settings → API keys → Create Key。表示されたキーをコピー（再表示できません）
4. GitHub のこのリポジトリ → Settings → Secrets and variables → Actions → New repository secret
5. Name に ANTHROPIC_API_KEY、Secret に貼り付けて Add secret

<sub>完了したら: `npm run autopilot task:done cred-anthropic`</sub>

---

## ⬜ Pinterest API アプリを作り、Standard access まで通す

- 所要時間: **約 40 分**
- リンク: https://developers.pinterest.com/apps/
- 自動化できない理由: アプリ作成・OAuth 承認・審査申請は本人操作が必須です。さらに Trial access のまま API で作ったピンは『自分にしか見えない Sandbox ピン』になるため、流入源にするには Standard access の審査を通す必要があります（審査には OAuth フローの録画提出が必要で、数日〜数週間かかることがあります）。
- これが終わるまで止まるもの: ピンの自動投稿 / ピンの数値取得 / 勝ち型の自動検出

### 手順

1. developers.pinterest.com/apps/ で App を作成（ビジネスアカウントでログイン）
2. Trial access の審査を申請し、承認を待つ（App secret と Redirect URI は承認後に設定できるようになります）
3. 承認されたら App ID と App secret を控える
4. `npm run autopilot pinterest:auth` を実行すると、登録すべき Redirect URI が表示されます
5. その URL を App の Redirect URIs に一字一句そのまま登録
6. もう一度 pinterest:auth を実行 → 表示された URL をブラウザで開いて承認 → PINTEREST_REFRESH_TOKEN を控える
7. GitHub Secrets に PINTEREST_APP_ID / PINTEREST_APP_SECRET / PINTEREST_REFRESH_TOKEN を登録
8. 続けて Standard access を申請する（OAuth フローを画面録画した動画の提出が必要。自分ひとりで使う場合でも必要です）
9. ★ 審査待ちの間も止まりません: `npm run autopilot pins:export` で CSV と画像を書き出し、手動投稿か外部の予約ツール（Tailwind など）で回せます

<sub>完了したら: `npm run autopilot task:done cred-pinterest-api`</sub>

---

## ⬜ アフィリエイトネットワークの API キーを登録する（成果の自動集計用）

- 所要時間: **約 20 分**
- 自動化できない理由: 各ネットワークの管理画面でしか発行できません。未登録でも記事とピンの自動化は動きます（売上集計だけ手入力になります）。
- これが終わるまで止まるもの: 売上の自動集計 / 平均継続期間の実測 / 週次レポートの収益セクション

### 手順

1. Impact: 管理画面 → Settings → API → Account SID と Auth Token を控えて IMPACT_ACCOUNT_SID / IMPACT_AUTH_TOKEN に登録
2. ShareASale: Tools → Merchant Data Feeds → API → SHAREASALE_AFFILIATE_ID / SHAREASALE_API_TOKEN / SHAREASALE_API_SECRET
3. PartnerStack: Settings → Integrations → API keys → PARTNERSTACK_API_KEY / PARTNERSTACK_API_SECRET
4. どれか1つでも入れれば、その分だけ自動集計されます

<sub>完了したら: `npm run autopilot task:done cred-networks`</sub>

---

## ⬜ GitHub Pages を有効にして、サイトの URL を設定する

- 所要時間: **約 5 分**
- 自動化できない理由: リポジトリ設定の変更は所有者の操作が必要です（1回だけ）。
- これが終わるまで止まるもの: 記事の公開 / ピンのリンク先 / sitemap と canonical

### 手順

1. このリポジトリ → Settings → Pages → Build and deployment の Source を「GitHub Actions」にする
2. 同じく Settings → Actions → General → Workflow permissions を「Read and write permissions」にする
3. 公開 URL（例: https://<ユーザー名>.github.io/<リポジトリ名>）を控える
4. Settings → Secrets and variables → Actions → Variables タブ → New repository variable
5. Name に SITE_BASE_URL、Value にその URL を入れて保存
6. （ローカルで動かす場合は config/config.json の site.baseUrl も同じ値に）
7. ついでに site.name / site.tagline / site.description を自分のサイト名に変えておくと良いです

<sub>完了したら: `npm run autopilot task:done setup-pages`</sub>

---

## ⬜ Pinterest のビジネスアカウントを作る

- 所要時間: **約 15 分**
- リンク: https://www.pinterest.com/
- 自動化できない理由: アカウント作成は本人操作が必須です（1回だけ）。
- これが終わるまで止まるもの: ピンの投稿全般

### 手順

1. 【PC で行ってください】新規のビジネスアカウント作成はスマホアプリからはできません
2. 使うメールアドレスを決める。既に Pinterest で使っているアドレスは使えません（新規なら別アドレスを用意）
3. ⚠ pinterest.com を開くと、アクセス元の場所から自動判定されて jp.pinterest.com に転送されることがあります。そのまま登録すると国が日本に設定されるおそれがあるため、URL 欄が jp.pinterest.com になっていないか必ず確認してください
4. jp.pinterest.com になっていたら、ページ下部（フッター）の言語/国切り替えリンクを探して United States / English に変更するか、ブラウザのシークレットウィンドウで https://www.pinterest.com/ を開き直してください
5. www.pinterest.com の状態で、右上の「Sign up / 登録」→ 登録フォームの下にある「ビジネスアカウントを作成 / Create a business account」のリンクを押す
6. （見つからない場合）business.pinterest.com を開いて右上の「Sign up」からでも同じ画面に入れます
7. メールアドレス・パスワード・生年月日を入力して作成
8. プロフィール（ビジネス名・ロゴ・ウェブサイトURL・国・言語）を入力。国は必ず United States、言語は English を選ぶ（英語圏に配信するため）
9. ⚠ 国の設定は登録後の変更が効かない、または扱いが不安定という報告があります。ここで妥協せず、必ず United States になっていることを確認してから次に進んでください
10. 広告を出すか聞かれたら「今はしない」で構いません
11. ※ 既に個人アカウントを持っている場合は、プロフィールメニューからビジネスアカウントへの切り替え・追加もできます（その場合も設定 → Personal information で国が United States になっているか確認）

<sub>完了したら: `npm run autopilot task:done cred-pinterest`</sub>

---

## ⬜ Pinterest でサイトの所有権を確認する（Claim）

- 所要時間: **約 10 分**
- 自動化できない理由: Pinterest の管理画面での操作が必要です。確認コードの埋め込み側は自動化済みです。
- これが終わるまで止まるもの: ピンの表示優先度 / リンクの信頼度 / アナリティクスの精度

### 手順

1. Pinterest 右上の v アイコン →「設定 / Settings」
2. 左メニューの「Pinterest にリンク / Link to Pinterest」→ Websites の「申請する / Claim」
3. 認証方法で「HTML タグを追加 / Add HTML tag」を選ぶ
4. 表示された <meta name="p:domain_verify" content="XXXX"> の XXXX の部分だけをコピー
5. config/config.json の site.pinterestVerifyCode に貼る
6. npm run autopilot site:build → git push → GitHub Actions が緑になるまで待つ
7. Pinterest の画面に戻って自分のサイト URL を入れて「確認 / Verify」
8. ※ 確認できたかは 設定 →「リンク済みアカウント / Claimed accounts」で見られます

<sub>完了したら: `npm run autopilot task:done setup-pinterest-claim`</sub>

---

## ⬜ Sample Kanbanly のアフィリエイトプログラムに応募する（PartnerStack）

- 所要時間: **約 12 分**
- リンク: https://sample-kanbanly.example.com/affiliates
- 自動化できない理由: 相手企業の審査担当者が人間なので、応募フォームの送信と本人確認・税務情報の入力だけは自動化できません。回答文は全部こちらで書いてあります。
- これが終わるまで止まるもの: Sample Kanbanly の報酬発生（記事とピンは応募前でも先に作れます）

### 手順

1. PartnerStack のプログラムページから直接サインアップ（審査が緩く早い）
2. 応募先: https://sample-kanbanly.example.com/affiliates
3. 下の「回答の下書き」をフォームにコピペする
4. サイト URL には自分の GitHub Pages の URL を入れる（記事が1本でも公開されていれば通りやすい）
5. 承認されたら、発行されたアフィリエイトリンクを控える
6. 承認後にこれを実行: npm run autopilot link:set sample-kanbanly "<アフィリエイトリンク>"
7. → 次回のサイトビルドで、全記事のリンクが自動的に差し替わります

### 回答の下書き（そのままコピペしてください）

**How will you promote us? / プロモーション方法**

```text
We publish long-form, experience-based comparison articles for freelancers, small agencies and 2-20 person SaaS/e-commerce teams in the US, UK, Canada and Australia, and distribute them through Pinterest, where we build category boards around specific buying problems. For Sample Kanbanly we plan a dedicated review plus at least two comparison articles against Competitor A and Competitor B, each with a clear disclosure and a genuine assessment of who the tool is not for. Our traffic is evergreen rather than news-driven, so a published article keeps sending qualified trial signups for months.
```

**Describe your audience / 読者層**

```text
freelancers, small agencies and 2-20 person SaaS/e-commerce teams in the US, UK, Canada and Australia. They are hands-on operators, usually the person who both chooses and pays for the tool, and they read comparisons before starting a trial.
```

**Monthly traffic / 月間トラフィック**

```text
This is a new site, so traffic is still small and growing. Our distribution is Pinterest plus organic search on evergreen comparison queries, and we would rather show you real numbers as they build than quote a figure we cannot back up.
```

**Promotional methods / 手法（チェックボックス）**

```text
Content / blog / Social media (Pinterest) / SEO / Comparison and review content
```

**Bio / プロフィール**

```text
We run Worked For Us, an independent site that compares subscription software for small teams. We buy and use the tools we write about, and we publish the cases where a tool is the wrong choice.
```

**Website URL**

```text
https://example.github.io/saas-for-overseas
```


<sub>完了したら: `npm run autopilot task:done apply-sample-kanbanly`</sub>

---

## ⬜ Sample Rankwise のアフィリエイトプログラムに応募する（PartnerStack）

- 所要時間: **約 12 分**
- リンク: https://sample-rankwise.example.com/affiliates
- 自動化できない理由: 相手企業の審査担当者が人間なので、応募フォームの送信と本人確認・税務情報の入力だけは自動化できません。回答文は全部こちらで書いてあります。
- これが終わるまで止まるもの: Sample Rankwise の報酬発生（記事とピンは応募前でも先に作れます）

### 手順

1. PartnerStack のプログラムページから直接サインアップ（審査が緩く早い）
2. 応募先: https://sample-rankwise.example.com/affiliates
3. 下の「回答の下書き」をフォームにコピペする
4. サイト URL には自分の GitHub Pages の URL を入れる（記事が1本でも公開されていれば通りやすい）
5. 承認されたら、発行されたアフィリエイトリンクを控える
6. 承認後にこれを実行: npm run autopilot link:set sample-rankwise "<アフィリエイトリンク>"
7. → 次回のサイトビルドで、全記事のリンクが自動的に差し替わります

### 回答の下書き（そのままコピペしてください）

**How will you promote us? / プロモーション方法**

```text
We publish long-form, experience-based comparison articles for freelancers, small agencies and 2-20 person SaaS/e-commerce teams in the US, UK, Canada and Australia, and distribute them through Pinterest, where we build category boards around specific buying problems. For Sample Rankwise we plan a dedicated review plus at least two comparison articles against Competitor A and Competitor B, each with a clear disclosure and a genuine assessment of who the tool is not for. Our traffic is evergreen rather than news-driven, so a published article keeps sending qualified trial signups for months.
```

**Describe your audience / 読者層**

```text
freelancers, small agencies and 2-20 person SaaS/e-commerce teams in the US, UK, Canada and Australia. They are hands-on operators, usually the person who both chooses and pays for the tool, and they read comparisons before starting a trial.
```

**Monthly traffic / 月間トラフィック**

```text
This is a new site, so traffic is still small and growing. Our distribution is Pinterest plus organic search on evergreen comparison queries, and we would rather show you real numbers as they build than quote a figure we cannot back up.
```

**Promotional methods / 手法（チェックボックス）**

```text
Content / blog / Social media (Pinterest) / SEO / Comparison and review content
```

**Bio / プロフィール**

```text
We run Worked For Us, an independent site that compares subscription software for small teams. We buy and use the tools we write about, and we publish the cases where a tool is the wrong choice.
```

**Website URL**

```text
https://example.github.io/saas-for-overseas
```


<sub>完了したら: `npm run autopilot task:done apply-sample-rankwise`</sub>

---

## ⬜ Sample Flowdesk のアフィリエイトプログラムに応募する（PartnerStack）

- 所要時間: **約 12 分**
- リンク: https://sample-flowdesk.example.com/affiliates
- 自動化できない理由: 相手企業の審査担当者が人間なので、応募フォームの送信と本人確認・税務情報の入力だけは自動化できません。回答文は全部こちらで書いてあります。
- これが終わるまで止まるもの: Sample Flowdesk の報酬発生（記事とピンは応募前でも先に作れます）

### 手順

1. PartnerStack のプログラムページから直接サインアップ（審査が緩く早い）
2. 応募先: https://sample-flowdesk.example.com/affiliates
3. 下の「回答の下書き」をフォームにコピペする
4. サイト URL には自分の GitHub Pages の URL を入れる（記事が1本でも公開されていれば通りやすい）
5. 承認されたら、発行されたアフィリエイトリンクを控える
6. 承認後にこれを実行: npm run autopilot link:set sample-flowdesk "<アフィリエイトリンク>"
7. → 次回のサイトビルドで、全記事のリンクが自動的に差し替わります

### 回答の下書き（そのままコピペしてください）

**How will you promote us? / プロモーション方法**

```text
We publish long-form, experience-based comparison articles for freelancers, small agencies and 2-20 person SaaS/e-commerce teams in the US, UK, Canada and Australia, and distribute them through Pinterest, where we build category boards around specific buying problems. For Sample Flowdesk we plan a dedicated review plus at least two comparison articles against Competitor A and Competitor B, each with a clear disclosure and a genuine assessment of who the tool is not for. Our traffic is evergreen rather than news-driven, so a published article keeps sending qualified trial signups for months.
```

**Describe your audience / 読者層**

```text
freelancers, small agencies and 2-20 person SaaS/e-commerce teams in the US, UK, Canada and Australia. They are hands-on operators, usually the person who both chooses and pays for the tool, and they read comparisons before starting a trial.
```

**Monthly traffic / 月間トラフィック**

```text
This is a new site, so traffic is still small and growing. Our distribution is Pinterest plus organic search on evergreen comparison queries, and we would rather show you real numbers as they build than quote a figure we cannot back up.
```

**Promotional methods / 手法（チェックボックス）**

```text
Content / blog / Social media (Pinterest) / SEO / Comparison and review content
```

**Bio / プロフィール**

```text
We run Worked For Us, an independent site that compares subscription software for small teams. We buy and use the tools we write about, and we publish the cases where a tool is the wrong choice.
```

**Website URL**

```text
https://example.github.io/saas-for-overseas
```


<sub>完了したら: `npm run autopilot task:done apply-sample-flowdesk`</sub>

---

