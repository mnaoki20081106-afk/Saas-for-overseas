/**
 * GitHub API 直叩き型の管理画面。
 *
 * このプロジェクトは静的サイト(GitHub Pages)なので書き込み用サーバーを持たない。
 * このページ自体もただの静的HTML+JSとして public/admin/ に出力され、GitHub Pages
 * にデプロイされる。「普通にURLを開いてアクセスできる」形にするため。
 *
 * 書き込みは、ページを開いた本人が貼った GitHub の個人アクセストークン(PAT)を使って、
 * ブラウザから直接 GitHub の REST API を叩く形にしている(GitHub API は CORS を許可している)。
 * トークンは常にその人のブラウザの localStorage にだけ保存され、
 * どのサーバーにも(Claude / このプロジェクトの誰にも)一切送信されない。
 *
 * ページのHTMLソース自体には、いかなる秘密情報も埋め込まれていない
 * (トークンを持たない人がこのURLを踏んでも、一覧の閲覧すらできない)。
 */
import { execSync } from "node:child_process";
import { escapeHtml } from "../lib/util";
import { config } from "../lib/config";

export function detectOwnerRepo(): { owner: string; repo: string } | null {
  try {
    const url = execSync("git remote get-url origin", { encoding: "utf8" }).trim();
    const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (!m) return null;
    return { owner: m[1], repo: m[2] };
  } catch {
    return null;
  }
}

const CSS = `
:root{--bg:#0b0f14;--surface:#131a22;--surface2:#1a2330;--ink:#e7edf3;--muted:#8a96a3;
  --line:#232e3b;--accent:#3b82f6;--good:#16a34a;--warn:#f59e0b;--bad:#dc2626}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:14px/1.55 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:1080px;margin:0 auto;padding:1.5rem 1.25rem 4rem}
header{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:1.25rem;flex-wrap:wrap}
h1{font-size:1.3rem;margin:0}
.sub{color:var(--muted);font-size:.85rem;margin-top:.2rem}
.pill{display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.02em;
  padding:.2rem .55rem;border-radius:99px;color:#fff;white-space:nowrap}
.banner{border:1px solid var(--line);background:var(--surface);border-radius:.6rem;
  padding:.9rem 1.1rem;margin-bottom:1.25rem;font-size:.86rem;line-height:1.6}
.banner.ok{border-color:var(--good)}
.banner.bad{border-color:var(--bad)}
.banner.warn{border-color:var(--warn)}
.card{border:1px solid var(--line);background:var(--surface);border-radius:.7rem;
  padding:1.1rem 1.25rem;margin-bottom:.9rem}
.card h3{margin:0 0 .15rem;font-size:1.02rem;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.meta{color:var(--muted);font-size:.82rem;margin-bottom:.6rem}
.meta b{color:var(--ink)}
.row{display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin-top:.6rem}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
input[type=url],input[type=text],input[type=password]{flex:1;min-width:220px;background:var(--surface2);
  border:1px solid var(--line);color:var(--ink);border-radius:.4rem;padding:.5rem .65rem;font-size:.86rem}
button,select{background:var(--surface2);border:1px solid var(--line);color:var(--ink);
  border-radius:.4rem;padding:.5rem .8rem;font-size:.84rem;cursor:pointer}
button:disabled{opacity:.5;cursor:wait}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
.current-link{background:var(--surface2);border-radius:.4rem;padding:.5rem .65rem;
  font-size:.82rem;word-break:break-all;color:var(--muted)}
.empty{color:var(--muted);text-align:center;padding:3rem 0}
code{background:var(--surface2);padding:.1rem .35rem;border-radius:.25rem;font-size:.9em}
.gate{max-width:640px;margin:3rem auto}
ol{padding-left:1.2rem}
li{margin-bottom:.4rem}
.spin{display:inline-block;width:.8em;height:.8em;border:2px solid var(--muted);
  border-top-color:var(--ink);border-radius:50%;animation:spin .7s linear infinite;margin-right:.4em}
@keyframes spin{to{transform:rotate(360deg)}}
`;

export function buildAdminPage(branch: string): string {
  const c = config();
  const owner = detectOwnerRepo();
  const ownerRepoWarning = owner
    ? ""
    : `<div class="banner bad">git remote から owner/repo を検出できませんでした。ビルド環境を確認してください。</div>`;

  // このページに埋め込むのは owner/repo/branch という公開情報だけ。秘密情報は一切含まない。
  const OWNER = owner?.owner ?? "";
  const REPO = owner?.repo ?? "";

  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(c.site.name)} — 管理画面</title>
<style>${CSS}</style></head><body><div class="wrap">
${ownerRepoWarning}
<div id="app"><div class="empty">読み込み中…</div></div>
</div>
<script>
const OWNER = ${JSON.stringify(OWNER)};
const REPO = ${JSON.stringify(REPO)};
const BRANCH = ${JSON.stringify(branch)};
const SITE_NAME = ${JSON.stringify(c.site.name)};
const BASE_URL = ${JSON.stringify(c.site.baseUrl)};
const REBUILD_WORKFLOW = "rebuild-site.yml";
const TOKEN_KEY = "wfu_admin_gh_token_v1";

const STATUS_LABEL = {
  candidate: "未応募", awaiting_apply: "応募文あり・未応募", applied: "審査中",
  approved: "承認済み", rejected: "却下", paused: "保留",
};
const STATUS_COLOR = {
  candidate: "#94a3b8", awaiting_apply: "#f59e0b", applied: "#3b82f6",
  approved: "#16a34a", rejected: "#dc2626", paused: "#71717a",
};

function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

/** UTF-8 安全な base64 encode/decode（日本語のコメントがJSON内にあるため） */
function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
function b64decodeUtf8(b64) {
  const bin = atob(b64.replace(/\\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function gh(path, opts) {
  const res = await fetch("https://api.github.com" + path, {
    ...opts,
    headers: {
      Authorization: "Bearer " + getToken(),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts && opts.headers),
    },
  });
  return res;
}

/** ファイルを読む。無ければ null を返す(初回はまだ存在しないファイルがある)。 */
async function getFile(path) {
  const res = await gh(\`/repos/\${OWNER}/\${REPO}/contents/\${path}?ref=\${encodeURIComponent(BRANCH)}\`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(\`\${path} の取得に失敗 (HTTP \${res.status})\`);
  const json = await res.json();
  return { json: JSON.parse(b64decodeUtf8(json.content)), sha: json.sha };
}

/** ファイルを書く(無ければ新規作成、あれば更新)。 */
async function putFile(path, obj, sha, message) {
  const body = {
    message,
    content: b64encodeUtf8(JSON.stringify(obj, null, 2) + "\\n"),
    branch: BRANCH,
    ...(sha ? { sha } : {}),
  };
  const res = await gh(\`/repos/\${OWNER}/\${REPO}/contents/\${path}\`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    if (res.status === 409 || res.status === 422) {
      throw new Error(\`\${path} が他の変更と競合しました。ページを再読み込みしてやり直してください。\`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("トークンが無効か、権限が不足しています(Contents: Read and write が必要です)。");
    }
    throw new Error(\`\${path} の保存に失敗しました: \${detail.message || res.status}\`);
  }
  return res.json();
}

async function dispatchRebuild() {
  const res = await gh(\`/repos/\${OWNER}/\${REPO}/actions/workflows/\${REBUILD_WORKFLOW}/dispatches\`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: BRANCH }),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("サイトの再公開に失敗しました(トークンに Actions: Read and write の権限が必要です)。保存自体は完了しています。");
    }
    throw new Error("サイトの再公開の起動に失敗しました。保存自体は完了しています。Actions タブから rebuild-site を手動実行してください。");
  }
}

/* ------------------------------------------------------------ rendering */

const app = document.getElementById("app");

function renderGate(errorMsg) {
  app.innerHTML = \`
    <div class="gate">
      <h1>\${esc(SITE_NAME)} — 管理画面</h1>
      <div class="banner warn">
        このページはあなた専用です。GitHub の個人アクセストークン(PAT)を入力すると、
        あなたのブラウザから直接 GitHub を読み書きします。
        <b>トークンはこの端末のブラウザにだけ保存され、他のどこにも送信されません。</b>
      </div>
      \${errorMsg ? \`<div class="banner bad">\${esc(errorMsg)}</div>\` : ""}
      <ol>
        <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">
          Fine-grained personal access token を新規作成 ↗</a></li>
        <li>Repository access は「Only select repositories」→ <code>\${esc(OWNER)}/\${esc(REPO)}</code> だけを選ぶ</li>
        <li>Permissions で <code>Contents: Read and write</code> と
          <code>Actions: Read and write</code> を設定</li>
        <li>有効期限は短め(90日など)にしておく</li>
        <li>発行されたトークン(<code>github_pat_...</code>)を下に貼る</li>
      </ol>
      <div class="row">
        <input type="password" id="tokenInput" placeholder="github_pat_...">
        <button class="primary" id="tokenSave">保存して開く</button>
      </div>
    </div>\`;
  document.getElementById("tokenSave").onclick = () => {
    const v = document.getElementById("tokenInput").value.trim();
    if (!v) return;
    setToken(v);
    boot();
  };
}

function maskUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname + (u.search ? "?…" : "");
  } catch {
    return String(url).slice(0, 40);
  }
}

function programCard(p, links) {
  const current = links[p.slug];
  const ltv = Math.round(p.estMonthlyCommissionUsd * p.estAvgRetentionMonths);
  const statusOptions = Object.keys(STATUS_LABEL)
    .map((s) => \`<option value="\${s}" \${s === p.status ? "selected" : ""}>\${STATUS_LABEL[s]}</option>\`)
    .join("");

  const linkSection = current
    ? \`<div class="current-link">現在のリンク: \${esc(maskUrl(current))}</div>
       <div class="row">
         <a href="\${esc(BASE_URL)}/go/\${esc(p.slug)}/" target="_blank" rel="noopener">確認用リンクを開く ↗</a>
         <details><summary style="cursor:pointer;color:var(--muted);font-size:.82rem">URLを変更する</summary>
           <div class="row" style="margin-top:.5rem">
             <input type="url" class="linkInput" data-slug="\${esc(p.slug)}" placeholder="新しいアフィリエイトURL">
             <button class="primary saveLinkBtn" data-slug="\${esc(p.slug)}">保存して反映</button>
           </div>
         </details>
       </div>\`
    : \`<div class="row">
         <input type="url" class="linkInput" data-slug="\${esc(p.slug)}" placeholder="発行されたアフィリエイトURLを貼り付け">
         <button class="primary saveLinkBtn" data-slug="\${esc(p.slug)}">保存して反映</button>
       </div>\`;

  return \`<div class="card" data-card="\${esc(p.slug)}">
    <h3>\${esc(p.name)}
      <span class="pill" style="background:\${STATUS_COLOR[p.status]}">\${STATUS_LABEL[p.status]}</span>
    </h3>
    <div class="meta">
      \${esc(p.category)} · \${esc(p.network)} ·
      スコア <b>\${p.score.toFixed(1)}</b> ·
      $\${p.estMonthlyCommissionUsd}/月 × \${p.estAvgRetentionMonths}ヶ月 = 想定LTV <b>$\${ltv}</b>
    </div>
    <div class="row">
      <a href="\${esc(p.affiliateProgramUrl)}" target="_blank" rel="noopener">応募先 ↗</a>
      <a href="\${esc(p.homepage)}" target="_blank" rel="noopener">公式サイト ↗</a>
      <select class="statusSelect" data-slug="\${esc(p.slug)}" style="margin-left:auto">\${statusOptions}</select>
    </div>
    \${linkSection}
  </div>\`;
}

let STATE = null; // { programs: {json, sha}, links: {json, sha}, tasks: {json, sha} }

async function loadState() {
  const [programs, links, tasks] = await Promise.all([
    getFile("data/programs.json"),
    getFile("config/affiliate-links.json"),
    getFile("data/human-tasks.json"),
  ]);
  STATE = {
    programs: programs || { json: [], sha: null },
    links: links || { json: { links: {} }, sha: null },
    tasks: tasks || { json: [], sha: null },
  };
}

function render(flash) {
  const all = [...STATE.programs.json].sort((a, b) => b.score - a.score);
  const approved = all.filter((p) => p.status === "approved").length;
  app.innerHTML = \`
    \${flash ? \`<div class="banner \${flash.kind}">\${flash.busy ? '<span class="spin"></span>' : ''}\${esc(flash.text)}</div>\` : ""}
    <header>
      <div>
        <h1>\${esc(SITE_NAME)} — 案件管理</h1>
        <div class="sub">\${all.length} 件（承認済み \${approved} 件） · \${esc(OWNER)}/\${esc(REPO)}@\${esc(BRANCH)}</div>
      </div>
      <button id="logoutBtn">トークンを削除してログアウト</button>
    </header>
    \${all.length === 0 ? '<div class="empty">案件がまだありません。研究(research)を実行してください。</div>' : all.map((p) => programCard(p, STATE.links.json.links || {})).join("")}
  \`;
  document.getElementById("logoutBtn").onclick = () => { clearToken(); location.reload(); };
  document.querySelectorAll(".saveLinkBtn").forEach((btn) => {
    btn.onclick = () => {
      const slug = btn.dataset.slug;
      const input = document.querySelector(\`.linkInput[data-slug="\${slug}"]\`);
      const url = input.value.trim();
      if (!url) return;
      saveLink(slug, url);
    };
  });
  document.querySelectorAll(".statusSelect").forEach((sel) => {
    sel.onchange = () => saveStatus(sel.dataset.slug, sel.value);
  });
}

async function saveLink(slug, url) {
  render({ kind: "warn", text: \`\${slug} を保存中…\`, busy: true });
  try {
    STATE.links.json.links = STATE.links.json.links || {};
    STATE.links.json.links[slug] = url;
    const putLinks = await putFile("config/affiliate-links.json", STATE.links.json, STATE.links.sha,
      \`admin: \${slug} のアフィリエイトリンクを登録\`);
    STATE.links.sha = putLinks.content.sha;

    const idx = STATE.programs.json.findIndex((p) => p.slug === slug);
    if (idx !== -1) STATE.programs.json[idx].status = "approved";
    const putPrograms = await putFile("data/programs.json", STATE.programs.json, STATE.programs.sha,
      \`admin: \${slug} を承認済みに変更\`);
    STATE.programs.sha = putPrograms.content.sha;

    const taskIdx = STATE.tasks.json.findIndex((t) => t.id === "apply-" + slug);
    if (taskIdx !== -1) {
      STATE.tasks.json[taskIdx].status = "done";
      STATE.tasks.json[taskIdx].doneAt = new Date().toISOString();
      const putTasks = await putFile("data/human-tasks.json", STATE.tasks.json, STATE.tasks.sha,
        \`admin: \${slug} のタスクを完了に\`);
      STATE.tasks.sha = putTasks.content.sha;
    }

    render({ kind: "warn", text: "サイトを再公開しています…", busy: true });
    await dispatchRebuild();
    render({ kind: "ok", text: \`保存しました。1〜2分でサイトに反映されます。確認用リンク /go/\${slug}/ でテストクリックしてください。\` });
  } catch (err) {
    render({ kind: "bad", text: String(err.message || err) });
  }
}

async function saveStatus(slug, status) {
  render({ kind: "warn", text: \`\${slug} を更新中…\`, busy: true });
  try {
    const idx = STATE.programs.json.findIndex((p) => p.slug === slug);
    if (idx !== -1) STATE.programs.json[idx].status = status;
    const put = await putFile("data/programs.json", STATE.programs.json, STATE.programs.sha,
      \`admin: \${slug} のステータスを \${status} に変更\`);
    STATE.programs.sha = put.content.sha;
    render({ kind: "ok", text: "更新しました。" });
  } catch (err) {
    render({ kind: "bad", text: String(err.message || err) });
  }
}

async function boot() {
  if (!getToken()) return renderGate();
  app.innerHTML = '<div class="empty"><span class="spin"></span>読み込み中…</div>';
  try {
    await loadState();
    render();
  } catch (err) {
    renderGate("読み込みに失敗しました: " + (err.message || err));
  }
}
boot();
</script>
</body></html>`;
}
