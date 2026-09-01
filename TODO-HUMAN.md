# あなたがやること（これ以外は全部自動）

最終更新: 2026-08-31T09:52:31.863Z

未完了 **6 件 / 合計 約100分**。ここが空になれば、あとはリポジトリが勝手に回り続けます。

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
- 自動化できない理由: アプリ作成・OAuth 承認・審査申請は本人操作が必須です。さらに Trial access のまま API で作ったピンは『自分にしか見えない Sandbox ピン』になるため、流入源にするには Standard access の審査を通す必要があります（審査には録画の提出が必要で、数日〜数週間かかることがあります）。
- これが終わるまで止まるもの: ピンの自動投稿 / ピンの数値取得 / 勝ち型の自動検出

### 手順

1. developers.pinterest.com/apps/ で App を作成（ビジネスアカウントでログイン）
2. Trial access の審査を申請し、承認を待つ（App secret と Redirect URI は承認後に設定できるようになります）
3. 承認されたら App ID と App secret を控える
4. `npm run autopilot pinterest:auth` を実行すると、登録すべき Redirect URI が表示されます
5. その URL を App の Redirect URIs に一字一句そのまま登録
6. もう一度 pinterest:auth を実行 → 表示された URL をブラウザで開いて承認 → PINTEREST_REFRESH_TOKEN を控える
7. GitHub Secrets に PINTEREST_APP_ID / PINTEREST_APP_SECRET / PINTEREST_REFRESH_TOKEN を登録
8. 続けて Standard access を申請する（**動画の提出が必要**。自分ひとりで使う場合でも必要です）
   → **何を撮るかは下の「審査動画の撮り方」を読んでから撮ってください。**
      OAuth の画面だけを撮ると落ちます。
9. ★ 審査待ちの間も止まりません: `npm run autopilot pins:export` で CSV と画像を書き出し、手動投稿か外部の予約ツール（Tailwind など）で回せます

### ★ 審査動画の撮り方（ここを間違えると落ちます）

Pinterest が求めているのは **「アプリが Pinterest API を使って実際に何かを完了するところ」** です。
OAuth の許可画面までを撮っただけでは足りません。**3つとも1本の動画に入れてください。**

| # | 撮るもの | 具体的に何が映っていればよいか |
| --- | --- | --- |
| ① | **許可を求める画面** | `/pinterest-connect/` → Pinterest の「アクセスを許可する」を押すところ |
| ② | **コードをトークンに交換するところ** | GitHub の Actions →「Pinterest 認可コードをトークンに交換」→ Run workflow →<br>緑のチェックと「PINTEREST_REFRESH_TOKEN を Secrets に登録しました」の行 |
| ③ | **APIで実際にピンを作るところ** | ピン投稿のワークフローを実行 → ログに出るピンID →<br>**Pinterest を開いて、そのピンが実在することを見せる** |

③ は Trial access のままで撮れます。**Trial でも API でピンは作れます**（作ったピンが
自分にしか見えないだけです）。「自分にしか見えない」ことは審査の妨げになりません。

**撮り方のコツ**

- **画面録画は縦のまま出さず、横向き（またはトリミング）で。** 縦のスマホ画面をそのまま
  出すと、左右が真っ黒で文字が小さくなります。審査する人はパソコンで見ます
- **端末の言語を英語にしてから撮る。** 審査する人は日本語を読みません。
  難しければ、動画に英語の字幕を1行ずつ入れる
- **秘密情報は映さない。** App Secret とトークンは絶対に映さない。
  （App ID と Redirect URI は公開情報なので映って構いません）
- 長さは 1〜3分で十分です。無言でも構いません

**やってはいけないこと**（審査で落ちる理由になります）

- Pinterest の ID とパスワードを自分のアプリの画面で入力する
- すでにトークンを持っている状態から動画を始める（①が無いとみなされます）
- 画面を撮らず、説明文だけで済ませる

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

