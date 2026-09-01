/*
 * 代表取締役デスク（管理画面）のフロントエンド。
 *
 * このファイルは素の JavaScript です。TypeScript のテンプレートリテラルの中に
 * 書くと、バッククォートと ${} を全部エスケープする必要があり、
 * 一文字ミスするだけで壊れます。別ファイルにして、その問題自体をなくしています。
 *
 * page.ts がビルド時にこの中身をそのまま <script> に埋め込みます。
 * OWNER / REPO / BRANCH / SITE_NAME / BASE_URL / REBUILD_WORKFLOW /
 * PINS_WORKFLOW / RAW_BASE / TOKEN_KEY は page.ts 側で定義済みです。
 *
 * ★この画面の役割は3つです。
 *   1. 承認         … GO / STOP を押す（AIが外に出す前の関門）
 *   2. 案件（応募）  … AIが調べた案件に、なおきさんが応募してURLを登録する
 *   3. 投稿の確認    … 何が出るのか／出たのかを眺める。おかしければ取り消す
 *
 *   3番は「眺めるだけ」が基本です。承認は要りません。
 *   取り消しボタンは、万が一のときの非常口として置いてあります。
 */

const STATUS_LABEL = {
  candidate: "未応募", awaiting_apply: "応募文あり・未応募", applied: "審査中",
  approved: "承認済み", rejected: "却下", paused: "保留",
};
const STATUS_COLOR = {
  candidate: "#94a3b8", awaiting_apply: "#f59e0b", applied: "#3b82f6",
  approved: "#16a34a", rejected: "#dc2626", paused: "#71717a",
};

const PIN_LABEL = {
  draft: "文案だけ", queued: "予約待ち", scheduled: "投稿予約中", published: "投稿済み",
  failed: "投稿に失敗", skipped: "取り消し済み", taken_down: "削除済み",
};
const PIN_COLOR = {
  draft: "#94a3b8", queued: "#8b5cf6", scheduled: "#3b82f6", published: "#16a34a",
  failed: "#dc2626", skipped: "#71717a", taken_down: "#71717a",
};

const ART_LABEL = {
  brief: "企画だけ", drafted: "下書き", needs_review: "確認待ち",
  published: "公開中", withdrawn: "取り下げ済み",
};
const ART_COLOR = {
  brief: "#94a3b8", drafted: "#8b5cf6", needs_review: "#f59e0b",
  published: "#16a34a", withdrawn: "#71717a",
};

function esc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

/** 2026-08-31T04:00:00Z → 8/31 13:00（見る人の時計に合わせる） */
function when(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return String(iso).slice(0, 16).replace("T", " ");
  return (d.getMonth() + 1) + "/" + d.getDate() + " " +
    String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

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

/** JSON ファイルを読む。無ければ null を返す(初回はまだ存在しないファイルがある)。 */
async function getFile(path) {
  const res = await gh(`/repos/${OWNER}/${REPO}/contents/${path}?ref=${encodeURIComponent(BRANCH)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path} の取得に失敗 (HTTP ${res.status})`);
  const json = await res.json();
  return { json: JSON.parse(b64decodeUtf8(json.content)), sha: json.sha };
}

/** テキストファイル（記事の本文など）をそのまま読む。 */
async function getText(path) {
  const res = await gh(`/repos/${OWNER}/${REPO}/contents/${path}?ref=${encodeURIComponent(BRANCH)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path} の取得に失敗 (HTTP ${res.status})`);
  const json = await res.json();
  return b64decodeUtf8(json.content);
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

async function dispatchWorkflow(file, whatFor) {
  const res = await gh(`/repos/${OWNER}/${REPO}/actions/workflows/${file}/dispatches`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: BRANCH }),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(whatFor + "の起動に失敗しました(トークンに Actions: Read and write の権限が必要です)。記録自体は保存できています。");
    }
    throw new Error(whatFor + "の起動に失敗しました。記録自体は保存できています。GitHub の Actions タブから手動で実行してください。");
  }
}

async function dispatchRebuild() {
  await dispatchWorkflow(REBUILD_WORKFLOW, "サイトの再公開");
}

/* ------------------------------------------------------------ rendering */

const app = document.getElementById("app");

function renderGate(errorMsg) {
  app.innerHTML = `
    <div class="gate">
      <h1>${esc(SITE_NAME)} — 代表取締役デスク</h1>
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

/* ---------------------------------------------------------- 案件（応募） */

/**
 * 応募カード。
 * 「どこに応募するのか」「なぜこの案件なのか」「発行されたURLをどこに貼るのか」を
 * 1枚で完結させる。なおきさんが他の画面を行き来しなくて済むようにするため。
 */
function programCard(p, links) {
  const current = links[p.slug];
  const ltv = Math.round(p.estMonthlyCommissionUsd * p.estAvgRetentionMonths);
  const statusOptions = Object.keys(STATUS_LABEL)
    .map((s) => `<option value="${s}" ${s === p.status ? "selected" : ""}>${STATUS_LABEL[s]}</option>`)
    .join("");

  const model = { recurring: "継続報酬（毎月入る）", "one-time": "単発報酬（1回だけ）",
    hybrid: "初回＋継続", unknown: "未確認" }[p.commissionModel] || p.commissionModel;

  const evidence = (p.evidence || []).length
    ? `<details><summary>この数字の出典を見る（${p.evidence.length}件）</summary>
         <div class="note">${p.evidence.map((u) =>
           `<div><a href="${esc(u)}" target="_blank" rel="noopener">${esc(maskUrl(u))} ↗</a></div>`).join("")}</div>
       </details>`
    : `<div class="note">出典URLが登録されていません。数字は参考値として扱ってください。</div>`;

  // 登録済みなら「変更する」を畳んでおく。押し間違いで消えないように。
  const linkSection = current
    ? `<div class="current-link">登録済みのリンク: ${esc(maskUrl(current))}</div>
       <div class="row">
         <a href="${esc(BASE_URL)}/go/${esc(p.slug)}/" target="_blank" rel="noopener">
           テスト用に開いてみる ↗</a>
         <details><summary>URLを変更する</summary>
           <div class="row" style="margin-top:.5rem">
             <input type="url" class="linkInput" data-slug="${esc(p.slug)}" placeholder="新しいアフィリエイトURL">
             <button class="primary saveLinkBtn" data-slug="${esc(p.slug)}">保存して反映</button>
           </div>
         </details>
       </div>`
    : `<h4 style="margin-top:1rem">③ 発行されたアフィリエイトURLを貼る</h4>
       <div class="row">
         <input type="url" class="linkInput" data-slug="${esc(p.slug)}"
           placeholder="https://... （審査に通ると発行されます）">
         <button class="primary saveLinkBtn" data-slug="${esc(p.slug)}">保存して反映</button>
       </div>
       <div class="note">
         保存すると、この案件は自動で「承認済み」になり、記事の中のリンクが
         1〜2分で本物のアフィリエイトURLに差し替わります。
       </div>`;

  // ネットワークごとに、自動発行に必要なものが違う。
  // 何を貼ればよいかを、その場で1つだけ聞く（複数聞くと手が止まるため）。
  const ref = p.linkRef || {};
  const AUTO = {
    Impact:      { auto: true,  what: "Impact のAPIキーが登録されていれば、リンクは自動で発行されます。貼る作業はありません。" },
    Awin:        { auto: true,  what: "Awin のAPIトークンが登録されていれば、リンクは自動で発行されます。貼る作業はありません。" },
    ShareASale:  { auto: true,  what: "ShareASale は2025年10月に閉鎖され Awin に統合されました。Awin 側の広告主IDを使います。" },
    PartnerStack:{ auto: false, field: "partnerstackBaseUrl", label: "PartnerStack の紹介リンク",
                   ph: "https://... （ダッシュボードからコピー）",
                   what: "PartnerStack はパートナー用のAPIがありません。<b>1回だけ</b>貼ってください。以降は自動です。" },
    Rewardful:   { auto: false, field: "rewardfulVia", label: "Rewardful の via トークン",
                   ph: "例: workedforus",
                   what: "承認メールのリンク（例 https://…/?via=<b>abc123</b>）の太字部分だけを、<b>1回だけ</b>貼ってください。以降は自動です。" },
  }[p.network];

  const autoRow = !AUTO ? "" : AUTO.auto
    ? `<div class="note" style="margin-top:.8rem">🤖 ${AUTO.what}</div>`
    : `<h4 style="margin-top:1rem">自動発行の設定（1回だけ）</h4>
       <div class="note">${AUTO.what}</div>
       <div class="row">
         <input type="text" class="refInput" data-slug="${esc(p.slug)}" data-field="${AUTO.field}"
           value="${esc(ref[AUTO.field] || "")}" placeholder="${esc(AUTO.ph)}">
         <button class="saveRefBtn" data-slug="${esc(p.slug)}" data-field="${AUTO.field}">保存</button>
       </div>`;

  const applyRow = current ? "" : `
    <h4 style="margin-top:1rem">② 応募する（ここは人にしかできません）</h4>
    <div class="row">
      <a href="${esc(p.affiliateProgramUrl)}" target="_blank" rel="noopener">
        <button class="primary">応募ページを開く ↗</button></a>
      <button class="markAppliedBtn" data-slug="${esc(p.slug)}">応募しました（審査待ちにする）</button>
    </div>`;

  return `<div class="card" data-card="${esc(p.slug)}">
    <h3>${esc(p.name)}
      <span class="pill" style="background:${STATUS_COLOR[p.status] || "#71717a"}">
        ${esc(STATUS_LABEL[p.status] || p.status)}</span>
    </h3>
    <div class="meta">
      ${esc(p.category)} · ${esc(p.network)} · スコア <b>${Number(p.score).toFixed(1)}</b>
    </div>

    <h4>① この案件を英世（CMO）が選んだ理由</h4>
    <p style="margin:.2rem 0 .6rem">${esc(p.whyGoodFit)}</p>
    <dl class="money">
      <dt>報酬の型</dt><dd>${esc(model)}</dd>
      <dt>報酬率</dt><dd>${p.commissionRatePct === null || p.commissionRatePct === undefined ? "未確認" : p.commissionRatePct + "%"}</dd>
      <dt>1件あたり</dt><dd>$${p.estMonthlyCommissionUsd}/月 × ${p.estAvgRetentionMonths}ヶ月 = <b>$${ltv}</b></dd>
      <dt>クッキー</dt><dd>${p.cookieDays === null || p.cookieDays === undefined ? "未確認" : p.cookieDays + "日"}</dd>
      <dt>日本語の競合</dt><dd>${p.japaneseCompetition}/10（低いほど狙い目）</dd>
    </dl>
    ${evidence}
    <div class="row">
      <a href="${esc(p.homepage)}" target="_blank" rel="noopener">公式サイト ↗</a>
      <a href="${esc(p.affiliateProgramUrl)}" target="_blank" rel="noopener">応募先 ↗</a>
      <select class="statusSelect" data-slug="${esc(p.slug)}" style="margin-left:auto">${statusOptions}</select>
    </div>
    ${applyRow}
    ${autoRow}
    ${linkSection}
  </div>`;
}

let STATE = null;
let TAB = "review";
/** 記事本文のキャッシュ（開いたものだけ読む。毎回全部読むと遅いため） */
const BODY_CACHE = {};
const BODY_OPEN = {};

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

/* -------------------------------------------------------- 投稿の確認タブ */

function articleCard(a) {
  const open = BODY_OPEN[a.slug];
  const body = BODY_CACHE[a.slug];
  const live = a.status === "published";
  const url = BASE_URL + "/" + a.slug + "/";

  const bodyBlock = !open ? "" : (body === undefined
    ? `<div class="article-body"><span class="spin"></span>本文を読み込んでいます…</div>`
    : body === null
      ? `<div class="article-body">本文ファイルが見つかりませんでした: ${esc(a.filePath)}</div>`
      : `<div class="article-body">${esc(body)}</div>`);

  const actions = live
    ? `<button class="danger withdrawBtn" data-slug="${esc(a.slug)}">この記事をサイトから取り下げる</button>`
    : a.status === "withdrawn"
      ? `<button class="republishBtn" data-slug="${esc(a.slug)}">やっぱり公開する</button>`
      : "";

  return `<div class="card">
    <h3>${esc(a.title)}
      <span class="pill" style="background:${ART_COLOR[a.status] || "#71717a"}">
        ${esc(ART_LABEL[a.status] || a.status)}</span>
    </h3>
    <div class="meta">
      ${a.words} 語 · 更新 ${esc(when(a.updatedAt))} ·
      <code>${esc(a.slug)}</code>
      ${(a.qualityIssues || []).length ? ` · <b style="color:var(--warn)">要確認 ${a.qualityIssues.length}件</b>` : ""}
    </div>
    ${a.withdrawnAt ? `<div class="note">${esc(when(a.withdrawnAt))} に取り下げました。${a.withdrawnReason ? "理由: " + esc(a.withdrawnReason) : ""}</div>` : ""}
    <div class="row">
      <button class="bodyBtn" data-slug="${esc(a.slug)}">${open ? "本文を閉じる" : "本文を読む"}</button>
      ${live ? `<a href="${esc(url)}" target="_blank" rel="noopener">公開ページを開く ↗</a>` : ""}
      ${actions}
    </div>
    ${bodyBlock}
  </div>`;
}

function pinCard(p) {
  const gone = ["skipped", "taken_down", "failed"].includes(p.status);
  const posted = p.status === "published";
  const pending = ["draft", "queued", "scheduled"].includes(p.status);

  let actions = "";
  if (pending) {
    actions = `<button class="danger cancelPinBtn" data-id="${esc(p.id)}">この投稿をやめる</button>`;
  } else if (posted && !p.takedownRequestedAt) {
    actions = `<button class="danger takedownBtn" data-id="${esc(p.id)}">Pinterestから削除する</button>`;
  } else if (posted && p.takedownRequestedAt) {
    actions = `<span class="note">削除を依頼済み（${esc(when(p.takedownRequestedAt))}）。次の自動実行で消えます。</span>`;
  } else if (p.status === "skipped") {
    actions = `<button class="restorePinBtn" data-id="${esc(p.id)}">やっぱり投稿する</button>`;
  }

  const link = posted && p.pinterestPinId
    ? `<a href="https://www.pinterest.com/pin/${esc(p.pinterestPinId)}/" target="_blank" rel="noopener">Pinterestで見る ↗</a>`
    : "";

  return `<div class="pin ${gone ? "gone" : ""}">
    <img src="${esc(RAW_BASE + p.imagePath)}" alt="" loading="lazy"
         onerror="this.style.visibility='hidden'">
    <div class="body">
      <div class="t">${esc(p.title)}
        <span class="pill" style="background:${PIN_COLOR[p.status] || "#71717a"}">
          ${esc(PIN_LABEL[p.status] || p.status)}</span>
      </div>
      <div class="d">${esc(p.description)}</div>
      <div class="meta">
        ${posted ? "投稿 " + esc(when(p.publishedAt)) : "予約 " + esc(when(p.scheduledAt))}
        · ボード「${esc(p.boardName)}」
        ${p.metrics ? ` · 表示 ${p.metrics.impressions} · クリック ${p.metrics.outboundClicks}` : ""}
      </div>
      <div class="meta">リンク先: ${esc(maskUrl(p.destinationUrl))}</div>
      ${p.lastError ? `<div class="note" style="color:var(--bad)">${esc(p.lastError)}</div>` : ""}
      <div class="row">${link}${actions}</div>
    </div>
  </div>`;
}

function viewReview() {
  const arts = STATE.articles.json || [];
  const pins = STATE.pins.json || [];

  const order = { published: 0, needs_review: 1, drafted: 2, brief: 3, withdrawn: 4 };
  const sortedArts = [...arts].sort((a, b) =>
    (order[a.status] ?? 9) - (order[b.status] ?? 9) ||
    String(b.updatedAt).localeCompare(String(a.updatedAt)));

  const pending = pins.filter((p) => ["draft", "queued", "scheduled"].includes(p.status))
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
  const posted = pins.filter((p) => p.status === "published")
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  const others = pins.filter((p) => ["skipped", "taken_down", "failed"].includes(p.status));

  const intro = `<div class="banner">
    <b>ここは「眺めるだけ」の画面です。あなたの承認は要りません。</b><br>
    AI社員が作った文章と、これから出る／すでに出た投稿を、そのまま表示しています。
    おかしいと思ったら、赤いボタンで取り消せます。<b>取り消しに理由の説明は要りません。</b>
  </div>`;

  const artSection = `
    <div class="section-title">記事（サイトに出る文章）
      <span class="count">${sortedArts.length}本</span></div>
    ${sortedArts.length === 0
      ? '<div class="empty">まだ記事がありません。一葉（CTO）が書き、梅子（CQO）が検品したものがここに出ます。</div>'
      : sortedArts.map(articleCard).join("")}`;

  const pinSection = `
    <div class="section-title">これから投稿するピン
      <span class="count">${pending.length}枚</span></div>
    ${pending.length === 0
      ? '<div class="empty">投稿待ちのピンはありません。</div>'
      : pending.map(pinCard).join("")}

    <div class="section-title">投稿済みのピン
      <span class="count">${posted.length}枚</span></div>
    ${posted.length === 0
      ? '<div class="empty">まだ投稿していません。</div>'
      : posted.slice(0, 30).map(pinCard).join("")}
    ${posted.length > 30 ? `<div class="note">新しい30枚だけ表示しています（全${posted.length}枚）。</div>` : ""}

    ${others.length ? `<div class="section-title">取り消した・失敗したピン
      <span class="count">${others.length}枚</span></div>
      ${others.slice(0, 20).map(pinCard).join("")}` : ""}`;

  return intro + artSection + pinSection;
}

/* -------------------------------------------------------------- 他のタブ */

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
  const links = (STATE.links.json || {}).links || {};
  const intro = `<div class="banner">
    <b>アフィリエイトへの応募は、あなたにしかできません。</b>
    本人確認が必要なので、AI社員は代われません。<br>
    英世（CMO）が調べた案件を、良い順に並べています。
    ①理由を読む → ②応募ページを開いて申し込む → ③発行されたURLを貼る、の3手順です。
  </div>`;
  if (all.length === 0) {
    return intro + `<div class="empty">
      案件がまだありません。英世（CMO）のリサーチを待ってください。
    </div>`;
  }
  const notYet = all.filter((p) => !links[p.slug]);
  const done = all.filter((p) => links[p.slug]);
  return intro +
    `<div class="section-title">応募がまだの案件<span class="count">${notYet.length}件</span></div>` +
    (notYet.length ? notYet.map((p) => programCard(p, links)).join("")
      : '<div class="empty">すべて登録済みです。</div>') +
    (done.length
      ? `<div class="section-title">リンク登録済み<span class="count">${done.length}件</span></div>` +
        done.map((p) => programCard(p, links)).join("")
      : "");
}

/* ------------------------------------------------------------- 描画本体 */

function render(flash) {
  const pendingCount = (STATE.approvals.json || []).filter((a) => a.status === "pending").length;
  const killed = STATE.limits.json && STATE.limits.json.killSwitch && STATE.limits.json.killSwitch.enabled;
  const tabs = [
    ["review", "投稿の確認", 0],
    ["approvals", "承認", pendingCount],
    ["programs", "案件（応募）", 0],
    ["status", "状態", 0],
  ];

  const view = TAB === "approvals" ? viewApprovals()
    : TAB === "status" ? viewStatus()
    : TAB === "programs" ? viewPrograms()
    : viewReview();

  app.innerHTML = `
    ${flash ? `<div class="banner ${flash.kind}">${flash.busy ? '<span class="spin"></span>' : ""}${esc(flash.text)}</div>` : ""}
    ${killed ? '<div class="banner bad"><b>会社は停止中です。</b>「状態」タブから再開できます。</div>' : ""}
    <header>
      <div>
        <h1>${esc(SITE_NAME)}</h1>
        <div class="sub">代表取締役デスク · ${esc(OWNER)}/${esc(REPO)}@${esc(BRANCH)}</div>
      </div>
      <button id="logoutBtn">ログアウト</button>
    </header>
    <nav class="tabs">
      ${tabs.map(([id, label, n]) =>
        `<button class="tabBtn ${TAB === id ? "active" : ""}" data-tab="${id}">
          ${label}${n > 0 ? `<span class="badge">${n}</span>` : ""}
        </button>`).join("")}
    </nav>
    ${view}
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
  document.querySelectorAll(".saveRefBtn").forEach((btn) => {
    btn.onclick = () => {
      const input = document.querySelector(
        `.refInput[data-slug="${btn.dataset.slug}"][data-field="${btn.dataset.field}"]`);
      saveLinkRef(btn.dataset.slug, btn.dataset.field, input.value.trim());
    };
  });
  document.querySelectorAll(".markAppliedBtn").forEach((btn) => {
    btn.onclick = () => saveStatus(btn.dataset.slug, "applied");
  });
  document.querySelectorAll(".bodyBtn").forEach((btn) => {
    btn.onclick = () => toggleBody(btn.dataset.slug);
  });
  document.querySelectorAll(".withdrawBtn").forEach((btn) => {
    btn.onclick = () => setArticlePublished(btn.dataset.slug, false);
  });
  document.querySelectorAll(".republishBtn").forEach((btn) => {
    btn.onclick = () => setArticlePublished(btn.dataset.slug, true);
  });
  document.querySelectorAll(".cancelPinBtn").forEach((btn) => {
    btn.onclick = () => cancelPin(btn.dataset.id);
  });
  document.querySelectorAll(".restorePinBtn").forEach((btn) => {
    btn.onclick = () => restorePin(btn.dataset.id);
  });
  document.querySelectorAll(".takedownBtn").forEach((btn) => {
    btn.onclick = () => requestTakedown(btn.dataset.id);
  });
}

/* --------------------------------------------------------------- 読み込み */

/** 記事の本文を開く／閉じる。開いたときだけ GitHub から読む。 */
async function toggleBody(slug) {
  if (BODY_OPEN[slug]) {
    BODY_OPEN[slug] = false;
    render();
    return;
  }
  BODY_OPEN[slug] = true;
  if (BODY_CACHE[slug] !== undefined) { render(); return; }
  render();
  const a = (STATE.articles.json || []).find((x) => x.slug === slug);
  try {
    BODY_CACHE[slug] = a ? await getText(a.filePath) : null;
  } catch (err) {
    BODY_CACHE[slug] = null;
    render({ kind: "bad", text: String(err.message || err) });
    return;
  }
  render();
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

async function savePins(message) {
  const put = await putFile("data/pins.json", STATE.pins.json, STATE.pins.sha, message);
  STATE.pins.sha = put.content.sha;
}

/** まだ投稿していないピンの予約を取り消す。 */
async function cancelPin(id) {
  if (!confirm("このピンの投稿をやめますか？（あとから戻せます）")) return;
  render({ kind: "warn", text: "取り消しています…", busy: true });
  try {
    const p = (STATE.pins.json || []).find((x) => x.id === id);
    if (!p) throw new Error("ピンが見つかりません。ページを再読み込みしてください。");
    if (p.status === "published") throw new Error("すでに投稿済みです。「Pinterestから削除する」を使ってください。");
    p.status = "skipped";
    p.cancelledAt = new Date().toISOString();
    await savePins("admin: ピン " + id + " の投稿を取り消し");
    render({ kind: "ok", text: "取り消しました。このピンは投稿されません。" });
  } catch (err) {
    render({ kind: "bad", text: String(err.message || err) });
  }
}

/** 取り消したピンを投稿予約に戻す。 */
async function restorePin(id) {
  render({ kind: "warn", text: "戻しています…", busy: true });
  try {
    const p = (STATE.pins.json || []).find((x) => x.id === id);
    if (!p) throw new Error("ピンが見つかりません。ページを再読み込みしてください。");
    p.status = p.scheduledAt ? "scheduled" : "queued";
    p.cancelledAt = null;
    await savePins("admin: ピン " + id + " の投稿予約を復帰");
    render({ kind: "ok", text: "投稿予約に戻しました。承認が済んでいれば次の実行で投稿されます。" });
  } catch (err) {
    render({ kind: "bad", text: String(err.message || err) });
  }
}

/**
 * 投稿済みのピンを Pinterest から削除するよう依頼する。
 *
 * ここでは記録を書くだけです。実際の削除は GitHub Actions が行います。
 * Pinterest のトークンは Actions の中にしかなく、この画面からは触れないためです。
 */
async function requestTakedown(id) {
  if (!confirm("投稿済みのピンを Pinterest から削除しますか？\n（削除は取り消せません）")) return;
  const reason = prompt("理由（あとで見返すためのメモ。空でも構いません）") || "";
  render({ kind: "warn", text: "削除を依頼しています…", busy: true });
  try {
    const p = (STATE.pins.json || []).find((x) => x.id === id);
    if (!p) throw new Error("ピンが見つかりません。ページを再読み込みしてください。");
    p.takedownRequestedAt = new Date().toISOString();
    p.takedownReason = reason;
    await savePins("admin: ピン " + id + " の削除を依頼");

    render({ kind: "warn", text: "削除の処理を起動しています…", busy: true });
    await dispatchWorkflow(PINS_WORKFLOW, "ピンの削除処理");
    render({ kind: "ok", text: "削除を依頼しました。1〜2分で Pinterest から消えます。すぐ消したい場合は Pinterest 側でも削除できます。" });
  } catch (err) {
    render({ kind: "bad", text: String(err.message || err) });
  }
}

/**
 * 記事をサイトから取り下げる／戻す。
 *
 * 本文ファイルは消しません。data/articles.json の status を変えるだけです。
 * サイトは status が published の記事だけを出すので、これで消えます。
 * 間違って押しても、同じ画面から戻せます。
 */
async function setArticlePublished(slug, publish) {
  const msg = publish
    ? "この記事をもう一度サイトに公開しますか？"
    : "この記事をサイトから取り下げますか？\n（本文は消えません。あとから戻せます）";
  if (!confirm(msg)) return;
  let reason = "";
  if (!publish) reason = prompt("理由（あとで見返すためのメモ。空でも構いません）") || "";

  render({ kind: "warn", text: publish ? "公開しています…" : "取り下げています…", busy: true });
  try {
    const list = STATE.articles.json || [];
    const a = list.find((x) => x.slug === slug);
    if (!a) throw new Error("記事が見つかりません。ページを再読み込みしてください。");
    a.status = publish ? "published" : "withdrawn";
    a.updatedAt = new Date().toISOString();
    if (publish) {
      a.withdrawnAt = null;
      a.withdrawnReason = null;
    } else {
      a.withdrawnAt = new Date().toISOString();
      a.withdrawnReason = reason;
    }
    const put = await putFile("data/articles.json", list, STATE.articles.sha,
      "admin: 記事 " + slug + (publish ? " を再公開" : " を取り下げ"));
    STATE.articles.sha = put.content.sha;

    render({ kind: "warn", text: "サイトを作り直しています…", busy: true });
    await dispatchRebuild();
    render({
      kind: "ok",
      text: publish
        ? "再公開しました。1〜2分でサイトに戻ります。"
        : "取り下げました。1〜2分でサイトから消えます。本文は残っているので、いつでも戻せます。",
    });
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

/**
 * 自動発行に必要なID（PartnerStack の紹介リンク / Rewardful の via トークン）を保存する。
 *
 * ここに入れておけば、次の `co links:sync` でアフィリエイトURLが自動で作られます。
 * URL そのものを貼るのとは別です（URL を直接貼りたいときは下の欄を使ってください）。
 */
async function saveLinkRef(slug, field, value) {
  render({ kind: "warn", text: slug + " を保存中…", busy: true });
  try {
    const idx = STATE.programs.json.findIndex((p) => p.slug === slug);
    if (idx === -1) throw new Error("案件が見つかりません。ページを再読み込みしてください。");
    const p = STATE.programs.json[idx];
    p.linkRef = p.linkRef || {};
    if (value) p.linkRef[field] = value;
    else delete p.linkRef[field];

    const put = await putFile("data/programs.json", STATE.programs.json, STATE.programs.sha,
      "admin: " + slug + " の自動発行の設定を更新");
    STATE.programs.sha = put.content.sha;
    render({
      kind: "ok",
      text: value
        ? "保存しました。次の自動実行で、この案件のアフィリエイトURLが自動で作られます。"
        : "設定を消しました。",
    });
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
    // 判断が必要なことがあれば承認タブ、なければ投稿の確認タブから始める
    const pending = (STATE.approvals.json || []).filter((a) => a.status === "pending").length;
    TAB = pending > 0 ? "approvals" : "review";
    render();
  } catch (err) {
    renderGate("読み込みに失敗しました: " + (err.message || err));
  }
}
boot();
