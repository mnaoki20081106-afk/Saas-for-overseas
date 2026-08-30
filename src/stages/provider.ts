import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { env, modelFor } from "../lib/config";
import { log } from "../lib/log";
import { shapeFor } from "../lib/models";

/**
 * 接続先の API が、このパイプラインに必要な機能を本当に持っているかを確かめる。
 *
 * 公式の Anthropic API でも、Bedrock / Vertex でも、第三者のプロキシでも、
 * ANTHROPIC_BASE_URL を向けて実行すれば同じ基準で判定できる。
 *
 * 「安い/無料」を謳うエンドポイントの多くは素の /v1/messages しか実装していない。
 * その場合どの工程が動かなくなるかを、推測ではなく実測で出す。
 */

interface Probe {
  key: string;
  name: string;
  required: boolean;
  /** これが無いと壊れる工程 */
  breaks: string[];
  run: (client: Anthropic, model: string) => Promise<string>;
}

const TINY = { max_tokens: 32 } as const;

const PROBES: Probe[] = [
  {
    key: "basic",
    name: "基本のメッセージ送受信",
    required: true,
    breaks: ["すべて"],
    async run(client, model) {
      const r = await client.messages.create({
        model, ...TINY,
        messages: [{ role: "user", content: "Reply with the single word: OK" }],
      });
      const text = r.content.find((b) => b.type === "text");
      return `応答あり（served model: ${r.model}）${text && text.type === "text" ? ` "${text.text.trim().slice(0, 20)}"` : ""}`;
    },
  },
  {
    key: "streaming",
    name: "ストリーミング",
    required: true,
    breaks: ["記事本文の執筆（長文出力でタイムアウトします）"],
    async run(client, model) {
      const stream = client.messages.stream({
        model, ...TINY,
        messages: [{ role: "user", content: "Count: 1 2 3" }],
      });
      const msg = await stream.finalMessage();
      return `${msg.usage.output_tokens} tok を受信`;
    },
  },
  {
    key: "thinking",
    name: "adaptive thinking + effort",
    required: false,
    breaks: ["記事の品質（思考なしで書くと比較記事の精度が落ちます）"],
    async run(client, model) {
      const shape = shapeFor(model);
      if (!shape.adaptiveThinking) return "このモデルは元々非対応（想定内）";
      const r = await client.messages.create({
        model, max_tokens: 64,
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        messages: [{ role: "user", content: "What is 17 * 23? Answer with the number only." }],
      });
      return `受理（stop: ${r.stop_reason}）`;
    },
  },
  {
    key: "structured",
    name: "構造化出力（output_config.format）",
    required: true,
    breaks: [
      "案件リサーチのJSON化", "記事の設計（見出し・FAQ）",
      "ピン10枚の文案", "応募文の下書き", "実績発信素材",
    ],
    async run(client, model) {
      const schema = z.object({ city: z.string(), country: z.string() });
      const r = await client.messages.parse({
        model, max_tokens: 256,
        output_config: { format: zodOutputFormat(schema) },
        messages: [{ role: "user", content: "Extract: The Eiffel Tower is in Paris, France." }],
      });
      if (!r.parsed_output) throw new Error("parsed_output が null（スキーマ通りに返ってこない）");
      return `JSON を取得: ${JSON.stringify(r.parsed_output)}`;
    },
  },
  {
    key: "websearch",
    name: "サーバーサイド Web 検索（web_search_20260209）",
    required: true,
    breaks: ["案件リサーチ（継続報酬・価格・競合の調査が丸ごとできなくなります）"],
    async run(client, model) {
      const r = await client.messages.create({
        model, max_tokens: 1024,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 1 }],
        messages: [{ role: "user", content: "Search the web and name one SaaS product that has a recurring affiliate program." }],
      });
      const used = r.content.some((b) => b.type === "server_tool_use" || b.type === "web_search_tool_result");
      return used ? "検索が実行されました" : "リクエストは通りましたが検索が実行されませんでした（要確認）";
    },
  },
  {
    key: "caching",
    name: "プロンプトキャッシュ（cache_control）",
    required: false,
    breaks: ["コスト（同じ system を繰り返すぶんが割高になります）"],
    async run(client, model) {
      const r = await client.messages.create({
        model, ...TINY,
        system: [{ type: "text", text: "You are a terse assistant.", cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: "Say OK" }],
      });
      const u = r.usage as { cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };
      const reported = u.cache_creation_input_tokens !== undefined || u.cache_read_input_tokens !== undefined;
      return reported ? "受理され、usage にキャッシュ項目あり" : "受理されましたが usage にキャッシュ項目がありません";
    },
  },
  {
    key: "counttokens",
    name: "トークン数え上げ（count_tokens）",
    required: false,
    breaks: ["doctor の疎通確認（動作には影響しません）"],
    async run(client, model) {
      const r = await client.messages.countTokens({
        model, messages: [{ role: "user", content: "ping" }],
      });
      return `${r.input_tokens} tok`;
    },
  },
];

export interface ProviderCheckResult {
  endpoint: string;
  model: string;
  servedModel: string | null;
  passed: string[];
  failed: { key: string; name: string; reason: string; required: boolean; breaks: string[] }[];
  usable: boolean;
}

export async function checkProvider(modelOverride?: string): Promise<ProviderCheckResult> {
  const model = modelOverride ?? modelFor("article");
  const endpoint = env.baseUrl ?? "https://api.anthropic.com（公式）";

  log.step("接続先の API がこのパイプラインに耐えるかを実測する");
  log.info(`エンドポイント : ${endpoint}`);
  log.info(`テストするモデル: ${model}`);
  if (!env.anthropicKey) {
    log.error("APIキーが設定されていません。ANTHROPIC_API_KEY か ANTHROPIC_AUTH_TOKEN を設定してください。");
    return { endpoint, model, servedModel: null, passed: [], failed: [], usable: false };
  }
  console.log("");

  const client = new Anthropic({
    maxRetries: 1,
    timeout: 120_000,
    ...(env.baseUrl ? { baseURL: env.baseUrl } : {}),
  });

  const result: ProviderCheckResult = {
    endpoint, model, servedModel: null, passed: [], failed: [], usable: false,
  };

  for (const probe of PROBES) {
    try {
      const detail = await probe.run(client, model);
      if (probe.key === "basic") {
        const m = detail.match(/served model: ([^)]+)\)/);
        result.servedModel = m ? m[1] : null;
      }
      result.passed.push(probe.key);
      log.ok(`${probe.name} — ${detail}`);
    } catch (err) {
      const reason =
        err instanceof Anthropic.APIError
          ? `${err.status}: ${err.message.slice(0, 160)}`
          : (err as Error).message.slice(0, 160);
      result.failed.push({ key: probe.key, name: probe.name, reason, required: probe.required, breaks: probe.breaks });
      log[probe.required ? "error" : "warn"](`${probe.name} — ${reason}`);
    }
  }

  console.log("");
  const requiredFailures = result.failed.filter((f) => f.required);
  result.usable = requiredFailures.length === 0;

  // 名乗っているモデルと、実際に応答したモデルが違わないか
  if (result.servedModel && result.servedModel !== model) {
    log.warn(`要求したモデルは ${model} ですが、応答は ${result.servedModel} と名乗っています。`);
    log.warn("別のモデルに差し替えられている可能性があります（記事の質が落ちても気づけません）。");
  }

  if (result.usable) {
    log.ok("このエンドポイントでパイプラインは動きます。");
    if (result.failed.length) {
      log.info("ただし次は使えません:");
      for (const f of result.failed) log.info(`  - ${f.name} → ${f.breaks.join(" / ")}`);
    }
  } else {
    log.error("このエンドポイントではパイプラインが成立しません。壊れるのは:");
    for (const f of requiredFailures) {
      log.error(`  - ${f.name}`);
      for (const b of f.breaks) log.error(`      → ${b}`);
    }
  }

  if (env.usingCustomEndpoint) {
    console.log("");
    log.warn("公式以外のエンドポイントを使っています。技術的に動くかとは別に、次を確認してください:");
    log.warn("  1. 記事の元ネタとプロンプトは全部その事業者のサーバーを通ります");
    log.warn("  2. 提供元が Anthropic の正規リセラーか（プールされた鍵の又貸しは突然止まります）");
    log.warn("  3. 止まったときに何日で復旧できるか（毎日走る自動化の土台にするなら致命的です）");
  }

  return result;
}
