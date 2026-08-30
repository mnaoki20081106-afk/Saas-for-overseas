#!/usr/bin/env -S node --enable-source-maps
/**
 * ローカル管理画面。
 *   npm run admin
 * → http://localhost:4175 を開く。
 *
 * 案件の一覧、アフィリエイトリンクの貼り付け、GitHubへの反映(commit & push)を
 * この画面だけで完結させる。
 *
 * 重要: これは公開Webサービスではない。127.0.0.1 にしかバインドしない。
 * GitHub への書き込みは、この画面を開いた人のローカルの git 資格情報で行われる
 * (トークンをブラウザに埋め込むような危険なことはしていない)。
 */
import http from "node:http";
import { URL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config, setAffiliateLink, affiliateLinks } from "../lib/config";
import { ensureDirs, P } from "../lib/paths";
import { programs, humanTasks } from "../lib/store";
import { buildSite } from "../site/build";
import { escapeHtml } from "../lib/util";
import type { Program, ProgramStatus } from "../lib/types";
import { log } from "../lib/log";

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.ADMIN_PORT) || 4175;
const HOST = "127.0.0.1";

/* ------------------------------------------------------------------ git */

async function git(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd: P.root });
    return { ok: true, stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    return { ok: false, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message };
  }
}

/** 生成物をコミットして push する。.github/actions/commit/action.yml と同じロジック。 */
async function commitAndPush(message: string): Promise<{ ok: boolean; detail: string }> {
  await git(["config", "user.name", "autopilot (local admin)"]);
  await git(["config", "user.email", "autopilot@users.noreply.github.com"]);

  const fs = await import("node:fs");
  const targets = ["data", "content", "assets", "config/affiliate-links.json", "TODO-HUMAN.md", "REPORT.md", "docs"];
  for (const t of targets) {
    if (fs.existsSync(`${P.root}/${t}`)) await git(["add", "-A", "--", t]);
  }

  const diff = await git(["diff", "--cached", "--quiet"]);
  if (diff.ok) return { ok: true, detail: "変更はありませんでした（既に反映済み）" };

  const commit = await git(["commit", "-m", message]);
  if (!commit.ok) return { ok: false, detail: `コミットに失敗しました: ${commit.stderr.slice(0, 300)}` };

  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const branchName = branch.stdout.trim();

  for (let attempt = 0; attempt < 3; attempt++) {
    const pull = await git(["pull", "--rebase", "--autostash", "origin", branchName]);
    const push = pull.ok ? await git(["push", "origin", `HEAD:${branchName}`]) : pull;
    if (push.ok) return { ok: true, detail: `${branchName} に反映しました` };
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  return {
    ok: false,
    detail: "ローカルへの保存は成功しましたが、GitHubへの push に失敗しました。ターミナルで `git push` を実行してください。",
  };
}

/* -------------------------------------------------------------- helpers */

function statusLabel(s: ProgramStatus): string {
  const map: Record<ProgramStatus, string> = {
    candidate: "未応募", awaiting_apply: "応募文あり・未応募", applied: "審査中",
    approved: "承認済み", rejected: "却下", paused: "保留",
  };
  return map[s];
}

function statusColor(s: ProgramStatus): string {
  const map: Record<ProgramStatus, string> = {
    candidate: "#94a3b8", awaiting_apply: "#f59e0b", applied: "#3b82f6",
    approved: "#16a34a", rejected: "#dc2626", paused: "#71717a",
  };
  return map[s];
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}${u.search ? "?…" : ""}`;
  } catch {
    return url.slice(0, 40);
  }
}

/* --------------------------------------------------------------- layout */

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
  padding:.2rem .55rem;border-radius:99px;color:#fff}
.banner{border:1px solid var(--line);background:var(--surface);border-radius:.6rem;
  padding:.9rem 1.1rem;margin-bottom:1.25rem;font-size:.88rem}
.banner.ok{border-color:var(--good)}
.banner.bad{border-color:var(--bad)}
.card{border:1px solid var(--line);background:var(--surface);border-radius:.7rem;
  padding:1.1rem 1.25rem;margin-bottom:.9rem}
.card h3{margin:0 0 .15rem;font-size:1.02rem}
.meta{color:var(--muted);font-size:.82rem;margin-bottom:.6rem}
.meta b{color:var(--ink)}
.row{display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin-top:.6rem}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
input[type=url],input[type=text]{flex:1;min-width:220px;background:var(--surface2);
  border:1px solid var(--line);color:var(--ink);border-radius:.4rem;padding:.5rem .65rem;font-size:.86rem}
button,select{background:var(--surface2);border:1px solid var(--line);color:var(--ink);
  border-radius:.4rem;padding:.5rem .8rem;font-size:.84rem;cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
button.commit{background:var(--good);border-color:var(--good);color:#fff;font-weight:700}
.current-link{background:var(--surface2);border-radius:.4rem;padding:.5rem .65rem;
  font-size:.82rem;word-break:break-all;color:var(--muted)}
.topbar{position:sticky;top:0;background:var(--bg);padding:.8rem 0;margin:-1.5rem 0 1rem;
  border-bottom:1px solid var(--line);z-index:5}
.empty{color:var(--muted);text-align:center;padding:3rem 0}
`;

function layout(body: string, flash?: { kind: "ok" | "bad"; text: string }): string {
  const c = config();
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(c.site.name)} — 管理画面</title>
<style>${CSS}</style></head><body><div class="wrap">
${flash ? `<div class="banner ${flash.kind}">${escapeHtml(flash.text)}</div>` : ""}
${body}
</div></body></html>`;
}

function programCard(p: Program): string {
  const links = affiliateLinks();
  const current = links[p.slug];
  const ltv = Math.round(p.estMonthlyCommissionUsd * p.estAvgRetentionMonths);

  const linkSection = current
    ? `<div class="current-link">現在のリンク: ${escapeHtml(maskUrl(current))}</div>
       <div class="row">
         <a href="${escapeHtml(config().site.baseUrl)}/go/${p.slug}/" target="_blank" rel="noopener">確認用リンクを開く ↗</a>
         <details><summary style="cursor:pointer;color:var(--muted);font-size:.82rem">URLを変更する</summary>
           <form method="POST" action="/link" class="row" style="margin-top:.5rem">
             <input type="hidden" name="slug" value="${escapeHtml(p.slug)}">
             <input type="url" name="url" placeholder="新しいアフィリエイトURL" required>
             <button class="primary" type="submit">保存して反映</button>
           </form>
         </details>
       </div>`
    : `<form method="POST" action="/link" class="row">
         <input type="hidden" name="slug" value="${escapeHtml(p.slug)}">
         <input type="url" name="url" placeholder="発行されたアフィリエイトURLを貼り付け" required>
         <button class="primary" type="submit">保存して反映</button>
       </form>`;

  return `<div class="card">
    <h3>${escapeHtml(p.name)}
      <span class="pill" style="background:${statusColor(p.status)}">${statusLabel(p.status)}</span>
    </h3>
    <div class="meta">
      ${escapeHtml(p.category)} · ${escapeHtml(p.network)} ·
      スコア <b>${p.score.toFixed(1)}</b> ·
      $${p.estMonthlyCommissionUsd}/月 × ${p.estAvgRetentionMonths}ヶ月 = 想定LTV <b>$${ltv}</b>
    </div>
    <div class="row">
      <a href="${escapeHtml(p.affiliateProgramUrl)}" target="_blank" rel="noopener">応募先(アフィリエイトプログラム) ↗</a>
      <a href="${escapeHtml(p.homepage)}" target="_blank" rel="noopener">公式サイト ↗</a>
      <form method="POST" action="/status" style="margin-left:auto">
        <input type="hidden" name="slug" value="${escapeHtml(p.slug)}">
        <select name="status" onchange="this.form.submit()">
          ${(["candidate", "awaiting_apply", "applied", "approved", "rejected", "paused"] as ProgramStatus[])
            .map((s) => `<option value="${s}" ${s === p.status ? "selected" : ""}>${statusLabel(s)}</option>`)
            .join("")}
        </select>
      </form>
    </div>
    ${linkSection}
  </div>`;
}

async function hasUncommittedChanges(): Promise<boolean> {
  const fs = await import("node:fs");
  const targets = ["data", "content", "assets", "config/affiliate-links.json", "TODO-HUMAN.md", "REPORT.md", "docs"];
  const existing = targets.filter((t) => fs.existsSync(`${P.root}/${t}`));
  if (existing.length === 0) return false;
  const status = await git(["status", "--porcelain", "--", ...existing]);
  return status.stdout.trim().length > 0;
}

async function renderIndex(flash?: { kind: "ok" | "bad"; text: string }): Promise<string> {
  const all = programs.all().sort((a, b) => b.score - a.score);
  const approved = all.filter((p) => p.status === "approved").length;
  const dirty = await hasUncommittedChanges();

  const body = `
<div class="topbar">
  <header>
    <div>
      <h1>${escapeHtml(config().site.name)} — 案件管理</h1>
      <div class="sub">${all.length} 件（承認済み ${approved} 件） · このページはあなたのPCだけで動いています</div>
    </div>
    <form method="POST" action="/commit">
      <button class="commit" type="submit">${dirty ? "未反映の変更をGitHubへ反映" : "GitHubへ反映（変更なし）"}</button>
    </form>
  </header>
</div>
${all.length === 0 ? '<div class="empty">案件がまだありません。`npm run autopilot research` を実行してください。</div>' : all.map(programCard).join("\n")}
`;
  return layout(body, flash);
}

/* ------------------------------------------------------------------ http */

function parseBody(req: http.IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(new URLSearchParams(data)));
    req.on("error", reject);
  });
}

function redirect(res: http.ServerResponse, path: string): void {
  res.writeHead(303, { Location: path });
  res.end();
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

    if (req.method === "GET" && url.pathname === "/") {
      const kind = url.searchParams.get("flash");
      const text = url.searchParams.get("msg");
      const flash = kind && text ? { kind: kind as "ok" | "bad", text } : undefined;
      const html = await renderIndex(flash);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "POST" && url.pathname === "/link") {
      const body = await parseBody(req);
      const slug = body.get("slug") ?? "";
      const link = body.get("url") ?? "";
      if (!slug || !link) return redirect(res, "/?flash=bad&msg=slugとURLの両方が必要です");

      setAffiliateLink(slug, link);
      programs.setStatus(slug, "approved");
      humanTasks.close(`apply-${slug}`);
      buildSite();

      const result = await commitAndPush(`admin: ${slug} のアフィリエイトリンクを登録`);
      const msg = result.ok
        ? `保存してGitHubに反映しました。忘れずにテストクリックで確認してください → /go/${slug}/`
        : `ローカルには保存しました。${result.detail}`;
      return redirect(res, `/?flash=${result.ok ? "ok" : "bad"}&msg=${encodeURIComponent(msg)}`);
    }

    if (req.method === "POST" && url.pathname === "/status") {
      const body = await parseBody(req);
      const slug = body.get("slug") ?? "";
      const status = body.get("status") as ProgramStatus | null;
      const valid: ProgramStatus[] = ["candidate", "awaiting_apply", "applied", "approved", "rejected", "paused"];
      if (!slug || !status || !valid.includes(status)) return redirect(res, "/?flash=bad&msg=不正な操作です");

      programs.setStatus(slug, status);
      const result = await commitAndPush(`admin: ${slug} のステータスを ${status} に変更`);
      return redirect(res, `/?flash=${result.ok ? "ok" : "bad"}&msg=${encodeURIComponent(result.detail)}`);
    }

    if (req.method === "POST" && url.pathname === "/commit") {
      const result = await commitAndPush("admin: 手動で反映");
      return redirect(res, `/?flash=${result.ok ? "ok" : "bad"}&msg=${encodeURIComponent(result.detail)}`);
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  } catch (err) {
    log.error(`管理画面でエラー: ${(err as Error).message}`);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("internal error");
  }
});

ensureDirs();
server.listen(PORT, HOST, () => {
  log.step("管理画面を起動しました");
  log.ok(`http://localhost:${PORT} を開いてください`);
  log.info("Ctrl+C で終了します。このページは外部には公開されません。");
});
