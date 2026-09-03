import { articles } from "./store";
import type { Article } from "./types";

/**
 * 公開ゲート — 「この実行で作ったものを、外の世界に出してよいか」を1箇所で判定する。
 *
 * 背景: ANTHROPIC_API_KEY が未設定だと env.dryRun が true になり、記事もピンも
 * サンプル文（"This is placeholder prose generated in DRY_RUN mode"）で生成される。
 * それに気づかないまま autopilot-daily が毎日サイトを再公開していたため、
 * 本番ドメインにサンプル記事が並んでいた。
 *
 * サンプルが外に出ると取り返しがつかない:
 *   - Google からは自動生成の薄いコンテンツと見なされる
 *   - Pinterest からは中身のないリンク先と見なされる
 *   - アフィリエイトの審査担当者に見られたら、まず落ちる
 *
 * そこで「生成はしてよいが、公開はしない」を機械的に強制する。
 * 判定は必ずこの関数を通す。呼び出し側で env.dryRun を直接見ないこと。
 */
export interface PublishGate {
  /** 外部に出してよいか */
  ok: boolean;
  /** 人間向けの理由（日本語・1行） */
  reason: string;
  /** 解除するために何をすればよいか */
  howToFix: string[];
}

/**
 * この記事を外に出してよいか。**中身の出所だけで決めます。**
 *
 * 以前は「ANTHROPIC_API_KEY があるか」で代用していましたが、これは二重に間違いでした。
 *   ・キーがあれば、サンプル文でも公開してしまう
 *   ・キーが無ければ、AI社員が手で書いた本物も永久に公開できない
 * 判定するのは鍵の有無ではなく、**その記事が本物かどうか**です。
 */
export function isPublishableArticle(a: Article): boolean {
  if (a.status !== "published") return false;
  // 出所が分からない古い記事は出さない（安全側に倒す）。
  // co migrate で writtenBy を埋めるか、書き直してください。
  return a.writtenBy === "ai-employee" || a.writtenBy === "api";
}

export function publishGate(): PublishGate {
  const all = articles.all();
  const placeholders = all.filter(
    (a) => a.status === "published" && a.writtenBy === "dry-run-placeholder",
  );
  if (placeholders.length > 0) {
    return {
      ok: false,
      reason: `サンプル文の記事が ${placeholders.length} 本あります。1本でも残っている間は公開しません。`,
      howToFix: [
        "DRY_RUN（APIキー未設定）で生成されたサンプル記事が残っています。",
        `対象: ${placeholders.slice(0, 5).map((a) => a.slug).join(", ")}`,
        "管理画面の「投稿の確認」から取り下げるか、本物の記事に書き直してください。",
      ],
    };
  }

  const ready = all.filter(isPublishableArticle);
  if (ready.length === 0) {
    return {
      ok: false,
      reason: "公開できる記事がまだ1本もありません。",
      howToFix: [
        "CTO一葉が記事を書き、CQO梅子の検品を通すと、ここが開きます。",
        "  npm run co -- task:next --assignee ichiyo",
        "空のサイトを検索エンジンに登録させないため、それまでは閉じたままにします。",
      ],
    };
  }

  const unknown = all.filter((a) => a.status === "published" && !a.writtenBy).length;
  if (unknown > 0) {
    return {
      ok: false,
      reason: `出所の分からない記事が ${unknown} 本あります。安全のため公開しません。`,
      howToFix: [
        "この設計より前に作られた記事です。本物かサンプル文かを機械では判定できません。",
        "推測で公開すると、サンプル文を本番に出す事故に戻ります。",
        "管理画面の「投稿の確認」で本文を読み、取り下げるか書き直してください。",
      ],
    };
  }

  return { ok: true, reason: "", howToFix: [] };
}

/** 公開してよいときだけ true。ワークフローのステップ制御などで使う。 */
export function isPublishable(): boolean {
  return publishGate().ok;
}
