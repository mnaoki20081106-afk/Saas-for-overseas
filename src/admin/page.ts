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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

/**
 * 管理画面のフロントエンドは src/admin/app.js（素の JavaScript）にある。
 * TS のテンプレートリテラルの中に JS を書くと、バッククォートと ${} を全部
 * エスケープする必要があり壊れやすいので、別ファイルにして丸ごと差し込む。
 */
function adminAppJs(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.join(here, "app.js"), "utf8");
}

export function buildAdminPage(branch: string): string {
  const ADMIN_APP_JS = adminAppJs();
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
${ADMIN_APP_JS}
</script>
</body></html>`;
}
