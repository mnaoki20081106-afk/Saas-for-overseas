/**
 * Pinterest OAuth をターミナルなしで完結させるための2ページ。
 *
 * 背景: `npm run autopilot pinterest:auth` はローカル/Codespacesのターミナルが前提だが、
 * 端末がiPad(Safariのみ)などターミナルを使えない/使いたくない人がいる。
 * 代わりに、静的な2ページ + GitHub Actions の workflow_dispatch だけで完結させる。
 *
 * 1. /pinterest-connect/ … Pinterest の認可画面へ飛ばす(App ID をその場で入力)
 * 2. Pinterest 側で Allow すると、/pinterest-callback/ に code 付きで戻ってくる
 * 3. 表示された code を、GitHub の Actions タブ →
 *    「Pinterest 認可コードをトークンに交換」→ Run workflow に貼る
 * 4. そのワークフローが PINTEREST_APP_ID / PINTEREST_APP_SECRET で交換し、
 *    結果の refresh_token を(ログに出さず) GitHub Secrets に直接書き込む
 *    (`.github/workflows/pinterest-token-exchange.yml` 参照)
 *
 * App ID はここでは秘密として扱わない(Pinterest の client_id は公開情報)。
 * App Secret はこのページのどこにも出てこない。
 */
import { escapeHtml } from "../lib/util";
import { PINTEREST_SCOPES } from "../integrations/pinterest";
import { detectOwnerRepo } from "./page";

const CSS = `
:root{--bg:#0b0f14;--surface:#131a22;--surface2:#1a2330;--ink:#e7edf3;--muted:#8a96a3;
  --line:#232e3b;--accent:#3b82f6;--good:#16a34a;--bad:#dc2626}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.6 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:640px;margin:0 auto;padding:2rem 1.25rem 4rem}
h1{font-size:1.35rem;margin:0 0 1.2rem}
.banner{border:1px solid var(--line);background:var(--surface);border-radius:.6rem;
  padding:.9rem 1.1rem;margin-bottom:1.1rem;font-size:.88rem;line-height:1.65}
.banner.bad{border-color:var(--bad)}
.banner.good{border-color:var(--good)}
label{display:block;font-size:.82rem;color:var(--muted);margin:1rem 0 .35rem}
input[type=text]{width:100%;background:var(--surface2);border:1px solid var(--line);color:var(--ink);
  border-radius:.4rem;padding:.65rem .75rem;font-size:1rem}
code,.mono{font-family:ui-monospace,Menlo,Consolas,monospace}
.codebox{background:var(--surface2);border:1px solid var(--line);border-radius:.5rem;
  padding:.85rem .95rem;font-size:.95rem;word-break:break-all;margin:.4rem 0 1rem;
  font-family:ui-monospace,Menlo,Consolas,monospace}
button{background:var(--accent);border:1px solid var(--accent);color:#fff;font-weight:600;
  border-radius:.5rem;padding:.75rem 1.1rem;font-size:1rem;cursor:pointer;width:100%;margin-top:.5rem}
button.ghost{background:transparent;color:var(--accent);width:auto;padding:.4rem .7rem;font-size:.85rem;margin-top:.5rem}
ol{padding-left:1.2rem}
li{margin-bottom:.5rem}
a{color:var(--accent)}
.big{font-size:1.3rem;font-weight:700;letter-spacing:.01em}
`;

const HEAD_KEY = "wfu_pinterest_app_id_v1";

export function buildPinterestConnectPage(baseUrl: string): string {
  const redirectUri = `${baseUrl.replace(/\/+$/, "")}/pinterest-callback/`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Pinterest連携</title>
<style>${CSS}</style></head><body><div class="wrap">
<h1>Pinterestと連携する</h1>
<div class="banner">
  このページは、ターミナルを使わずにPinterestの認可を行うためのものです。
  ここで入力するApp ID(Client ID)は公開情報で、秘密ではありません。
  App Secretはこのページのどこにも入力しません。
</div>
<label for="appid">Pinterest App ID</label>
<input id="appid" type="text" placeholder="Pinterestのアプリ設定画面にあるApp ID" autocomplete="off" autocapitalize="off" spellcheck="false">

<label>先にPinterestのアプリ設定 → Redirect URIs に、これを一字一句そのまま登録してください</label>
<div class="codebox">${escapeHtml(redirectUri)}</div>

<label>要求する権限(スコープ)</label>
<div class="codebox">${escapeHtml(PINTEREST_SCOPES)}</div>

<button id="go">Pinterestに接続する</button>
<div id="err" class="banner bad" style="display:none;margin-top:1rem"></div>
</div>
<script>
const REDIRECT_URI = ${JSON.stringify(redirectUri)};
const SCOPE = ${JSON.stringify(PINTEREST_SCOPES)};
const KEY = ${JSON.stringify(HEAD_KEY)};
const input = document.getElementById("appid");
const err = document.getElementById("err");
input.value = localStorage.getItem(KEY) || "";
document.getElementById("go").addEventListener("click", () => {
  const appId = input.value.trim();
  if (!appId) {
    err.textContent = "App IDを入力してください。";
    err.style.display = "block";
    return;
  }
  localStorage.setItem(KEY, appId);
  const u = new URL("https://www.pinterest.com/oauth/");
  u.searchParams.set("client_id", appId);
  u.searchParams.set("redirect_uri", REDIRECT_URI);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPE);
  u.searchParams.set("state", "wfu-connect");
  location.href = u.toString();
});
</script>
</body></html>`;
}

export function buildPinterestCallbackPage(): string {
  const owner = detectOwnerRepo();
  const actionsUrl = owner
    ? `https://github.com/${owner.owner}/${owner.repo}/actions/workflows/pinterest-token-exchange.yml`
    : null;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Pinterest連携 — コード</title>
<style>${CSS}</style></head><body><div class="wrap">
<h1>認可コードを受け取りました</h1>
<div id="ok" style="display:none">
  <div class="banner good">
    下のコードを、GitHubの「Actions」タブ →「Pinterest 認可コードをトークンに交換」→
    <b>Run workflow</b> の <code>code</code> 欄に貼り付けて実行してください。
    このコードは短時間で失効するので、なるべくすぐに進めてください。
  </div>
  <div id="code" class="codebox big"></div>
  <button id="copy">コピー</button>
  ${actionsUrl
    ? `<a href="${escapeHtml(actionsUrl)}" target="_blank" rel="noopener"><button class="ghost">Actionsのワークフローを開く ↗</button></a>`
    : ""}
</div>
<div id="bad" class="banner bad" style="display:none"></div>
</div>
<script>
const q = new URLSearchParams(location.search);
const code = q.get("code");
const error = q.get("error") || q.get("error_description");
if (code) {
  document.getElementById("ok").style.display = "block";
  document.getElementById("code").textContent = code;
  document.getElementById("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      const b = document.getElementById("copy");
      b.textContent = "コピーしました";
      setTimeout(() => (b.textContent = "コピー"), 1500);
    } catch {
      alert("自動コピーに失敗しました。上のコードを長押しして手動でコピーしてください。");
    }
  });
} else {
  const bad = document.getElementById("bad");
  bad.style.display = "block";
  bad.textContent = error
    ? "Pinterestから認可コードを受け取れませんでした: " + error
    : "URLに code パラメータがありません。もう一度 /pinterest-connect/ からやり直してください。";
}
</script>
</body></html>`;
}
