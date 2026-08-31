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
  font:14px/1.55 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-text-size-adjust:100%}
.wrap{max-width:1080px;margin:0 auto;padding:1.5rem 1.25rem 5rem}
header{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:1rem;flex-wrap:wrap}
h1{font-size:1.3rem;margin:0}
h4{margin:0 0 .3rem;font-size:.86rem;color:var(--muted);font-weight:700;letter-spacing:.03em}
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
  border-radius:.4rem;padding:.5rem .8rem;font-size:.84rem;cursor:pointer;min-height:38px}
button:disabled{opacity:.5;cursor:wait}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
button.warn{border-color:var(--warn);color:var(--warn)}
/* 取り消し系は「押せるが、目立ちすぎない」。眺めるだけの画面で誤タップさせないため。 */
button.danger{border-color:var(--bad);color:var(--bad);background:transparent;font-weight:600}
button.danger:hover{background:var(--bad);color:#fff}
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

/* ── タブ ───────────────────────────────────────────────── */
.tabs{display:flex;gap:.4rem;margin-bottom:1.1rem;overflow-x:auto;padding-bottom:.2rem;
  border-bottom:1px solid var(--line)}
.tabBtn{background:transparent;border:none;border-bottom:2px solid transparent;border-radius:0;
  color:var(--muted);font-weight:600;padding:.6rem .85rem;white-space:nowrap}
.tabBtn.active{color:var(--ink);border-bottom-color:var(--accent)}
.badge{display:inline-block;background:var(--bad);color:#fff;font-size:.7rem;font-weight:700;
  border-radius:99px;padding:.05rem .4rem;margin-left:.35rem}

/* ── 状態タブの数字 ─────────────────────────────────────── */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.7rem;margin-bottom:1rem}
.stat{border:1px solid var(--line);background:var(--surface);border-radius:.6rem;padding:.85rem 1rem}
.stat .n{font-size:1.6rem;font-weight:700;line-height:1.1}
.stat .l{color:var(--muted);font-size:.78rem;margin-top:.2rem}
.stat.warn{border-color:var(--warn)}
.stat.warn .n{color:var(--warn)}
.stat.bad{border-color:var(--bad)}
.stat.bad .n{color:var(--bad)}

/* ── 承認カード ─────────────────────────────────────────── */
.approval{border:1px solid var(--accent);background:var(--surface);border-radius:.7rem;
  padding:1.1rem 1.25rem;margin-bottom:1rem}
.approval h3{margin:0 0 .2rem;font-size:1.08rem}
.approval .when{color:var(--warn);font-size:.8rem;margin-bottom:.9rem}
.approval section{margin-bottom:.9rem}
.approval p{margin:.2rem 0}
.approval ul{margin:.2rem 0;padding-left:1.15rem}
dl.money{display:grid;grid-template-columns:auto 1fr;gap:.25rem .8rem;margin:.2rem 0}
dl.money dt{color:var(--muted);font-size:.82rem}
dl.money dd{margin:0;font-variant-numeric:tabular-nums}
ul.risk li{color:var(--warn)}
.decide{display:flex;gap:.7rem;margin-top:1rem;flex-wrap:wrap}
.decide button{flex:1;min-width:130px;font-size:1rem;font-weight:700;padding:.85rem 1rem;min-height:52px}
.decide .go{background:var(--good);border-color:var(--good);color:#fff}
.decide .stop{background:transparent;border-color:var(--bad);color:var(--bad)}

/* ── 緊急停止 ───────────────────────────────────────────── */
.danger{border:1px solid var(--bad);background:var(--surface);border-radius:.7rem;
  padding:1.1rem 1.25rem;margin-top:1.2rem}
.danger h3{margin:0 0 .3rem;font-size:1rem;color:var(--bad)}
.danger button{background:var(--bad);border-color:var(--bad);color:#fff;font-weight:700;
  padding:.7rem 1.2rem;min-height:46px}
.danger button.resume{background:var(--good);border-color:var(--good)}

/* ── 失敗の記録 ─────────────────────────────────────────── */
.err{border-left:3px solid var(--bad);background:var(--surface2);border-radius:.3rem;
  padding:.5rem .7rem;margin-bottom:.5rem;font-size:.82rem;white-space:pre-wrap;word-break:break-word}
.err .w{color:var(--muted);font-size:.76rem;margin-bottom:.2rem}

/* ── 投稿の確認タブ ─────────────────────────────────────── */
.section-title{font-size:.95rem;font-weight:700;margin:1.4rem 0 .6rem;
  display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.section-title .count{color:var(--muted);font-weight:400;font-size:.82rem}
.pin{display:flex;gap:1rem;border:1px solid var(--line);background:var(--surface);
  border-radius:.7rem;padding:1rem 1.1rem;margin-bottom:.8rem}
.pin.gone{opacity:.55}
.pin img{width:100px;height:150px;object-fit:cover;border-radius:.4rem;
  background:var(--surface2);flex-shrink:0}
.pin .body{flex:1;min-width:0}
.pin .t{font-weight:600;margin-bottom:.25rem;word-break:break-word}
.pin .d{color:var(--muted);font-size:.82rem;white-space:pre-wrap;word-break:break-word;margin-bottom:.4rem}
.article-body{background:var(--surface2);border-radius:.4rem;padding:.9rem 1rem;margin-top:.7rem;
  max-height:26rem;overflow:auto;white-space:pre-wrap;word-break:break-word;
  font:13px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace}
details summary{cursor:pointer;color:var(--muted);font-size:.82rem;padding:.2rem 0}
.note{color:var(--muted);font-size:.8rem;margin-top:.5rem;line-height:1.6}

@media (max-width:560px){
  .wrap{padding:1rem .8rem 5rem}
  .pin{flex-direction:column}
  .pin img{width:100%;height:auto;max-width:180px}
}
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
<title>${escapeHtml(c.site.name)} — 代表取締役デスク</title>
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
const PINS_WORKFLOW = "autopilot-pins.yml";
// ピン画像は公開リポジトリの raw から直接読む（画像自体は秘密情報ではない）
const RAW_BASE = "https://raw.githubusercontent.com/" + OWNER + "/" + REPO + "/" + BRANCH + "/";
const TOKEN_KEY = "wfu_admin_gh_token_v1";
${ADMIN_APP_JS}
</script>
</body></html>`;
}
