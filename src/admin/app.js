/*
 * 管理画面のフロントエンド。
 *
 * このファイルは素の JavaScript です。TypeScript のテンプレートリテラルの中に
 * 書くと、バッククォートと ${} を全部エスケープする必要があり、
 * 一文字ミスするだけで壊れます。別ファイルにして、その問題自体をなくしています。
 *
 * page.ts がビルド時にこの中身をそのまま <script> に埋め込みます。
 * OWNER / REPO / BRANCH / SITE_NAME / BASE_URL は page.ts 側で定義済みです。
 */


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
  const bin = atob(b64.replace(/\n/g, ""));
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
  const res = await gh(`/repos/${OWNER}/${REPO}/contents/${path}?ref=${encodeURIComponent(BRANCH)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path} の取得に失敗 (HTTP ${res.status})`);
  const json = await res.json();
  return { json: JSON.parse(b64decodeUtf8(json.content)), sha: json.sha };
}

/** ファイルを書く(無ければ新規作成、あれば更新)。 */
async function putFile(path, obj, sha, message) {
  const body = {
    message,
    content: b64encodeUtf8(JSON.stringify(obj, null, 2) + "\n"),
    branch: BRANCH,
    ...(sha ? { sha } : {}),
  };
  const res = await gh(`/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    if (res.status === 409 || res.status === 422) {
      throw new Error(`${path} が他の変更と競合しました。ページを再読み込みしてやり直してください。`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("トークンが無効か、権限が不足しています(Contents: Read and write が必要です)。");
    }
    throw new Error(`${path} の保存に失敗しました: ${detail.message || res.status}`);
  }
  return res.json();
}

async function dispatchRebuild() {
  const res = await gh(`/repos/${OWNER}/${REPO}/actions/workflows/${REBUILD_WORKFLOW}/dispatches`, {
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
  app.innerHTML = `
    <div class="gate">
      <h1>${esc(SITE_NAME)} — 管理画面</h1>
      <div class="banner warn">
        このページはあなた専用です。GitHub の個人アクセストークン(PAT)を入力すると、
        あなたのブラウザから直接 GitHub を読み書きします。
        <b>トークンはこの端末のブラウザにだけ保存され、他のどこにも送信されません。</b>
      </div>
      ${errorMsg ? `<div class="banner bad">${esc(errorMsg)}</div>` : ""}
      <ol>
        <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">
          Fine-grained personal access token を新規作成 ↗</a></li>
        <li>Repository access は「Only select repositories」→ <code>${esc(OWNER)}/${esc(REPO)}</code> だけを選ぶ</li>
        <li>Permissions で <code>Contents: Read and write</code> と
          <code>Actions: Read and write</code> を設定</li>
        <li>有効期限は短め(90日など)にしておく</li>
        <li>発行されたトークン(<code>github_pat_...</code>)を下に貼る</li>
      </ol>
      <div class="row">
        <input type="password" id="tokenInput" placeholder="github_pat_...">
        <button class="primary" id="tokenSave">保存して開く</button>
      </div>
    </div>`;
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
    .map((s) => `<option value="${s}" ${s === p.status ? "selected" : ""}>${STATUS_LABEL[s]}</option>`)
    .join("");

  const linkSection = current
    ? `<div class="current-link">現在のリンク: ${esc(maskUrl(current))}</div>
       <div class="row">
         <a href="${esc(BASE_URL)}/go/${esc(p.slug)}/" target="_blank" rel="noopener">確認用リンクを開く ↗</a>
         <details><summary style="cursor:pointer;color:var(--muted);font-size:.82rem">URLを変更する</summary>
           <div class="row" style="margin-top:.5rem">
             <input type="url" class="linkInput" data-slug="${esc(p.slug)}" placeholder="新しいアフィリエイトURL">
             <button class="primary saveLinkBtn" data-slug="${esc(p.slug)}">保存して反映</button>
           </div>
         </details>
       </div>`
    : `<div class="row">
         <input type="url" class="linkInput" data-slug="${esc(p.slug)}" placeholder="発行されたアフィリエイトURLを貼り付け">
         <button class="primary saveLinkBtn" data-slug="${esc(p.slug)}">保存して反映</button>
       </div>`;

  return `<div class="card" data-card="${esc(p.slug)}">
    <h3>${esc(p.name)}
      <span class="pill" style="background:${STATUS_COLOR[p.status]}">${STATUS_LABEL[p.status]}</span>
    </h3>
    <div class="meta">
      ${esc(p.category)} · ${esc(p.network)} ·
      スコア <b>${p.score.toFixed(1)}</b> ·
      $${p.estMonthlyCommissionUsd}/月 × ${p.estAvgRetentionMonths}ヶ月 = 想定LTV <b>$${ltv}</b>
    </div>
    <div class="row">
      <a href="${esc(p.affiliateProgramUrl)}" target="_blank" rel="noopener">応募先 ↗</a>
      <a href="${esc(p.homepage)}" target="_blank" rel="noopener">公式サイト ↗</a>
      <select class="statusSelect" data-slug="${esc(p.slug)}" style="margin-left:auto">${statusOptions}</select>
    </div>
    ${linkSection}
  </div>`;
}

let STATE = null;
let TAB = "approvals";

async function loadState() {
  const [programs, links, humanTasks, approvals, limits, errors, articles, pins, tasks] =
    await Promise.all([
      getFile("data/programs.json"),
      getFile("config/affiliate-links.json"),
      getFile("data/human-tasks.json"),
      getFile("data/approvals.json"),
      getFile("config/limits.json"),
      getFile("data/errors.json"),
      getFile("data/articles.json"),
      getFile("data/pins.json"),
      getFile("data/tasks.json"),
    ]);
  STATE = {
    programs:   programs   || { json: [], sha: null },
    links:      links      || { json: { links: {} }, sha: null },
    humanTasks: humanTasks || { json: [], sha: null },
    approvals:  approvals  || { json: [], sha: null },
    limits:     limits     || { json: null, sha: null },
    errors:     errors     || { json: [], sha: null },
    articles:   articles   || { json: [], sha: null },
    pins:       pins       || { json: [], sha: null },
    tasks:      tasks      || { json: [], sha: null },
  };
}

/* ------------------------------------------------------------ 承認カード */

function money(v) { return v === null || v === undefined ? "—" : "$" + Number(v).toLocaleString(); }
function pctOf(v) { return v === null || v === undefined ? "—" : v + "%"; }

function approvalCard(a) {
  const e = a.expected || {};
  const hours = Math.max(0, Math.round((new Date(a.expiresAt) - Date.now()) / 3600000));
  return `<div class="approval" data-apv="${esc(a.id)}">
    <h3>${esc(a.title)}</h3>
    <div class="when">あと約 ${hours} 時間で期限切れ（期限を過ぎたら実行しません）</div>

    <section>
      <h4>やること</h4>
      <ul>${(a.whatWillHappen || []).map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
    </section>

    <section>
      <h4>なぜこれか</h4>
      <p>${esc(a.whyThis)}</p>
    </section>

    <section>
      <h4>お金の見込み</h4>
      <dl class="money">
        ${e.programName ? `<dt>案件</dt><dd>${esc(e.programName)}</dd>` : ""}
        <dt>月額報酬</dt><dd>${money(e.monthlyCommissionUsd)}</dd>
        <dt>想定継続</dt><dd>${e.retentionMonths ? e.retentionMonths + " ヶ月" : "—"}</dd>
        <dt>想定LTV</dt><dd>${money(e.ltvUsd)}</dd>
        <dt>推定CTR</dt><dd>${pctOf(e.estimatedCtrPct)}</dd>
        <dt>推定成約率</dt><dd>${pctOf(e.estimatedConversionPct)}</dd>
        <dt>推定収益</dt><dd>${e.estimatedRevenueUsdMin === null || e.estimatedRevenueUsdMin === undefined
          ? "—" : money(e.estimatedRevenueUsdMin) + " 〜 " + money(e.estimatedRevenueUsdMax)}</dd>
        <dt>かかる費用</dt><dd>${money(a.costUsd)}</dd>
      </dl>
    </section>

    <section>
      <h4>この見込みの根拠</h4>
      <p>${esc(e.basis || "—")}</p>
    </section>

    ${(a.risks || []).length ? `<section>
      <h4>気をつける点</h4>
      <ul class="risk">${a.risks.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
    </section>` : ""}

    <section>
      <h4>断った場合</h4>
      <p>${esc(a.ifYouSayNo)}</p>
    </section>

    <div class="decide">
      <button class="go decideBtn" data-apv="${esc(a.id)}" data-d="go">GO（やる）</button>
      <button class="stop decideBtn" data-apv="${esc(a.id)}" data-d="stop">STOP（やらない）</button>
    </div>
  </div>`;
}

/* -------------------------------------------------------------- タブ本体 */

function viewApprovals() {
  const pending = (STATE.approvals.json || []).filter((a) => a.status === "pending");
  if (pending.length === 0) {
    return `<div class="banner ok">
      <b>いま判断が必要なことはありません。</b><br>
      AI社員が調査・執筆・検品を進めています。次の提案が出たらここに表示されます。
    </div>`;
  }
  return pending.map(approvalCard).join("");
}

function viewStatus() {
  const pins = STATE.pins.json || [];
  const arts = STATE.articles.json || [];
  const progs = STATE.programs.json || [];
  const errs = (STATE.errors.json || []).filter((e) => !e.handled);
  const openTasks = (STATE.tasks.json || []).filter((t) =>
    ["blocked", "ready", "running"].includes(t.status));
  const approved = progs.filter((p) => p.status === "approved").length;
  const published = pins.filter((p) => p.status === "published").length;
  const links = Object.keys((STATE.links.json || {}).links || {}).length;
  const openHuman = (STATE.humanTasks.json || []).filter((t) => t.status === "open");

  const blocker = links === 0 ? `<div class="banner bad">
      <b>アフィリエイトリンクが1件も登録されていません。</b><br>
      この状態では、記事を何本書いても収益は発生しません。
      アフィリエイトプログラムに応募して承認をもらい、発行されたリンクを
      「案件」タブで登録してください。これは人間にしかできない作業です。
    </div>` : "";

  return blocker + `
    <div class="stats">
      <div class="stat"><div class="n">${progs.length}</div><div class="l">案件（承認済み ${approved}）</div></div>
      <div class="stat"><div class="n">${arts.length}</div><div class="l">記事</div></div>
      <div class="stat"><div class="n">${pins.length}</div><div class="l">ピン（投稿済み ${published}）</div></div>
      <div class="stat"><div class="n">${openTasks.length}</div><div class="l">進行中の仕事</div></div>
      <div class="stat ${errs.length ? "warn" : ""}"><div class="n">${errs.length}</div><div class="l">未処理の失敗</div></div>
      <div class="stat ${links === 0 ? "bad" : ""}"><div class="n">${links}</div><div class="l">登録済みリンク</div></div>
    </div>

    <div class="card">
      <h3>あなたがやること</h3>
      ${openHuman.length === 0
        ? '<div class="meta">ありません。</div>'
        : `<ul>${openHuman.map((t) =>
            `<li>${esc(t.title)} <span class="meta">（約${t.minutes}分）</span></li>`).join("")}</ul>
           <div class="meta" style="margin-top:.6rem">
             詳しい手順は、リポジトリの <code>TODO-HUMAN.md</code> に書いてあります。
           </div>`}
    </div>

    ${errs.length ? `<div class="card">
      <h3>最近の失敗</h3>
      ${errs.slice(0, 8).map((e) => `<div class="err">
        <div class="w">${esc(String(e.at || "").slice(0, 16).replace("T", " "))} · ${esc(e.where)}</div>
        ${esc(String(e.message || "").slice(0, 300))}
      </div>`).join("")}
      <div class="meta" style="margin-top:.7rem">
        直し方が分からないときは、この文をそのまま Claude Code のセッションに貼って相談してください。
        自分で原因を調べる必要はありません。
      </div>
    </div>` : ""}

    ${killSwitchPanel()}
  `;
}

function killSwitchPanel() {
  const l = STATE.limits.json;
  if (!l) {
    return `<div class="danger"><h3>安全装置</h3>
      <div class="meta">config/limits.json が読めませんでした。</div></div>`;
  }
  const on = l.killSwitch && l.killSwitch.enabled;
  return `<div class="danger">
    <h3>${on ? "会社は停止中です" : "緊急停止"}</h3>
    <div class="meta">
      ${on
        ? `理由: ${esc(l.killSwitch.reason || "(未記入)")}<br>
           AI社員の実行と、投稿・公開の処理がすべて止まっています。`
        : "押すと、AI社員の実行と、投稿・公開の処理がすべて止まります。<br>" +
          "何かおかしいと感じたら、迷わず押してください。あとから再開できます。"}
    </div>
    <button id="killBtn" class="${on ? "resume" : ""}">
      ${on ? "会社を再開する" : "すべて止める"}
    </button>
  </div>`;
}

function viewPrograms() {
  const all = [...(STATE.programs.json || [])].sort((a, b) => b.score - a.score);
  if (all.length === 0) {
    return '<div class="empty">案件がまだありません。AI社員のリサーチを待ってください。</div>';
  }
  return all.map((p) => programCard(p, (STATE.links.json || {}).links || {})).join("");
}

/* ------------------------------------------------------------- 描画本体 */

function render(flash) {
  const pendingCount = (STATE.approvals.json || []).filter((a) => a.status === "pending").length;
  const killed = STATE.limits.json && STATE.limits.json.killSwitch && STATE.limits.json.killSwitch.enabled;
  const tabs = [["approvals", "承認", pendingCount], ["status", "状態", 0], ["programs", "案件", 0]];

  app.innerHTML = `
    ${flash ? `<div class="banner ${flash.kind}">${flash.busy ? '<span class="spin"></span>' : ""}${esc(flash.text)}</div>` : ""}
    ${killed ? '<div class="banner bad"><b>会社は停止中です。</b>「状態」タブから再開できます。</div>' : ""}
    <header>
      <div>
        <h1>${esc(SITE_NAME)}</h1>
        <div class="sub">${esc(OWNER)}/${esc(REPO)}@${esc(BRANCH)}</div>
      </div>
      <button id="logoutBtn">ログアウト</button>
    </header>
    <nav class="tabs">
      ${tabs.map(([id, label, n]) =>
        `<button class="tabBtn ${TAB === id ? "active" : ""}" data-tab="${id}">
          ${label}${n > 0 ? `<span class="badge">${n}</span>` : ""}
        </button>`).join("")}
    </nav>
    ${TAB === "approvals" ? viewApprovals() : TAB === "status" ? viewStatus() : viewPrograms()}
  `;

  document.getElementById("logoutBtn").onclick = () => { clearToken(); location.reload(); };
  document.querySelectorAll(".tabBtn").forEach((b) => {
    b.onclick = () => { TAB = b.dataset.tab; render(); };
  });
  document.querySelectorAll(".decideBtn").forEach((b) => {
    b.onclick = () => decide(b.dataset.apv, b.dataset.d);
  });
  const kill = document.getElementById("killBtn");
  if (kill) kill.onclick = toggleKillSwitch;
  document.querySelectorAll(".saveLinkBtn").forEach((btn) => {
    btn.onclick = () => {
      const slug = btn.dataset.slug;
      const input = document.querySelector(`.linkInput[data-slug="${slug}"]`);
      const url = input.value.trim();
      if (!url) return;
      saveLink(slug, url);
    };
  });
  document.querySelectorAll(".statusSelect").forEach((sel) => {
    sel.onchange = () => saveStatus(sel.dataset.slug, sel.value);
  });
}

/* --------------------------------------------------------------- 書き込み */

/**
 * GO / STOP。
 * co の approval:decide と同じことを、ブラウザから GitHub API 経由で行う。
 * STOP のときは紐づくタスクも取り下げる（承認されなかった仕事は実行しない）。
 */
async function decide(id, decision) {
  const label = decision === "go" ? "GO" : "STOP";
  if (!confirm(label + " でよろしいですか？")) return;
  render({ kind: "warn", text: label + " を記録しています…", busy: true });
  try {
    const list = STATE.approvals.json;
    const a = list.find((x) => x.id === id);
    if (!a) throw new Error("承認依頼が見つかりません。ページを再読み込みしてください。");
    if (a.status !== "pending") throw new Error("この依頼はすでに " + a.status + " です。");

    a.status = decision;
    a.decidedAt = new Date().toISOString();
    a.decidedBy = "human";
    a.decisionNote = null;

    const put = await putFile("data/approvals.json", list, STATE.approvals.sha,
      "admin: " + id + " を " + decision + " に決裁");
    STATE.approvals.sha = put.content.sha;

    if (decision === "stop") {
      const tasks = STATE.tasks.json || [];
      let changed = 0;
      for (const t of tasks) {
        if (t.requiresApprovalId === id && ["blocked", "ready"].includes(t.status)) {
          t.status = "cancelled";
          t.finishedAt = new Date().toISOString();
          t.lastError = "承認が却下されました";
          changed++;
        }
      }
      if (changed) {
        const pt = await putFile("data/tasks.json", tasks, STATE.tasks.sha,
          "admin: " + id + " の却下に伴い " + changed + " 件のタスクを取り下げ");
        STATE.tasks.sha = pt.content.sha;
      }
    }

    render({
      kind: "ok",
      text: decision === "go"
        ? "GO を記録しました。AI社員が次のルーチンで実行します。"
        : "STOP を記録しました。この仕事は実行されません。",
    });
  } catch (err) {
    render({ kind: "bad", text: String(err.message || err) });
  }
}

/** 緊急停止 / 再開 */
async function toggleKillSwitch() {
  const l = STATE.limits.json;
  const on = l.killSwitch && l.killSwitch.enabled;
  if (!confirm(on ? "会社を再開しますか？" : "すべての自動処理を止めますか？")) return;

  let reason = "";
  if (!on) reason = prompt("止める理由（あとで見返すためのメモ。空でも構いません）") || "";

  render({ kind: "warn", text: on ? "再開しています…" : "停止しています…", busy: true });
  try {
    l.killSwitch = on
      ? { enabled: false, reason: "" }
      : { enabled: true, reason: reason + " (" + new Date().toISOString().slice(0, 10) + " 管理画面から停止)" };
    const put = await putFile("config/limits.json", l, STATE.limits.sha,
      on ? "admin: 会社を再開" : "admin: 緊急停止");
    STATE.limits.sha = put.content.sha;
    render({ kind: on ? "ok" : "bad", text: on ? "再開しました。" : "すべての自動処理を停止しました。" });
  } catch (err) {
    render({ kind: "bad", text: String(err.message || err) });
  }
}

async function saveLink(slug, url) {
  render({ kind: "warn", text: slug + " を保存中…", busy: true });
  try {
    STATE.links.json.links = STATE.links.json.links || {};
    STATE.links.json.links[slug] = url;
    const putLinks = await putFile("config/affiliate-links.json", STATE.links.json, STATE.links.sha,
      "admin: " + slug + " のアフィリエイトリンクを登録");
    STATE.links.sha = putLinks.content.sha;

    const idx = STATE.programs.json.findIndex((p) => p.slug === slug);
    if (idx !== -1) STATE.programs.json[idx].status = "approved";
    const putPrograms = await putFile("data/programs.json", STATE.programs.json, STATE.programs.sha,
      "admin: " + slug + " を承認済みに変更");
    STATE.programs.sha = putPrograms.content.sha;

    const taskIdx = STATE.humanTasks.json.findIndex((t) => t.id === "apply-" + slug);
    if (taskIdx !== -1) {
      STATE.humanTasks.json[taskIdx].status = "done";
      STATE.humanTasks.json[taskIdx].doneAt = new Date().toISOString();
      const putTasks = await putFile("data/human-tasks.json", STATE.humanTasks.json, STATE.humanTasks.sha,
        "admin: " + slug + " のタスクを完了に");
      STATE.humanTasks.sha = putTasks.content.sha;
    }

    render({ kind: "warn", text: "サイトを再公開しています…", busy: true });
    await dispatchRebuild();
    render({ kind: "ok", text: "保存しました。1〜2分でサイトに反映されます。確認用リンク /go/" + slug + "/ でテストクリックしてください。" });
  } catch (err) {
    render({ kind: "bad", text: String(err.message || err) });
  }
}

async function saveStatus(slug, status) {
  render({ kind: "warn", text: slug + " を更新中…", busy: true });
  try {
    const idx = STATE.programs.json.findIndex((p) => p.slug === slug);
    if (idx !== -1) STATE.programs.json[idx].status = status;
    const put = await putFile("data/programs.json", STATE.programs.json, STATE.programs.sha,
      "admin: " + slug + " のステータスを " + status + " に変更");
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
    // 判断が必要なことがあれば承認タブ、なければ状態タブから始める
    const pending = (STATE.approvals.json || []).filter((a) => a.status === "pending").length;
    TAB = pending > 0 ? "approvals" : "status";
    render();
  } catch (err) {
    renderGate("読み込みに失敗しました: " + (err.message || err));
  }
}
boot();
