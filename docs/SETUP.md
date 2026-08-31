# セットアップ手順（Phase 0 — 詳細版）

SaaS もアフィリエイトも初めてという前提で、**画面のどこを押すか**まで書きます。
上から順にやれば終わります。合計 約65分。

---

## 用語（1分・ここだけ読めば以降つまずきません）

| 用語 | 意味 |
| --- | --- |
| SaaS | 月額課金のソフト。Notion や Canva のようなもの |
| 継続報酬 | 紹介した人が使い続ける限り毎月入り続ける報酬。**今回狙うのはこれだけ** |
| ASP / ネットワーク | 案件をまとめる仲介会社。Impact / ShareASale / CJ / PartnerStack |
| ピン | Pinterest に投稿する縦長の画像 |
| Secrets | GitHub にパスワード類を安全に預ける場所。コードには絶対に書きません |
| Variables | Secrets と同じ場所にある、秘密でない設定値の置き場 |
| LTV | 1件の紹介が解約されるまでに生む報酬の総額（月額 × 継続月数） |

---

# 準備：作業する場所を決める（5分）

コマンドを打つ場所が要ります。**A を強く勧めます**（PC に何もインストールしません）。

## A. GitHub Codespaces（推奨・ブラウザだけ）

1. GitHub でこのリポジトリを開く
2. 緑の **`< > Code`** ボタン → **Codespaces** タブ → **Create codespace on ...**
3. 1〜2分待つと、ブラウザの中に VS Code とターミナルが開きます
4. ターミナルで動作確認：

```bash
npm install
DRY_RUN=1 npm run autopilot bootstrap 2
```

> 無料枠は月60時間分あります。この作業には十分です。
> 使い終わったら Codespace は停止しておいてください（github.com/codespaces）。

## B. 自分の PC

1. Node.js 20 以上をインストール（https://nodejs.org/ の LTS）
2. ターミナルで：

```bash
git clone https://github.com/mnaoki20081106-afk/Saas-for-overseas.git
cd Saas-for-overseas
npm install
DRY_RUN=1 npm run autopilot bootstrap 2
npm run serve      # → http://localhost:4173 をブラウザで開く
```

**どちらの場合も、まずこれを実行して出来上がるものを見てください。** お金はかかりません。

---

# 1. Anthropic の APIキー（10分・唯一の有料項目）

記事・ピン文案・案件リサーチを書くのに使います。

### 1-1. アカウントを作る

1. https://console.anthropic.com/ を開く
2. **Sign up** →メールアドレスで登録（Google アカウントでも可）
3. 電話番号の確認を求められたら入力

### 1-2. クレジットを買う（$20 でしばらく持ちます）

1. 左メニューの **Settings** → **Billing**（「Plans & Billing」と出ることもあります）
2. **Add credits** / **Buy credits** からカードを登録し、**$20** チャージ
3. 目安：記事1本 + ピン10枚で **$1〜3**。毎日1本回して月 $30〜90

> 使いすぎが怖ければ、同じ Billing 画面の **Usage limits** で
> 月額上限（例 $50）を設定できます。先に設定しておくのを勧めます。

### 1-3. キーを作る

1. 左メニュー **Settings** → **API keys**
2. **Create Key** → 名前は `autopilot` など何でも可 → **Create**
3. `sk-ant-...` で始まる文字列が出ます。**この画面を閉じると二度と見られません。** 必ずコピー

### 1-4. GitHub に登録する

1. GitHub でこのリポジトリを開く
2. **Settings**（リポジトリの上部タブ。アカウント設定ではありません）
3. 左メニュー **Secrets and variables** → **Actions**
4. **New repository secret**
5. **Name** に `ANTHROPIC_API_KEY`、**Secret** に 1-3 でコピーした文字列 → **Add secret**

### 1-5. 手元でも使えるようにする（任意だが推奨）

```bash
cp .env.example .env
```

`.env` を開いて `ANTHROPIC_API_KEY=sk-ant-...` の行に貼る。

### 1-6. 通ったか確認する

```bash
npm run autopilot doctor
```

`✓ Anthropic API キー: 疎通OK（モデル: claude-opus-5）` と出れば完了です。
（この確認はトークン数え上げAPIを使うので、課金されません）

**❌ よくある失敗**

| 表示 | 原因と対処 |
| --- | --- |
| `キーが無効です` | コピー漏れ。前後の空白も含めて貼り直す |
| `API エラー 400: credit balance is too low` | 1-2 のチャージがまだ。$5 でも入れれば動きます |
| `未設定` | `.env` を作ったのに読まれていない。リポジトリの直下にあるか確認 |

> **安く回したいとき**：`.env` と GitHub の Variables に `CLAUDE_MODEL=claude-sonnet-5` を足すと
> 単価が下がります。ただし指定語数を下回りやすく、品質ゲートで書き直しが増えるので、
> まずは既定（opus）で1本出してから判断してください。

---

# 2. GitHub Pages を有効にする（5分・無料 ＋ 独自ドメイン推奨）

記事を公開する場所です。

> **独自ドメインを強く勧めます。** `xxx.github.io` のままだと、
> Pinterest の API 審査で「Its URL is registered with an entity in your company」
> という条件を満たせず**却下されます**（実際に起きました。2-6 で対応します）。
> 年間 $10〜15 程度で、Cloudflare Registrar などで取得できます。

### 2-1. Pages をオンにする

1. リポジトリの **Settings** → 左メニュー **Pages**
2. **Build and deployment** の **Source** を **`GitHub Actions`** に変更
   （`Deploy from a branch` ではありません。ここを間違えると公開されません）

### 2-2. Actions に書き込み権限を与える

自動化が記事とデータをリポジトリに戻すために必要です。

1. **Settings** → **Actions** → **General**
2. 一番下の **Workflow permissions**
3. **Read and write permissions** を選ぶ → **Save**

### 2-3. 公開 URL を控える

```
https://mnaoki20081106-afk.github.io/Saas-for-overseas
```

（`https://<GitHubのユーザー名>.github.io/<リポジトリ名>` の形です）

### 2-4. その URL をシステムに教える

1. **Settings** → **Secrets and variables** → **Actions**
2. 上部の **Variables** タブ（Secrets ではありません）
3. **New repository variable**
4. **Name** に `SITE_BASE_URL`、**Value** に 2-3 の URL → **Add variable**

手元でも動かすなら、`config/config.json` の `site.baseUrl` も同じ値に書き換えてください。

### 2-5. 独自ドメインをつなぐ（推奨）

ドメインを取得したら（例: `worked-for-us.com`）：

1. ドメインの管理画面（レジストラ側）で **DNS レコード**を追加する
   - apex ドメイン（`worked-for-us.com` そのもの、`www` 無し）の場合は **A レコード**を4つ追加：
     ```
     185.199.108.153
     185.199.109.153
     185.199.110.153
     185.199.111.153
     ```
   - `www.worked-for-us.com` も使いたい場合は、別途 **CNAME レコード**：
     `www` → `<GitHubのユーザー名>.github.io`
   - apex ドメインに CNAME は張れません（DNSの仕様上）。A レコード4つが正解です
2. **リポジトリの Settings → Pages → Custom domain** に取得したドメインを入力して Save
   - ⚠ このプロジェクトは GitHub Actions でデプロイしているため、**リポジトリに `CNAME` ファイルを置く必要はありません**（置いても無視されます）。ドメインの設定は Settings 側だけで完結します
3. DNS の反映と HTTPS証明書の自動発行を待つ（数分〜最大24時間程度）。
   Settings → Pages の画面で **「Enforce HTTPS」のチェックボックスが選べる状態**になったら準備完了です
4. `config/config.json` の `site.baseUrl` と、2-4 で登録した GitHub の **Variables → `SITE_BASE_URL`** を、
   両方とも新しいドメイン（`https://worked-for-us.com`）に更新する
5. Actions タブから **rebuild-site** を手動実行してサイトを再公開する
6. 自分のブラウザで新しいドメインが実際に開けることを確認してから、
   Pinterest への再申請（3章）に進む

### 2-6. サイトの名前を自分のものにする

`config/config.json` の先頭を編集します。**読者は英語圏の人なので英語で**書いてください。

```json
"site": {
  "name": "Worked For Us",                                  ← サイト名（決めた場合はそのまま）
  "tagline": "Honest, hands-on SaaS comparisons for small teams",  ← 一行説明
  "description": "Independent, experience-based comparisons of ...", ← 説明文
```

思いつかなければ既定のままで構いません。あとから変えても記事は壊れません。

### 2-7. 確認

```bash
npm run autopilot site:build
```

エラーなく `public/` が出来ればOK。この時点ではまだ公開されていません（5 で公開します）。

---

# 3. Pinterest（60分＋審査待ち・ここが一番重い）

> **先に読んでください。** Pinterest はこのプロジェクトで唯一、
> 「自分の努力だけでは終わらない」工程です。API を使って自動投稿するには
> Pinterest の審査が要り、**数日〜数週間かかることがあります。**
> ただし**審査待ちの間もパイプラインは止まりません**（3-6 に逃げ道を用意しました）。

## 3-1. ビジネスアカウントを作る（15分）

**必ず PC で行ってください。** 新規のビジネスアカウント作成はスマホアプリからはできません。

1. **使うメールアドレスを決める**
   → **すでに Pinterest で使っているアドレスは使えません。** 新規に作る場合は別のアドレスを用意してください

2. **⚠ jp.pinterest.com に飛ばされていないか確認してください。**
   `pinterest.com` を開くと、アクセス元の場所やブラウザの言語設定から自動判定されて
   `jp.pinterest.com` に転送されることがあります。ここで気づかず登録すると、
   **アカウントの国が日本に設定されます。** ブラウザのアドレスバーを見て、
   `jp.pinterest.com` になっていたら:
   - ページ下部（フッター）にある言語/国の切り替えリンクから **United States / English** を選ぶ、または
   - ブラウザの**シークレット/プライベートウィンドウ**で改めて `https://www.pinterest.com/` を開く

   `www.pinterest.com`（`jp.` が付いていない状態）になったのを確認してから次に進んでください。

3. その状態で右上の **「登録 / Sign up」**
4. 登録フォームの**下にある小さいリンク**「**ビジネスアカウントを作成 / Create a business account**」を押す
   → 見つからなければ `business.pinterest.com` を開いて右上の **Sign up** からでも同じ画面に入れます
5. メールアドレス・パスワード・生年月日を入力して作成
6. プロフィールを入力
   - **ビジネス名（表示名）**： `Worked For Us`
     → **ユーザー名を聞かれたら** `workedforus`（スペース・記号なしの半角英数字）。
       これが `pinterest.com/workedforus` という URL になります
     → 変えたい場合は、決めたあとに `config/config.json` の `site.name` /
       `site.author` も同じ名前に直してください（サイト全体のメタタグに反映されます）
   - ロゴ画像
   - ウェブサイト URL（2-3 で控えた GitHub Pages の URL）
   - **国 = United States、言語 = English** ← ここは必ず確認してください
     → 英語圏の人に配信するためです。日本語設定だと日本人にしか出ません

   > **注意**: 国の設定は、登録後に変更しても反映が不安定という報告があります
   > （Pinterest 公式が明言しているわけではありませんが、リスクとして扱ってください）。
   > **登録の最終確認画面で、国が United States になっていることを必ず目視確認してから進めてください。**

7. 「広告を出しますか」は **今はしない** で構いません

> **すでに個人アカウントがあり、それをビジネスアカウントに切り替える場合**も同様です。
> 切り替え後、**設定 → Personal information → Country** が United States になっているか確認してください。

> **すでに個人アカウントを持っている場合**は、新規に作らず
> プロフィールメニューからビジネスアカウントへの**切り替え**、または
> **ビジネスアカウントの追加**もできます。どちらでも構いません。

## 3-2. サイトの所有権を確認する（10分）

これをやると、あなたのサイトへのピンが優先的に扱われます。

> Pinterest の設定画面のメニュー名・場所は時期によって変わります。以下の**手順の道順**は
> 参考程度にし、最終的には「認証方法（Google Merchant Center / HTML タグ / HTML ファイル /
> DNS TXT レコード）」という選択肢が並ぶ画面を探してください。それが Claim（所有権確認）の画面です。

1. Pinterest の設定 / Settings 内を探し、「サイトを申請する / Claim your website」に相当する項目を開く
2. 認証方法で **「HTML タグ」** を選ぶ
3. こういうタグが出ます：

```html
<meta name="p:domain_verify" content="a1b2c3d4e5f6..."/>
```

4. `content="..."` の**中身だけ**をコピーして、`config/config.json` に貼る：

```json
"gaMeasurementId": "",
"pinterestVerifyCode": "a1b2c3d4e5f6..."
```

5. GitHub の **Actions** タブ →「**管理画面からの再公開**」（`rebuild-site`）を実行して反映する
   （ローカルにコード環境があれば `npm run autopilot site:build && git add -A && git commit && git push` でも可）
6. GitHub の Actions が緑になるのを待つ（2〜3分）
7. Pinterest の画面に戻り、確認 / Verify を実行する

> サイトがまだ公開されていないと失敗します。その場合は先に「5. 起動する」まで進めてから戻ってきてください。
> **これが完了していないと、却下メールの "Its URL is registered with an entity in your company"
> が何度再申請しても消えません。** サイトの内容を直しても、この所有権確認とは無関係です。

## 3-3. API アプリを作って Trial access を申請する（15分＋待ち）

> **申請前に必ず済ませておくこと。** 却下の主因はほぼ100%ここです。
> - 2-5 の独自ドメインの設定が終わっていて、`https://worked-for-us.com/` が
>   実際にブラウザで開けること
> - `https://worked-for-us.com/privacy/` が実際に開けて、"Privacy Policy" と
>   はっきり書かれていること（このリポジトリのコードは既に対応済み）
> - Actions タブから **rebuild-site** を実行して、上記が最新の内容で
>   公開されていること

1. https://developers.pinterest.com/apps/ を開く（3-1 のビジネスアカウントでログイン）
2. 「**Create app**」または「**アプリをリンク / Connect app**」（表記はどちらも見られます）
3. 基本情報を入力：

   | 項目 | 入力する値 |
   | --- | --- |
   | アプリ名 | `Worked For Us`（**「Pinterest」という単語は使えません**） |
   | 会社名 | `Worked For Us` |
   | 会社のウェブサイト / アプリのリンク | `https://worked-for-us.com` |
   | プライバシーポリシーへのリンク | `https://worked-for-us.com/privacy/` |
   | アプリの目的（英語） | 下記の文案 |

   ```
   Worked For Us is an independent editorial website publishing hands-on comparison
   articles about business software (SaaS) for small teams. This app will publish
   Pins that link back to our own articles on our website, and will read Pin
   analytics (impressions, outbound clicks, saves) to measure performance.
   ```

4. 追加の質問（複数ページに分かれて出ることがあります）：

   | 質問 | 選ぶもの |
   | --- | --- |
   | デベロッパーの目的 | **個人用APIアクセス（単一、個人使用）** |
   | 使用目的（複数選択） | **ピン作成・予約投稿** と **レポート** の2つだけ |
   | オーディエンス（複数選択） | **ビジネス** |
   | ピンデータやボードデータを読み取る | **「はい、自分用です」**（初期値は「いいえ」なので必ず変更する） |

5. 送信して **Trial access の審査結果を待ちます**
   → コミュニティの報告では**数日〜2週間程度**かかることがあります
   → **App secret と Redirect URI は、Trial が承認されるまで設定できません**

### もし却下メールが来たら

Pinterest からのメールに、だいたい次のような理由が書かれます：

- ウェブサイトが「オンラインでアクセスできる」「SNSではない」「会社名義で登録されたドメインである」こと
- プライバシーポリシーが「公開されている」「完全に表示される」「会社と明確に紐づくドメインにある」「プライバシーポリシーだと明確に分かる」こと
- アプリの説明が完全で正確であること

**`xxx.github.io` のような無料サブドメインは「会社名義で登録されたドメイン」と見なされず、これだけで却下されます。** 独自ドメイン（2-5）を先に済ませてください。

却下されたアプリは、多くの場合その場で編集・再申請ができません（フィールドがロックされ、再申請ボタンが消えるという報告が複数あります）。その場合は**新しいアプリを作り直してください**。アプリ名が重複してエラーになったら `Worked For Us App` のように少し変えれば通ります。

## 3-4. 認可して Refresh Token を取る（10分・Trial 承認後）

1. App 設定で **App ID** と **App secret** を控える
2. 登録すべき Redirect URI をコマンドに出させます：

```bash
PINTEREST_APP_ID=あなたのAppID PINTEREST_APP_SECRET=あなたのSecret npm run autopilot pinterest:auth
```

- ローカル PC： `http://localhost:8788/callback`
- Codespaces： `https://xxxxx-8788.app.github.dev/callback`（自動検出されます。
  VS Code 下部の **PORTS** タブで `8788` を **Public** にしてください）

3. その URL を App の **Redirect URIs** に**一字一句そのまま**登録
4. コマンドを再実行 → 表示された URL をブラウザで開く → **Allow**
5. ターミナルに出た `PINTEREST_REFRESH_TOKEN=...` をコピー
6. GitHub Secrets に3つ登録：

| Name | Value |
| --- | --- |
| `PINTEREST_APP_ID` | App ID |
| `PINTEREST_APP_SECRET` | App secret |
| `PINTEREST_REFRESH_TOKEN` | 上で出たトークン |

> トークンの更新は以後すべて自動です。この作業は一生に1回だけです。

### 3-4b. ターミナルが使えない場合（iPadなど）

上の手順はターミナルの利用が前提ですが、代わりにブラウザだけで完結する方法もあります。

1. 事前に GitHub Secrets へ `PINTEREST_APP_ID` と `PINTEREST_APP_SECRET` を登録しておく
2. **Secrets: Read and write** 権限だけを持つ Fine-grained PAT を1つ作り
   （`https://github.com/settings/personal-access-tokens/new`、対象はこのリポジトリのみ）、
   `GH_PAT_FOR_SECRETS` という名前で GitHub Secrets に登録する
   （この PAT はステップ4の書き込みにしか使わないので、終わったら失効させて構いません）
3. サイトの `https://<あなたのドメイン>/pinterest-connect/` を開き、App ID を入力して
   「Pinterestに接続する」→ Pinterest 側で **Allow**
4. `/pinterest-callback/` に戻ってくると認可コードが表示されるので、GitHub の
   **Actions** タブ →「**Pinterest 認可コードをトークンに交換**」→ **Run workflow**
   にそのコードを貼って実行する

このワークフローが `PINTEREST_REFRESH_TOKEN` を直接 GitHub Secrets に書き込みます
（このリポジトリは公開リポジトリで Actions のログも誰でも見られるため、トークンをログには
一切出しません）。タップと貼り付けだけで完結し、ターミナルは使いません。

## 3-5. Standard access を申請する（重要）

**ここを飛ばすと、自動投稿しても意味がありません。**

Trial access のまま API で作ったピンとボードは、**Sandbox 扱いになり、
作成したあなた本人にしか見えません。** 他の人の検索結果にもフィードにも出ないので、
流入源になりません。

公開されるピンを API で作るには **Standard access** が必要です。

- 前提：Trial access が承認済みであること
- 提出物：**あなたのアプリが OAuth フローを通す様子を画面録画した動画**
  （「自分ひとりでしか使わない」場合でも動画の提出が必要です）
- 費用：Trial も Standard も**無料**

申請は developers.pinterest.com のアプリ設定画面から行います。

## 3-6. 審査待ちの間の回し方（ここが本題）

**待っている間もパイプラインは止めません。** 記事もピンも作られ続けます。
できたピンを書き出して、手動か外部ツールで投稿してください。

```bash
npm run autopilot pins:export --days 14
```

`export/pins-YYYY-MM-DD/` に、こう出ます：

```
pins.csv      1行=1ピン。投稿予定の早い順。タイトル・説明・alt・リンク先つき
images/       同じ順番の連番画像（001_..., 002_...）
はじめに.txt  手順
```

**手で投稿する場合**：1枚あたり約40秒。Pinterest で「作成」→ 画像をドラッグ →
CSV の同じ行からタイトル・説明・リンクを貼るだけ。1日6枚で **4分/日**です。

**外部の予約ツールを使う場合**：Tailwind / Buffer / Later などは既に Standard access を
持っているので、そこに流し込めば予約投稿できます。

投稿し終えたら、二重投稿を防ぐために記録します：

```bash
npm run autopilot pins:export --mark
```

Standard access が下りたら、Secrets を入れるだけで**自動投稿に切り替わります。**
それまでに作った記事とピンは全部そのまま使えます。

---

# 4. アフィリエイトネットワークの API（20分・任意）

**未設定でも記事・ピン・投稿・サイト公開は全部動きます。**
足りなくなるのは「売上と継続月数の自動集計」だけです。**後回しで構いません。**

案件が1件も承認されていない今の段階では、登録しても取れるデータがありません。
**Phase 1 で最初の承認が出てから戻ってきてください。**

| ネットワーク | 取得場所 | Secrets 名 |
| --- | --- | --- |
| Impact | 管理画面 → Settings → API | `IMPACT_ACCOUNT_SID` / `IMPACT_AUTH_TOKEN` |
| ShareASale | Tools → API | `SHAREASALE_AFFILIATE_ID` / `SHAREASALE_API_TOKEN` / `SHAREASALE_API_SECRET` |
| PartnerStack | Settings → Integrations → API keys | `PARTNERSTACK_API_KEY` / `PARTNERSTACK_API_SECRET` |

---

# 5. 起動する（5分）

ここまで来たら、最初の記事を作って公開します。

```bash
npm run autopilot doctor        # 自動化率が 80% 以上になっているはず
npm run autopilot bootstrap 3   # 案件リサーチ + 記事3本 + ピン30枚（10〜20分・$3〜9）
git add -A
git commit -m "初回セットアップ"
git push
```

push した瞬間に：

- GitHub Actions がサイトを **GitHub Pages に公開**します
- 3つの自動スケジュールが有効になります

| ワークフロー | いつ | やること |
| --- | --- | --- |
| `autopilot-daily` | 毎日 12:00 (JST) | 記事1本 → ピン10枚 → 投稿 → サイト再生成 |
| `autopilot-pins` | 3時間おき | 予約時刻を過ぎたピンを投稿 |
| `autopilot-weekly` | 毎週月曜 13:00 (JST) | 数値取得 → 勝ち型検出 → 横展開 → レポート |

### 確認すること

1. GitHub の **Actions** タブ → 全部緑になっているか
2. 2-3 の URL をブラウザで開く → 記事3本のサイトが見えるか
3. Pinterest のプロフィール → ボードとピンが増え始めているか（数時間以内）

**Actions が赤い場合**：そのジョブをクリックするとログが出ます。
だいたい Secrets の名前の打ち間違いか、2-2 の権限設定漏れです。

---

# Phase 0 完了チェックリスト

```bash
npm run autopilot doctor
```

- [ ] `✓ Anthropic API キー: 疎通OK`
- [ ] `✓ サイト URL`（example. が消えている）
- [ ] `✓ Pinterest のサイト所有権確認`
- [ ] `✓ Pinterest API`（Standard access が下りるまでは未設定のままで構いません。
      その間は `npm run autopilot pins:export` で回してください）
- [ ] `✓ Chromium`
- [ ] GitHub Actions が全部緑
- [ ] 公開 URL でサイトが見える

ここまで終われば、**あなたの毎日の作業はゼロになります。**

次は Phase 1（案件への応募）です → 生成される `TODO-HUMAN.md` を開いてください。

```bash
npm run autopilot research   # 案件を探す
npm run autopilot tasks      # 応募文を下書きする
```
