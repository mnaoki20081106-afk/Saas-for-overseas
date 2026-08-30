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

# 2. GitHub Pages を有効にする（5分・無料）

記事を公開する場所です。独自ドメインは不要です。

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

### 2-5. サイトの名前を自分のものにする

`config/config.json` の先頭を編集します。**読者は英語圏の人なので英語で**書いてください。

```json
"site": {
  "name": "StackPickr",                                      ← サイト名
  "tagline": "Honest, hands-on SaaS comparisons for small teams",  ← 一行説明
  "description": "Independent, experience-based comparisons of ...", ← 説明文
```

思いつかなければ既定のままで構いません。あとから変えても記事は壊れません。

### 2-6. 確認

```bash
npm run autopilot site:build
```

エラーなく `public/` が出来ればOK。この時点ではまだ公開されていません（5 で公開します）。

---

# 3. Pinterest（30分・ここが一番手間）

## 3-1. ビジネスアカウント（5分）

1. https://www.pinterest.com/business/create/ を開く
2. メールアドレスで登録（**個人アカウントとは別に作ってください**）
3. **言語 = English (US)、国 = United States** にする
   → 英語圏の人に配信するためです。日本語設定だと日本人にしか出ません
4. プロフィールの Website 欄に 2-3 の URL を入れる

## 3-2. サイトの所有権を確認（10分）

これをやると、あなたのサイトへのピンが優先的に扱われます。

1. Pinterest 右上のアイコン → **Settings** → **Claimed accounts**
2. **Websites** の **Claim** ボタン → 自分のサイト URL を入力
3. 認証方法で **Add HTML tag** を選ぶ
4. こういうタグが表示されます：

```html
<meta name="p:domain_verify" content="a1b2c3d4e5f6...">
```

5. `content="..."` の**中身だけ**（`a1b2c3d4e5f6...` の部分）をコピー
6. `config/config.json` の `site.pinterestVerifyCode` に貼る：

```json
"gaMeasurementId": "",
"pinterestVerifyCode": "a1b2c3d4e5f6..."
```

7. 反映する：

```bash
npm run autopilot site:build
git add -A && git commit -m "Pinterest のサイト所有権確認コードを追加" && git push
```

8. GitHub の **Actions** タブでデプロイが緑になるのを待つ（2〜3分）
9. Pinterest の画面に戻って **Verify** を押す

> ここは「サイトがまだ公開されていない」と失敗します。5 を先に済ませてから戻ってきても構いません。

## 3-3. API アプリを作る（10分）

1. https://developers.pinterest.com/apps/ を開く（Pinterest アカウントでログイン）
2. **Create app** → アプリ名（`autopilot` など）と用途を入力
3. 作成後、アプリの設定画面で **App ID** と **App secret key** を控える

## 3-4. Redirect URI を登録する（5分）

先にコマンドを走らせて、登録すべき URL を出させます。

```bash
PINTEREST_APP_ID=あなたのAppID PINTEREST_APP_SECRET=あなたのSecret npm run autopilot pinterest:auth
```

すると**登録すべき Redirect URI がそのまま画面に出ます**。

- ローカル PC の場合： `http://localhost:8788/callback`
- Codespaces の場合： `https://xxxxx-8788.app.github.dev/callback`（自動検出されます）

1. その URL を Pinterest の App 設定の **Redirect URIs** に**一字一句そのまま**貼って保存
2. Codespaces の場合は、VS Code 下部の **PORTS** タブで `8788` 行を右クリック →
   **Port Visibility** → **Public** にする
3. さきほどのコマンドをもう一度実行
4. 表示された長い URL をブラウザで開く → Pinterest の承認画面 → **Allow**
5. ターミナルに `PINTEREST_REFRESH_TOKEN=...` が出ます。コピー

## 3-5. GitHub に登録（3分）

**Settings** → **Secrets and variables** → **Actions** → **New repository secret** を3回：

| Name | Value |
| --- | --- |
| `PINTEREST_APP_ID` | 3-3 の App ID |
| `PINTEREST_APP_SECRET` | 3-3 の App secret |
| `PINTEREST_REFRESH_TOKEN` | 3-4 で出たトークン |

> **この作業は一生に1回です。** アクセストークンは短命ですが、
> リフレッシュトークンから毎回自動発行する作りにしてあります。

**❌ よくある失敗**

| 症状 | 原因 |
| --- | --- |
| `redirect_uri mismatch` | 貼った URL が1文字違う。末尾の `/callback` とスキーム（http/https）を確認 |
| ブラウザが「接続できません」 | Codespaces で PORTS を Public にしていない |
| `401 Unauthorized` が後で出る | App の権限（スコープ）不足。App を作り直して再認可 |

### Pinterest の API 審査について

作った App は最初「トライアル」状態ですが、**自分のアカウントには投稿できます**。
本番申請が必要なのは他人のアカウントを扱う場合だけなので、この用途では
トライアルのまま動きます。

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
- [ ] `✓ Pinterest API`
- [ ] `✓ Pinterest のサイト所有権確認`
- [ ] `✓ Chromium`
- [ ] GitHub Actions が全部緑
- [ ] 公開 URL でサイトが見える

ここまで終われば、**あなたの毎日の作業はゼロになります。**

次は Phase 1（案件への応募）です → 生成される `TODO-HUMAN.md` を開いてください。

```bash
npm run autopilot research   # 案件を探す
npm run autopilot tasks      # 応募文を下書きする
```
