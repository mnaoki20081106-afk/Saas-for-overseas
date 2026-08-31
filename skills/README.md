# 業務ノウハウ（スキル）一覧

この会社が持っている know-how を、テーマごとにファイルにしたものです。
**自分の役職の欄にあるものだけを読んでください。** 全部読むと混乱します。

---

## 誰がどれを読むか

| スキル | 諭吉<br>(CEO) | サラ<br>(CMO) | ケン<br>(CTO) | 中身 |
| --- | :---: | :---: | :---: | --- |
| [business-model.md](business-model.md) | ★必読 | ★必読 | ★必読 | この事業がどう稼ぐのか。全員の共通前提 |
| [cold-start.md](cold-start.md) | ★必読 | ★必読 | ★必読 | データがない最初の3ヶ月の振る舞い |
| [risk-checklist.md](risk-checklist.md) | ★必読 | ★必読 | ★必読 | 提出前のセルフチェック（鉄のルール第4条） |
| [web-content-safety.md](web-content-safety.md) | 読む | ★必読 | 読む | 取得したWebページの扱い方 |
| [saas-research.md](saas-research.md) | 読む | ★必読 | — | 案件の調べ方・出典の取り方・足切り |
| [pinterest-growth.md](pinterest-growth.md) | 読む | ★必読 | — | ピンの設計・10の切り口・スパム回避 |
| [english-writing.md](english-writing.md) | 読む | — | ★必読 | 英語記事の書き方・禁止事項 |
| [quality-gate.md](quality-gate.md) | 読む | — | ★必読 | 品質ゲートと自己検品の手順 |
| [decision-making.md](decision-making.md) | ★必読 | — | — | 何を根拠に優先順位を決めるか |
| [owner-communication.md](owner-communication.md) | ★必読 | — | — | オーナーへの伝え方（A案/B案の作り方） |

★必読 = その役職の中核。読まずに仕事を始めてはいけない
読む = 必要になったら参照する
— = 読まなくてよい（担当外）

---

## 道具（`co` コマンド）の担当割り

**コマンドは「道具」、役職は「人」です。** 道具の名前は昔の役職名のままですが、
使う人は下の表のとおりです。

| コマンド | 使う人 | 何をする道具か |
| --- | --- | --- |
| `status` / `check` | 全員 | 会社の状態・データの検査 |
| `task:*` | **諭吉** | 仕事の割り当てと進行管理 |
| `approval:*` | **諭吉** | オーナーへの承認依頼と決裁 |
| `decision:*` | **諭吉** | 決めたことの記録 |
| `release:*` | **諭吉** | GO後の公開・ピン予約 |
| `error:*` | **諭吉** | 失敗の後始末 |
| `researcher:*` | **サラ** | 案件リサーチの提出 |
| `designer:*` | **サラ** | ピン文案の提出 |
| `pins:render` | **サラ** | ピン画像の描画（$0） |
| `writer:*` | **ケン** | 執筆と品質ゲート |
| `editor:*` | **ケン** | セルフ検品の提出 |
| `qa:check` | **ケン** | 事実とリンクの照合 |

全コマンド一覧: `npm run co -- help`

---

## この一覧の使い方

1. 仕事を始める前に、自分の ★必読 を読む
2. 実際の手順は `.claude/skills/<自分の名前>/SKILL.md` にある
   （このフォルダは「知識」、`.claude/skills/` は「手順」）
3. 迷ったら [../rules.md](../rules.md) に戻る

---

関連: [../rules.md](../rules.md) ／ [../organization/README.md](../organization/README.md)
