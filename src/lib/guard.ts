import { env } from "./config";

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

export function publishGate(): PublishGate {
  if (env.dryRun) {
    return {
      ok: false,
      reason: "DRY_RUN で動いているため、生成物はサンプル文です。公開しません。",
      howToFix: [
        "本物の文章を生成するには、次のどちらかを行ってください。",
        "  A) GitHub Secrets に ANTHROPIC_API_KEY を登録する（Claude API を使う。従来どおり）",
        "  B) AI会社化（Claude Code の Routines）へ移行する。→ ROADMAP.md の Phase 1",
        "DRY_RUN=1 を明示的に設定している場合は、それを外してください。",
      ],
    };
  }
  return { ok: true, reason: "", howToFix: [] };
}

/** 公開してよいときだけ true。ワークフローのステップ制御などで使う。 */
export function isPublishable(): boolean {
  return publishGate().ok;
}
