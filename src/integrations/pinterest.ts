import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { env } from "../lib/config";
import { log } from "../lib/log";
import { P } from "../lib/paths";
import { sleep } from "../lib/util";

/**
 * Pinterest API v5 クライアント。
 *
 * 必要なスコープ:
 *   boards:read boards:write pins:read pins:write user_accounts:read
 *
 * アクセストークンは短命なので、リフレッシュトークンから毎回自動発行する。
 * つまり一度 PINTEREST_REFRESH_TOKEN を登録すれば、以後の更新は不要。
 */

export const PINTEREST_SCOPES = [
  "boards:read", "boards:write", "pins:read", "pins:write", "user_accounts:read",
].join(",");

function apiBase(): string {
  return env.pinterest.sandbox ? "https://api-sandbox.pinterest.com/v5" : "https://api.pinterest.com/v5";
}

export class PinterestError extends Error {
  constructor(message: string, public status: number, public body: string) {
    super(message);
    this.name = "PinterestError";
  }
  /** レート制限や一時的な障害なら true（あとで再試行すべき） */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const direct = env.pinterest.accessToken;
  if (direct) {
    cachedToken = { token: direct, expiresAt: Date.now() + 30 * 60_000 };
    return direct;
  }

  const { appId, appSecret, refreshToken } = env.pinterest;
  if (!appId || !appSecret || !refreshToken) {
    throw new Error(
      "Pinterest の認証情報がありません。PINTEREST_APP_ID / PINTEREST_APP_SECRET / PINTEREST_REFRESH_TOKEN を設定してください（`npm run autopilot pinterest:auth` で取得できます）。",
    );
  }

  const basic = Buffer.from(`${appId}:${appSecret}`).toString("base64");
  const res = await fetch(`${apiBase()}/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  const text = await res.text();
  if (!res.ok) throw new PinterestError(`アクセストークンの更新に失敗しました: ${text}`, res.status, text);

  const json = JSON.parse(text) as { access_token: string; expires_in?: number };
  cachedToken = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 1800) * 1000 };
  return json.access_token;
}

async function call<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  endpoint: string,
  opts: { query?: Record<string, string>; body?: unknown; attempt?: number } = {},
): Promise<T> {
  const token = await accessToken();
  const url = new URL(`${apiBase()}${endpoint}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });

  const text = await res.text();
  if (!res.ok) {
    const err = new PinterestError(`Pinterest ${method} ${endpoint} → ${res.status}: ${text.slice(0, 400)}`, res.status, text);
    const attempt = opts.attempt ?? 0;
    if (err.retryable && attempt < 4) {
      const waitMs = res.status === 429 ? 60_000 : 2000 * 2 ** attempt;
      log.warn(`Pinterest ${res.status} → ${Math.round(waitMs / 1000)}秒待って再試行 (${attempt + 1}/4)`);
      await sleep(waitMs);
      return call<T>(method, endpoint, { ...opts, attempt: attempt + 1 });
    }
    throw err;
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/* ------------------------------------------------------------------ boards */

export interface Board { id: string; name: string; description?: string }

export async function listBoards(): Promise<Board[]> {
  const out: Board[] = [];
  let bookmark: string | undefined;
  do {
    const page = await call<{ items: Board[]; bookmark?: string }>("GET", "/boards", {
      query: { page_size: "100", ...(bookmark ? { bookmark } : {}) },
    });
    out.push(...(page.items ?? []));
    bookmark = page.bookmark;
  } while (bookmark);
  return out;
}

const boardCache = new Map<string, string>();

/** ボードが無ければ作る。カテゴリごとに1枚のボードを持つ運用。 */
export async function ensureBoard(name: string, description: string): Promise<string> {
  const cached = boardCache.get(name);
  if (cached) return cached;

  const boards = await listBoards();
  const found = boards.find((b) => b.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (found) {
    boardCache.set(name, found.id);
    return found.id;
  }

  const created = await call<Board>("POST", "/boards", {
    body: { name, description: description.slice(0, 500), privacy: "PUBLIC" },
  });
  log.ok(`Pinterest ボードを作成しました: ${name}`);
  boardCache.set(name, created.id);
  return created.id;
}

/* -------------------------------------------------------------------- pins */

export interface CreatePinInput {
  boardId: string;
  title: string;
  description: string;
  altText: string;
  link: string;
  imagePath: string;
}

export async function createPin(input: CreatePinInput): Promise<string> {
  const abs = path.isAbsolute(input.imagePath) ? input.imagePath : path.join(P.root, input.imagePath);
  if (!fs.existsSync(abs)) throw new Error(`ピン画像が見つかりません: ${input.imagePath}`);
  const data = fs.readFileSync(abs).toString("base64");

  const created = await call<{ id: string }>("POST", "/pins", {
    body: {
      board_id: input.boardId,
      title: input.title.slice(0, 100),
      description: input.description.slice(0, 500),
      alt_text: input.altText.slice(0, 500),
      link: input.link,
      media_source: { source_type: "image_base64", content_type: "image/png", data },
    },
  });
  return created.id;
}

/* --------------------------------------------------------------- analytics */

export interface RawPinAnalytics {
  impressions: number;
  outboundClicks: number;
  saves: number;
}

export async function pinAnalytics(
  pinId: string,
  startDate: string,
  endDate: string,
): Promise<RawPinAnalytics> {
  const res = await call<Record<string, { summary_metrics?: Record<string, number> }>>(
    "GET",
    `/pins/${pinId}/analytics`,
    {
      query: {
        start_date: startDate,
        end_date: endDate,
        metric_types: "IMPRESSION,OUTBOUND_CLICK,SAVE",
      },
    },
  );
  // レスポンスは {"ALL": {"summary_metrics": {...}}} のような形
  const bucket = res.ALL ?? Object.values(res)[0];
  const m = bucket?.summary_metrics ?? {};
  return {
    impressions: Number(m.IMPRESSION ?? 0),
    outboundClicks: Number(m.OUTBOUND_CLICK ?? 0),
    saves: Number(m.SAVE ?? 0),
  };
}

export async function accountAnalytics(startDate: string, endDate: string): Promise<RawPinAnalytics> {
  const res = await call<{ all?: { summary_metrics?: Record<string, number> }; summary_metrics?: Record<string, number> }>(
    "GET",
    "/user_account/analytics",
    { query: { start_date: startDate, end_date: endDate, metric_types: "IMPRESSION,OUTBOUND_CLICK,SAVE" } },
  );
  const m = res.all?.summary_metrics ?? res.summary_metrics ?? {};
  return {
    impressions: Number(m.IMPRESSION ?? 0),
    outboundClicks: Number(m.OUTBOUND_CLICK ?? 0),
    saves: Number(m.SAVE ?? 0),
  };
}

/* ------------------------------------------------------------- OAuth 補助 */

export function authorizeUrl(redirectUri: string, state = "autopilot"): string {
  const appId = env.pinterest.appId;
  if (!appId) throw new Error("PINTEREST_APP_ID が未設定です");
  const u = new URL("https://www.pinterest.com/oauth/");
  u.searchParams.set("client_id", appId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", PINTEREST_SCOPES);
  u.searchParams.set("state", state);
  return u.toString();
}

export async function exchangeCode(code: string, redirectUri: string): Promise<{
  access_token: string; refresh_token: string; expires_in: number;
}> {
  const { appId, appSecret } = env.pinterest;
  if (!appId || !appSecret) throw new Error("PINTEREST_APP_ID / PINTEREST_APP_SECRET が未設定です");
  const basic = Buffer.from(`${appId}:${appSecret}`).toString("base64");
  const res = await fetch(`${apiBase()}/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  const text = await res.text();
  if (!res.ok) throw new PinterestError(`コード交換に失敗しました: ${text}`, res.status, text);
  return JSON.parse(text);
}

/** ローカルに一時サーバーを立てて OAuth のコールバックを受け取る（初回のみ・1回だけ） */
export function waitForCallback(port: number): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end("not found");
        return;
      }
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        code
          ? "<h1>OK</h1><p>ターミナルに戻ってください。このタブは閉じて構いません。</p>"
          : `<h1>失敗</h1><pre>${error ?? "code がありません"}</pre>`,
      );
      server.close();
      if (code) resolve({ code });
      else reject(new Error(error ?? "認可コードを受け取れませんでした"));
    });
    server.listen(port, () => log.info(`http://localhost:${port}/callback で待機中…`));
    setTimeout(() => {
      server.close();
      reject(new Error("5分待ちましたが応答がありませんでした"));
    }, 300_000).unref();
  });
}
