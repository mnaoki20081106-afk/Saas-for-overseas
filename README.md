# 海外SaaSアフィリエイト自動化パイプライン

いただいた3つのテキストに書かれている流れを、**そのまま自動で回るプログラム**にしたものです。

```
案件リサーチ → ペイン設計 → 英語比較記事(2,500語) → SEO最適化
   → Pinterestピン10枚(画像込み) → 予約投稿 → 数値計測
   → 勝ち型の検出 → 別カテゴリへ横展開 → 週次レポート
```

この輪が、GitHub Actions のスケジュールで**毎日ひとりでに回ります**。
あなたが毎日やることはゼロです。

---

## 📐 AI会社への再設計（2026-08-31・設計フェーズ完了 / 実装未着手）

このリポジトリを「AI社員が役割分担して自律運営する会社」へ作り変える設計を、実装前にまとめました。
**まずは [DESIGN_REVIEW.md](DESIGN_REVIEW.md) の冒頭を読んでください。**
いま何が詰まっているか（＝収益がゼロである本当の理由）を正直に書いています。

| 文書 | 内容 |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 現状の調査結果と、新しい全体設計。**⚠️ 緊急対応が3件あります（§1.6）** |
| [AGENTS.md](AGENTS.md) | AI社員8人（MVPは5人）の職務規定・入出力・上限 |
| [DATA_MODEL.md](DATA_MODEL.md) | 会社の記憶（25のデータ構造） |
| [MIGRATION.md](MIGRATION.md) | 既存資産の分類（**削除するファイルはゼロ**）と移行手順 |
| [COSTS.md](COSTS.md) | Pro だけで可能 / 無料インフラ / 有料APIが要る部分の分類表 |
| [SECURITY.md](SECURITY.md) | 秘密情報・暴走対策・キルスイッチ・復旧手順 |
| [ROADMAP.md](ROADMAP.md) | MVP から完全自律までの5段階 |
| [DESIGN_REVIEW.md](DESIGN_REVIEW.md) | **この設計への自己批判と、それによる14箇所の修正** |

**結論：Claude API への追加課金は不要になります。** 判断は Claude Code の Routines（Pro に含まれる）、
実行は GitHub Actions（public リポジトリなので無料・無制限）、記憶は git 上の JSON で完結します。

---

## 1. まず「どこまで自動か」をはっきりさせます

SaaS もアフィリエイトも初めてとのことなので、最初にここだけ正直に書きます。

### 完全に自動（あなたは何もしません）

| 工程 | 実際にやっていること |
| --- | --- |
| 案件リサーチ | Claude が Web 検索して継続報酬型 SaaS を調査。月額$30以上・平均継続10ヶ月以上・日本語競合が少ない、の3条件で自動フィルタし、スコア順に並べる |
| 応募文の作成 | 各案件の応募フォームの回答を、審査に通る形で全部下書き |
| ペイン設計・記事構成 | 読者の悩み・検索意図・見出し構成・FAQ を設計 |
| 英語記事の執筆 | 2,400〜3,200語のネイティブトーン比較記事。西暦や「最新」など**古びる表現を機械的に禁止**（ストック型記事のため） |
| 品質ゲート | 語数・禁止表現・H1の数・比較表の有無・内部リンク数・リンク配置を自動検査。落ちたら**自動で書き直し** |
| SEO | メタタグ、canonical、JSON-LD（Article / FAQPage / BreadcrumbList）、sitemap.xml、RSS、内部リンクを自動生成 |
| ピン画像10枚 | 5種類のデザインテンプレート × 8配色で、1000×1500 の PNG をプログラムで描画。文字量に応じて級数も自動調整 |
| ピン文案 | 10枚それぞれ違う切り口（価格の壁／隠れた上限／乗り換えコスト／買うべきでない人…）でタイトルと説明文 |
| 予約投稿 | 1日6枚まで、90分以上あけて、米国の夕方帯に自動投稿（Pinterest API の Standard access が必要。審査待ちの間は `pins:export` で手動/外部ツール投稿に切り替えられます） |
| 数値計測 | ピン→記事のクリック率／申込数／平均継続月数を API から自動取得 |
| 勝ち型の横展開 | **クリック率3%以上のピンを勝ち型と判定し、その"型"を別カテゴリの記事へ自動で10枚展開** |
| サイト公開 | GitHub Pages に静的サイトを自動デプロイ（無料） |
| リンク差し替え | 承認されたアフィリエイトリンクを1箇所に貼るだけで、全記事のリンクが自動で入れ替わる |
| 週次レポート | 何が効いて何が効いていないかを `REPORT.md` に自動出力 |
| 実績の次の階段 | 月額報酬がしきい値に届いたら、日本語の発信文・高単価Introducer提案メール・コンサル構成案を自動生成 |

### 自動にできないもの（合計 約60〜90分・最初の1回だけ）

技術的な限界ではなく、**法律と相手企業の審査**が理由です。

1. **API キーの発行**（Anthropic / Pinterest）— 本人のアカウント操作でしか発行できません
2. **各SaaSのアフィリエイト審査**— 相手企業の担当者が人間です
3. **本人確認・税務情報の入力**— 代理入力は規約違反になります

ただしこの3つも、**やることリストと回答文は全部このリポジトリが用意します。**
`TODO-HUMAN.md` を開いて、書いてある通りにコピペするだけです。

```bash
npm run autopilot doctor   # いま何が動いていて何が止まっているかを表示
```

---

## 2. 今すぐ動かす（APIキー不要・無料）

```bash
npm install
DRY_RUN=1 npm run autopilot bootstrap 2
npm run serve   # → http://localhost:4173
```

サンプルデータで、記事2本・ピン20枚・サイト一式が生成されます。
**まずこれを見て、出来上がるものを確認してください。**

## 3. 本番で動かす

```bash
cp .env.example .env      # ANTHROPIC_API_KEY を入れる
npm run autopilot doctor  # 足りないものを表示
npm run autopilot bootstrap 3
```

あとは `TODO-HUMAN.md` の指示に従うだけ。詳しい手順は **[docs/SETUP.md](docs/SETUP.md)**（ゼロから40分）。

---

## 4. 自動運転のスケジュール

GitHub Actions に登録済みです。リポジトリを push した時点で有効になります。

| ワークフロー | 実行タイミング | やること |
| --- | --- | --- |
| `autopilot-daily` | 毎日 12:00 (JST) | 案件補充 → 記事1本 → ピン10枚 → 投稿 → サイト再生成 |
| `autopilot-pins` | 3時間おき | 予約時刻を過ぎたピンを投稿 |
| `autopilot-weekly` | 毎週月曜 13:00 (JST) | 数値取得 → 勝ち型検出 → 横展開 → レポート |

30日で **英語記事 約30本 + ピン 約300枚** が積み上がる計算です
（テキストの「30日で記事8本+ピン80枚」より速いので、`config/config.json` の
`content.articlesPerRun` で落とすこともできます）。

---

## 5. コマンド一覧

```bash
npm run autopilot doctor        # 環境チェック
npm run autopilot provider:check # 接続先APIが必要な機能を持つか実測
npm run autopilot bootstrap 3   # 初回セットアップ
npm run autopilot daily         # 毎日の処理を手動実行
npm run autopilot weekly        # 週次の処理を手動実行
npm run autopilot research      # 案件リサーチだけ
npm run autopilot article       # 記事1本だけ
npm run autopilot pins          # ピン10枚だけ
npm run autopilot pins:publish  # 予約分を投稿
npm run autopilot pins:export   # 手動投稿用に CSV と画像を書き出す
npm run autopilot analytics     # 数値取得
npm run autopilot optimize      # 勝ち型の横展開
npm run autopilot report        # レポート更新
npm run autopilot status        # 現状サマリ
npm run autopilot link:set <slug> <url>   # 承認されたリンクを登録
npm run serve                   # 生成サイトをローカル確認
```

---

## 6. 設定ファイル

| ファイル | 中身 |
| --- | --- |
| `config/config.json` | サイト名・URL・扱うカテゴリ・記事の語数・ピンの枚数と投稿ペース・勝ち型のしきい値・**工程ごとに使うモデル（`models.profile`）** |
| `config/scoring.json` | 案件のスコアリング重みと足切り条件 |
| `config/affiliate-links.json` | 承認済みアフィリエイトリンク（ここに貼るだけで全記事に反映） |
| `.env` | APIキー類 |

---

## 7. 生成物の置き場所

```
content/articles/*.md   英語記事（人間が読める形）
assets/pins/*.png       ピン画像（1000×1500）
public/                 公開用の静的サイト
data/programs.json      案件とスコア
data/pins.json          ピンの文案・予約時刻・実績
data/metrics.json       計測データの履歴
TODO-HUMAN.md           あなたがやることリスト
REPORT.md               週次レポート
```

---

## 8. 収益の見込みについて（ここは正直に）

元のテキストにある「月70万」「月50万」は、**発信者の主張であって、
このプログラムが保証する数字ではありません。**

このプログラムが実際にコントロールできるのは次の4つです。

- 公開できる記事とピンの**量**（自動なので事実上の上限なし）
- 記事とピンの**質**（品質ゲートと勝ち型の横展開で機械的に改善）
- 案件選定の**基準**（継続報酬・$30以上・継続10ヶ月以上を機械的に強制）
- 何が効いたかの**計測**（推測ではなく API の実数）

コントロールできないのは、Pinterest のアルゴリズム、**Pinterest API の審査**、
アフィリエイト審査の可否、競合の動き、そして**成果が出るまでの時間**です。

とくに **Pinterest API は Standard access の審査を通らないと、API で作ったピンが
自分にしか見えません**（Trial access では Sandbox 扱いになります）。
審査は数日〜数週間かかることがあるので、その間は `npm run autopilot pins:export` で
書き出して手動投稿するか、Tailwind などの外部予約ツールに流してください。
記事・ピン・サイトの生成は、この審査とは無関係に動き続けます。

Pinterest は投稿してから流入が伸び始めるまで **2〜3ヶ月**かかるのが普通です。
最初の1〜2ヶ月、数字がほぼゼロなのは異常ではありません。ここで止めないことだけが、
このやり方で唯一むずかしい部分です。だからこそ「毎日の作業をゼロにする」ことに
このリポジトリの全力を注いでいます。

---

詳細ドキュメント: [セットアップ](docs/SETUP.md) ／ [自動化の境界](docs/AUTOMATION.md) ／ [運用](docs/RUNBOOK.md) ／ [コスト](docs/COSTS.md)

---

## 付録: ピンのデザイン

`assets/preview/` に5テンプレートのサンプルが入っています。
自分で作り直したいときは:

```bash
npx tsx scripts/pin-preview.ts
```

配色（8種）とレイアウトは `src/pins/templates.ts` で変更できます。
