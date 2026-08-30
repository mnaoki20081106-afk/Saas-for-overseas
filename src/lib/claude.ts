import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { env, modelFor } from "./config";
import { estimateUsd, shapeFor, type Stage } from "./models";
import { log } from "./log";
import { sleep } from "./util";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ maxRetries: 4, timeout: 15 * 60 * 1000 });
  }
  return client;
}

export interface AskOptions {
  system: string;
  user: string;
  /** どの工程か。config/config.json の models.presets でモデルが決まる */
  stage?: Stage;
  /** low | medium | high | xhigh | max */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
  /** Anthropic のサーバーサイド Web 検索を使う(リサーチ用) */
  webSearch?: boolean | { maxUses?: number; allowedDomains?: string[] };
  label?: string;
}

function webSearchTool(opt: AskOptions["webSearch"]): Anthropic.ToolUnion[] {
  if (!opt) return [];
  const cfg = typeof opt === "object" ? opt : {};
  const tool: Anthropic.WebSearchTool20260209 = {
    type: "web_search_20260209",
    name: "web_search",
    max_uses: cfg.maxUses ?? 12,
  };
  if (cfg.allowedDomains?.length) tool.allowed_domains = cfg.allowedDomains;
  return [tool];
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * 長文(記事本文など)を生成する。128K 出力に耐えるようストリーミングを使う。
 */
export async function longform(opts: AskOptions): Promise<string> {
  const label = opts.label ?? "longform";
  if (env.dryRun) throw new DryRunSignal(label);
  log.info(`Claude(${modelFor(opts.stage ?? "article")}) ← ${label}`);

  const model = modelFor(opts.stage ?? "article");
  const shape = shapeFor(model);

  const stream = getClient().messages.stream({
    model,
    max_tokens: opts.maxTokens ?? 32000,
    ...(shape.adaptiveThinking ? { thinking: { type: "adaptive" as const } } : {}),
    ...(shape.effort ? { output_config: { effort: opts.effort ?? "high" } } : {}),
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.user }],
    ...(opts.webSearch ? { tools: webSearchTool(opts.webSearch) } : {}),
  });

  const message = await stream.finalMessage();
  guardStop(message, label);
  const out = textOf(message);
  log.ok(`${label}: ${out.length.toLocaleString()} chars — ${usageLine(model, message.usage)}`);
  return out;
}

/**
 * 構造化データ(JSON)を取り出す。Web 検索が必要な場合は
 * 「①検索して調査メモを書く → ②メモから JSON を抽出」の 2 段構えにする。
 * (server tool と output_config.format を同一リクエストで混ぜないため)
 */
export async function structured<T extends z.ZodType>(
  schema: T,
  opts: AskOptions,
): Promise<z.infer<T>> {
  const label = opts.label ?? "structured";
  if (env.dryRun) throw new DryRunSignal(label);
  log.info(`Claude(${modelFor(opts.stage ?? "brief")}) ← ${label} [structured]`);

  const model = modelFor(opts.stage ?? "brief");
  const shape = shapeFor(model);

  const response = await getClient().messages.parse({
    model,
    max_tokens: opts.maxTokens ?? 16000,
    ...(shape.adaptiveThinking ? { thinking: { type: "adaptive" as const } } : {}),
    output_config: {
      ...(shape.effort ? { effort: opts.effort ?? "high" } : {}),
      format: zodOutputFormat(schema),
    },
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.user }],
  });

  guardStop(response, label);
  if (!response.parsed_output) {
    throw new Error(`${label}: 構造化出力のパースに失敗しました`);
  }
  log.ok(`${label}: JSON 取得 — ${usageLine(model, response.usage)}`);
  return response.parsed_output as z.infer<T>;
}

/** Web 検索つきで調査メモを書かせる(プレーンテキスト) */
export async function research(opts: Omit<AskOptions, "webSearch"> & { maxUses?: number }): Promise<string> {
  return longform({
    ...opts,
    stage: opts.stage ?? "research",
    webSearch: { maxUses: opts.maxUses ?? 14 },
    effort: opts.effort ?? "high",
    maxTokens: opts.maxTokens ?? 24000,
    label: opts.label ?? "research",
  });
}

/** 使用トークンと概算コストを1行で出す（どの工程が高いのか分かるように） */
function usageLine(model: string, usage: { input_tokens: number; output_tokens: number }): string {
  const cost = estimateUsd(model, usage.input_tokens, usage.output_tokens);
  const money = cost > 0 ? ` ≈ $${cost.toFixed(3)}` : "";
  return `in ${usage.input_tokens.toLocaleString()} / out ${usage.output_tokens.toLocaleString()} tok${money}`;
}

function guardStop(message: Anthropic.Message, label: string): void {
  if (message.stop_reason === "refusal") {
    const detail = message.stop_details && "category" in message.stop_details
      ? String(message.stop_details.category)
      : "unknown";
    throw new Error(`${label}: モデルがリクエストを拒否しました (category=${detail})`);
  }
  if (message.stop_reason === "max_tokens") {
    log.warn(`${label}: max_tokens に到達しました。出力が途中で切れている可能性があります。`);
  }
}

/**
 * API キーが本当に通るかを確かめる。トークン数え上げは無料なので課金されない。
 * 「キーは設定したのに動かない」を doctor の時点で潰すため。
 */
export async function verifyKey(): Promise<{ ok: boolean; detail: string }> {
  if (!env.anthropicKey) return { ok: false, detail: "未設定" };
  try {
    await getClient().messages.countTokens({
      model: env.model,
      messages: [{ role: "user", content: "ping" }],
    });
    return { ok: true, detail: `疎通OK（モデル: ${env.model}）` };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, detail: "キーが無効です。console.anthropic.com で作り直してください" };
    }
    if (err instanceof Anthropic.NotFoundError) {
      return { ok: false, detail: `モデル ${env.model} が使えません。CLAUDE_MODEL を見直してください` };
    }
    if (err instanceof Anthropic.APIError) {
      return { ok: false, detail: `API エラー ${err.status}: ${err.message.slice(0, 120)}` };
    }
    return { ok: false, detail: `接続できません: ${(err as Error).message.slice(0, 120)}` };
  }
}

/** DRY_RUN のときに投げられ、呼び出し側がフィクスチャで代替する */
export class DryRunSignal extends Error {
  constructor(public label: string) {
    super(`DRY_RUN: ${label}`);
    this.name = "DryRunSignal";
  }
}

/**
 * DRY_RUN のときはフィクスチャを返し、通常時は fn() を実行する。
 * API キー無しでもパイプライン全体を最後まで通せるようにするためのラッパー。
 */
export async function withFixture<T>(fixture: () => T, fn: () => Promise<T>): Promise<T> {
  if (env.dryRun) {
    log.warn("DRY_RUN: Claude を呼ばずにサンプルデータを使用します");
    await sleep(50);
    return fixture();
  }
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DryRunSignal) return fixture();
    throw err;
  }
}
