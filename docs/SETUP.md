# セットアップ手順（ゼロから・所要 約40分）

SaaS もアフィリエイトも初めてという前提で書きます。専門用語は都度説明します。

---

## 0. 用語だけ先に（1分）

| 用語 | 意味 |
| --- | --- |
| SaaS | 月額課金のソフト。Notion や Canva のようなもの |
| アフィリエイト | 紹介して人が契約したら報酬が入る仕組み |
| 継続報酬 | 紹介した人が使い続ける限り、毎月報酬が入り続ける方式。**今回狙うのはこれだけ** |
| ASP / ネットワーク | 案件をまとめている仲介会社。Impact / ShareASale / CJ / PartnerStack など |
| ピン | Pinterest に投稿する縦長の画像 |
| LTV | 1件の紹介が解約されるまでに生む報酬の総額（月額 × 継続月数） |

---

## 1. まず動かして、出来上がるものを見る（5分・無料）

```bash
npm install
DRY_RUN=1 npm run autopilot bootstrap 2
npm run serve
```

ブラウザで http://localhost:4173 を開いてください。
サンプルの英語記事とサイトが出来ています。`assets/pins/` にピン画像も入っています。

`DRY_RUN=1` は「Claude を呼ばずにサンプルで動く」モードです。お金はかかりません。

---

## 2. Anthropic の APIキー（10分・ここだけ有料）

記事・ピン文案・案件リサーチを書くのに使います。

1. https://console.anthropic.com/ に登録
2. **Billing** で $20 ほどクレジットを購入
   （記事1本 + ピン10枚で概ね $1〜3。月30本回しても $30〜90 程度）
3. **Settings → API keys → Create Key**。表示されたキーをコピー（再表示できません）
4. `cp .env.example .env` して `ANTHROPIC_API_KEY=sk-ant-...` を貼る

安く回したいときは `.env` に `CLAUDE_MODEL=claude-sonnet-5` を足すと単価が下がります。

確認:

```bash
npm run autopilot doctor
```

---

## 3. GitHub Pages を有効にする（5分・無料）

記事を公開する場所です。独自ドメインは無くても構いません。

1. このリポジトリの **Settings → Pages**
   → *Build and deployment* の **Source** を **GitHub Actions** に
2. **Settings → Actions → General**
   → *Workflow permissions* を **Read and write permissions** に
3. 公開URL（`https://<ユーザー名>.github.io/<リポジトリ名>`）を控える
4. **Settings → Secrets and variables → Actions → Variables** タブ
   → **New repository variable** → Name `SITE_BASE_URL` / Value に上のURL
5. `config/config.json` の `site.name` `site.tagline` `site.description` を
   自分のサイト名に変える（英語で。読者は海外の人です）

---

## 4. GitHub Secrets に APIキーを入れる（3分）

**Settings → Secrets and variables → Actions → New repository secret**

| Name | 値 |
| --- | --- |
| `ANTHROPIC_API_KEY` | 手順2のキー |

これだけで、**毎日の記事生成とサイト更新が自動で始まります。**

---

## 5. Pinterest（30分・ここが一番手間）

### 5-1. ビジネスアカウント

1. https://www.pinterest.com/business/create/ で無料のビジネスアカウントを作成
2. 言語と地域は **English / United States** にする（英語圏に配信するため）
3. **Settings → Claimed accounts → Claim website** で自分の GitHub Pages の URL を登録
   （HTMLタグ方式を選ぶと `<meta name="p:domain_verify" ...>` が出ます。
   これは `src/site/build.ts` の `layout()` の `<head>` に1行足せば入ります）

### 5-2. API アプリ

1. https://developers.pinterest.com/apps/ → **Create app**
2. **Redirect URI** に `http://localhost:8788/callback` を登録
3. **App ID** と **App secret** を控える
4. ローカルで実行:

```bash
PINTEREST_APP_ID=xxx PINTEREST_APP_SECRET=yyy npm run autopilot pinterest:auth
```

表示された URL をブラウザで開いて承認すると、ターミナルに
`PINTEREST_REFRESH_TOKEN=...` が出ます。

5. GitHub Secrets に3つ登録:
   `PINTEREST_APP_ID` / `PINTEREST_APP_SECRET` / `PINTEREST_REFRESH_TOKEN`

> アクセストークンは短命ですが、**リフレッシュトークンから毎回自動発行**するので、
> 以後この作業は不要です。

### Pinterest API の審査について

Pinterest のアプリは最初「トライアル」状態で、**自分のアカウントには投稿できます**。
本番アクセスの申請が必要になるのは、他人のアカウントを扱う場合だけなので、
このプログラムの用途では基本的にトライアルのままで動きます。

---

## 6. アフィリエイト案件に応募する（1件あたり約12分）

```bash
npm run autopilot research   # 案件を10件探してスコア順に並べる
npm run autopilot tasks      # 応募文を下書きして TODO-HUMAN.md を更新
```

`TODO-HUMAN.md` を開くと、案件ごとに

- どのネットワークで、どこから応募するか
- 「どうやって宣伝しますか?」への回答文（そのままコピペ可）
- 読者層の説明文、トラフィックの正直な答え方

が全部書いてあります。**フォームに貼るだけです。**

> コツ: 記事が1本でも公開されている状態で応募すると通りやすくなります。
> なので「記事を作る → 応募する」の順番にしてあります。

承認されたら:

```bash
npm run autopilot link:set <program-slug> "https://発行されたアフィリエイトリンク"
```

これで**全記事のリンクが自動的に差し替わります**。承認前の記事も、
承認された瞬間に有効なリンクへ切り替わるので、記事を作り直す必要はありません。

---

## 7. 売上の自動集計（任意・20分）

未設定でも記事とピンの自動化は完全に動きます。売上の集計だけが手動になります。

| ネットワーク | 取得場所 | 環境変数 |
| --- | --- | --- |
| Impact | 管理画面 → Settings → API | `IMPACT_ACCOUNT_SID` `IMPACT_AUTH_TOKEN` |
| ShareASale | Tools → API | `SHAREASALE_AFFILIATE_ID` `SHAREASALE_API_TOKEN` `SHAREASALE_API_SECRET` |
| PartnerStack | Settings → Integrations → API keys | `PARTNERSTACK_API_KEY` `PARTNERSTACK_API_SECRET` |

---

## 8. あとは放置

```bash
npm run autopilot bootstrap 3   # 記事3本とピン30枚を一気に作る
git add -A && git commit -m "初回セットアップ" && git push
```

push した時点で GitHub Actions のスケジュールが有効になります。

以降あなたがやることは、**週に1回 `REPORT.md` を見る**ことと、
**新しい案件が承認されたら `link:set` する**ことだけです。
