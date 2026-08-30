/**
 * モデルごとに使える機能が違うので、リクエストの形をモデルから決める。
 *
 * - adaptive thinking と output_config.effort は Opus 5 / Sonnet 5 / 4.6〜4.8 系のみ。
 *   Haiku 4.5 に effort を送ると 400 になる。
 * - 構造化出力（output_config.format）はどのモデルでも使える。
 *
 * ここを1箇所にまとめておくと、工程ごとに違うモデルを割り当てても壊れない。
 */

export type Stage = "research" | "brief" | "article" | "pins" | "growth" | "repair";

export interface ModelShape {
  /** thinking: {type:"adaptive"} を送ってよいか */
  adaptiveThinking: boolean;
  /** output_config.effort を送ってよいか */
  effort: boolean;
}

export function shapeFor(model: string): ModelShape {
  const m = model.toLowerCase();
  const modern =
    m.startsWith("claude-opus-5") ||
    m.startsWith("claude-sonnet-5") ||
    m.startsWith("claude-fable-5") ||
    m.startsWith("claude-mythos-5") ||
    m.startsWith("claude-opus-4-8") ||
    m.startsWith("claude-opus-4-7") ||
    m.startsWith("claude-opus-4-6") ||
    m.startsWith("claude-sonnet-4-6");
  return { adaptiveThinking: modern, effort: modern };
}

/** 1M トークンあたりの価格（USD）。コスト見積もりの表示にだけ使う。 */
export const PRICING: Record<string, { input: number; output: number }> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export function priceFor(model: string): { input: number; output: number } | null {
  return PRICING[model] ?? null;
}

export function estimateUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(model);
  if (!p) return 0;
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}
