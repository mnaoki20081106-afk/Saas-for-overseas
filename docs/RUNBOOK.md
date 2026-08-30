# 運用ガイド

## 平常時にやること

**週に1回、`REPORT.md` を開く。それだけです。**

レポートには次が出ています。

- ピン→記事のクリック率（追うべき指標。表示数ではありません）
- 勝ち型と負け型の一覧
- テンプレート別の成績
- 案件別の成約数・月額報酬・実測の継続月数
- あなたがやること（あれば）

---

## よくある状況と対処

### 「数字がまったく動かない」（開始〜2ヶ月）

**正常です。** Pinterest は投稿から流入が立ち上がるまで 2〜3ヶ月かかります。
この期間にやることは何もありません。パイプラインを止めないでください。

判断してよいのは、**300表示以上を集めたピンが20枚以上たまってから**です。
それより早い段階の数字は分母が小さすぎて、意味のある差ではありません。

### 「勝ち型が1つも出ない」（300表示以上のピンが20枚を超えた後）

`config/config.json` の `niche.categories` を見直してください。
カテゴリが読者の課題とずれていると、どんなに良いピンでもクリックされません。

もしくは `optimizer.winnerCtrPct` を 3.0 → 2.0 に下げて、
相対的に良いものを拾って横展開させる手もあります。

### 「記事が needs_review ばかりになる」

```bash
grep -A2 "qualityIssues" data/articles.json | head -40
```

多いのは「語数不足」です。`config/config.json` の `content.wordsMin` を
2400 → 2000 に下げるか、`CLAUDE_MODEL` を opus に戻してください
（sonnet は指定語数を下回りやすい傾向があります）。

### 「ピンの投稿が失敗している」

```bash
npm run autopilot status         # failed の枚数を確認
npm run autopilot pins:requeue   # 再予約
```

401 が出ている場合はトークン切れです。`pinterest:auth` を実行し直してください。

### 「案件が承認された」

```bash
npm run autopilot link:set <program-slug> "https://発行されたリンク"
```

これで全記事に反映されます。`data/programs.json` の該当案件も自動で `approved` になります。

### 「案件が却下された」

```bash
npm run autopilot program:status <program-slug> rejected
```

以後その案件では記事が作られなくなります。次回のリサーチで別の案件が補充されます。

### 「投稿ペースを変えたい」

`config/config.json`:

```json
"pins": {
  "publishPerDay": 6,          // 1日の投稿上限
  "minMinutesBetweenPins": 90, // ピンの間隔
  "postingHoursUtc": [13,15,17,19,21,23]
}
```

変更後 `npm run autopilot pins:reschedule` で予約済みのピンを組み直せます。

### 「記事の本数を変えたい」

`config/config.json` の `content.articlesPerRun`（既定 1 = 毎日1本）。

---

## 手動でひと通り回す

```bash
npm run autopilot daily     # 記事1本 → ピン10枚 → 投稿 → サイト再生成
npm run autopilot weekly    # 計測 → 勝ち型の横展開 → レポート
```

## 中身を確認する

```bash
npm run autopilot status
npm run serve                          # 生成サイトをブラウザで
npx tsx scripts/pin-preview.ts         # ピンのデザインを5種類プレビュー
cat data/programs.json | head -60      # 案件とスコア
```

## 実績が出たあと（STEP4）

月額報酬が `config/config.json` の `growth.monthlyRevenueMilestonesUsd` の
いずれかに到達すると、`docs/growth/` に次が自動生成されます。

1. 日本のビジネス界隈向けの発信文（X / note 用）
2. 高単価 Introducer 提案メール（英語・SaaSベンダー宛）
3. 有料コンサルの構成案

**数字は `data/metrics.json` の実測値だけを使います。** 盛った数字は入りません。
手動で出したい場合は `npm run autopilot growth --force`。
