# Pinterest の集客とクリエイティブ（英世 ★必読）

## 前提

**Pinterest は「画像の付いた検索エンジン」です。**

- ピンのタイトルと説明文は検索対象になる
- **クリックは画像の文字で決まる**
- きれいなデザインより、具体的な問題を名指しした一行が勝つ

## あなたが作るもの / 作らないもの

| 作る | 作らない |
| --- | --- |
| テンプレートIDの指定 | **画像そのもの**（Chromium が描画・1枚 $0） |
| 画像に載せる文言（3行） | 配色（`co` が順番に割り当てる） |
| ピンのタイトルと説明文 | 投稿時刻（既存のスケジューラが決める） |
| 切り口の指定 | 投稿そのもの（オーナーのGO後、Actions が実行） |

## 10通りの切り口（1記事＝10枚＝10通り）

**同じ切り口が2つあると `co` が拒否します。** 言い換え違いは切り口を変えたことになりません。

| 切り口 | 例 |
| --- | --- |
| `price-objection` | "The $29 plan quietly caps you at 3 seats" |
| `hidden-limit` | "The export limit nobody mentions" |
| `switching-cost` | "Two weekends. That is what migrating cost us." |
| `concrete-number` | "We tracked 41 tickets across both tools" |
| `team-size` | "Under 10 people? Only one of these makes sense" |
| `specific-workflow` | "If you invoice in two currencies, read this first" |
| `unspoken` | "The setting we wish we had changed on day one" |
| `who-should-not-buy` | "Who should skip Acme entirely" |
| `free-plan-trap` | "The free plan works — until month three" |
| `head-to-head` | "Acme vs Zendesk"（`versus` テンプレート固定） |

**記事の中の具体的な事実を使ってください。**

```
悪い: "Boost your team's productivity"    ← 何も言っていない
良い: "The export limit nobody mentions"  ← 具体的な問題
良い: "We tracked 41 tickets across both" ← 具体的な数字
```

## 文字数

| 項目 | 上限 | 役割 |
| --- | --- | --- |
| `overlayMain` | 60字 | **ここでクリックが決まる。** 具体的な名詞か数字を入れる |
| `overlayTop` | 28字 | 小さな見出し（カテゴリ名など） |
| `overlayBottom` | 90字 | 補足の1行 |
| `title` | 95字 | 検索対象。**絵文字なし・年号なし** |
| `description` | 80〜400字 | 検索対象。末尾に小文字ハッシュタグ2〜4個 |
| `altText` | 120字 | 画像の説明 |

長い文字列は自動で縮小されて弱く見えます。**上限に近づけないでください。**

## テンプレート固有の決まり

| テンプレート | 決まり |
| --- | --- |
| `checklist` | `overlayBottom` を " \| " 区切りの3〜5項目にする |
| `versus` | `overlayMain` を「A vs B」の形にする（製品名2つ） |
| `bold-stat` | `overlayMain` に数字を入れると効きやすい |
| `split-card` / `editorial` | 自由 |

## 説明文

**開示文を書かないでください。** `co` が先頭に自動で付けます。
`affiliate` / `sponsored` / `ad` の語も使わないでください。二重になるとスパムに見えます。

```
悪い: "Affiliate links included. Acme is the best helpdesk!"
良い: "We ran both helpdesks side by side on a small team and wrote down what
       actually changed. This covers the entry plan limits, what the migration
       took, and who each tool is wrong for. #saas #smallbusiness #helpdesk"
```

**効果を約束しないでください。** 読者が何を知れるかを書きます。

## ★アカウント停止を避ける（この事業でいちばん怖い事故）

Pinterest のアカウントが止まると、集客手段が丸ごと消えます。

| 対策 | 中身 |
| --- | --- |
| 同じ文案を二度使わない | 既存ピンと同じ `overlayMain` は `co` が拒否する |
| 同じ画像を二度使わない | 画像のハッシュで検出される |
| 1日の投稿上限 | 6枚まで。新規アカウントは2枚/日から21日かけて増やす |
| 投稿間隔 | 90分以上あける |
| 1記事あたり | 30枚まで（集中させても自分のピン同士が食い合う） |

これらは `co` と Actions がコードで強制します。回避しようとしないでください。

## 提出

```bash
npm run co -- designer:context <記事のslug>   # 記事の中身・作れる枚数・実績を読む
npm run co -- designer:template > /tmp/pins.json
# 編集する
npm run co -- designer:submit /tmp/pins.json
npm run co -- pins:render                     # 画像を描画（$0）
```

ピンは `draft` として登録されます。**まだ予約も投稿もされません。**
検品と、オーナーの GO を通ってからです。

## データが貯まったあと

`designer:context` にテンプレート別の実測 CTR が出ます。

- 成績の良いテンプレートを厚めに使う
- 最下位のテンプレートは多くても1回
- ただし **全部を勝ちパターンに寄せない。** 新しい型を試す枠を2枚は残す

勝ちパターンだけを繰り返すと、それが効かなくなったときに次がありません。
