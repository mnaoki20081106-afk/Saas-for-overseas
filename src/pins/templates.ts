import { escapeHtml } from "../lib/util";

export interface PinRenderData {
  overlayTop: string;
  overlayMain: string;
  overlayBottom: string;
  siteName: string;
  width: number;
  height: number;
  paletteIndex: number;
}

export const TEMPLATE_IDS = [
  "bold-stat", "split-card", "checklist", "versus", "editorial",
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

interface Palette { bg: string; bg2: string; ink: string; accent: string; soft: string; onAccent: string }

/** Pinterest でよく効く、彩度が高すぎない配色を 8 種類。 */
const PALETTES: Palette[] = [
  { bg: "#0F172A", bg2: "#1E293B", ink: "#F8FAFC", accent: "#FBBF24", soft: "#94A3B8", onAccent: "#0F172A" },
  { bg: "#FDF6EC", bg2: "#F5E7D3", ink: "#1C1917", accent: "#B45309", soft: "#78716C", onAccent: "#FFFFFF" },
  { bg: "#052E2B", bg2: "#0B4F4A", ink: "#ECFDF5", accent: "#5EEAD4", soft: "#99F6E4", onAccent: "#042F2E" },
  { bg: "#FFFFFF", bg2: "#F1F5F9", ink: "#0F172A", accent: "#DB2777", soft: "#64748B", onAccent: "#FFFFFF" },
  { bg: "#1E1B4B", bg2: "#312E81", ink: "#EEF2FF", accent: "#A5B4FC", soft: "#C7D2FE", onAccent: "#1E1B4B" },
  { bg: "#FEF2F2", bg2: "#FEE2E2", ink: "#450A0A", accent: "#DC2626", soft: "#9F1239", onAccent: "#FFFFFF" },
  { bg: "#0C4A6E", bg2: "#075985", ink: "#F0F9FF", accent: "#FDE68A", soft: "#BAE6FD", onAccent: "#0C4A6E" },
  { bg: "#F8FAFC", bg2: "#E2E8F0", ink: "#020617", accent: "#0F766E", soft: "#475569", onAccent: "#FFFFFF" },
];

const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800;900&family=Fraunces:opsz,wght@9..144,600;9..144,800&display=swap" rel="stylesheet">`;

const SANS = `'Inter', 'Helvetica Neue', Helvetica, 'Segoe UI', 'DejaVu Sans', Arial, sans-serif`;
const SERIF = `'Fraunces', Georgia, 'Times New Roman', 'DejaVu Serif', serif`;

function shell(d: PinRenderData, p: Palette, body: string, extraCss = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${FONT_LINK}
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${d.width}px;height:${d.height}px}
  body{font-family:${SANS};background:${p.bg};color:${p.ink};overflow:hidden;
       -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
  .frame{width:${d.width}px;height:${d.height}px;position:relative;display:flex;flex-direction:column}
  .brand{position:absolute;left:64px;bottom:56px;font-size:26px;letter-spacing:.16em;
         text-transform:uppercase;font-weight:600;color:${p.soft}}
  .kicker{font-size:30px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:${p.accent}}
  .balance{text-wrap:balance}
  ${extraCss}
</style></head><body><div class="frame">${body}
<div class="brand">${escapeHtml(d.siteName)}</div></div></body></html>`;
}

/** 文字数に応じてフォントサイズを自動で落とす（はみ出し防止） */
function fit(text: string, max: number, min: number, idealChars: number): number {
  const len = Math.max(text.length, 1);
  const size = max * Math.sqrt(idealChars / len);
  return Math.round(Math.min(max, Math.max(min, size)));
}

function boldStat(d: PinRenderData, p: Palette): string {
  const main = fit(d.overlayMain, 108, 58, 44);
  return shell(d, p, `
  <div style="position:absolute;inset:0;background:
      radial-gradient(1200px 760px at 88% -6%, ${p.bg2} 0%, transparent 64%)"></div>
  <div style="position:relative;flex:1;display:flex;flex-direction:column;padding:104px 64px 150px">
    <div class="kicker">${escapeHtml(d.overlayTop)}</div>
    <div style="width:140px;height:12px;background:${p.accent};margin:34px 0 0;border-radius:99px"></div>
    <div style="flex:1;display:flex;align-items:center">
      <h1 class="balance" style="font-size:${main}px;line-height:1.03;font-weight:900;letter-spacing:-.03em">
        ${escapeHtml(d.overlayMain)}</h1>
    </div>
    <div style="display:inline-block;background:${p.accent};color:${p.onAccent};
        padding:30px 44px;border-radius:20px;font-size:38px;font-weight:800;line-height:1.25">
      ${escapeHtml(d.overlayBottom)}</div>
  </div>`);
}

function splitCard(d: PinRenderData, p: Palette): string {
  const main = fit(d.overlayMain, 88, 50, 50);
  return shell(d, p, `
  <div style="height:520px;background:${p.bg2};position:relative;overflow:hidden;flex:0 0 auto">
    <div style="position:absolute;right:-160px;top:-160px;width:620px;height:620px;
        border-radius:50%;background:${p.accent};opacity:.24"></div>
    <div style="position:absolute;left:-120px;bottom:-220px;width:420px;height:420px;
        border-radius:50%;background:${p.accent};opacity:.12"></div>
    <div style="position:relative;padding:92px 64px">
      <div class="kicker">${escapeHtml(d.overlayTop)}</div>
    </div>
  </div>
  <div style="flex:1;display:flex;padding:0 56px 150px">
    <div style="margin-top:-170px;background:${p.bg};border-radius:36px;padding:66px 56px;width:100%;
        box-shadow:0 44px 100px rgba(0,0,0,.3);border:1px solid ${p.soft}33;
        display:flex;flex-direction:column;justify-content:center">
      <h1 class="balance" style="font-size:${main}px;line-height:1.1;font-weight:800;letter-spacing:-.025em">
        ${escapeHtml(d.overlayMain)}</h1>
      <p style="margin-top:36px;font-size:38px;line-height:1.4;color:${p.soft};font-weight:500">
        ${escapeHtml(d.overlayBottom)}</p>
    </div>
  </div>`);
}

function checklist(d: PinRenderData, p: Palette): string {
  const items = d.overlayBottom.split("|").map((s) => s.trim()).filter(Boolean).slice(0, 5);
  const main = fit(d.overlayMain, 84, 48, 48);
  const itemSize = items.length >= 5 ? 38 : 42;
  return shell(d, p, `
  <div style="flex:0 0 auto;padding:96px 64px 0">
    <div class="kicker">${escapeHtml(d.overlayTop)}</div>
    <h1 class="balance" style="margin-top:30px;font-size:${main}px;line-height:1.08;font-weight:900;letter-spacing:-.025em">
      ${escapeHtml(d.overlayMain)}</h1>
  </div>
  <div style="flex:1;padding:48px 64px 150px;display:flex;flex-direction:column;justify-content:space-evenly">
    ${items.map((text, i) => `
      <div style="display:flex;gap:28px;align-items:center">
        <div style="flex:0 0 74px;height:74px;border-radius:20px;background:${p.accent};color:${p.onAccent};
            display:flex;align-items:center;justify-content:center;font-size:38px;font-weight:900">${i + 1}</div>
        <div style="font-size:${itemSize}px;line-height:1.3;font-weight:600">${escapeHtml(text)}</div>
      </div>`).join("")}
  </div>`);
}

function versus(d: PinRenderData, p: Palette): string {
  const [a = "", b = ""] = d.overlayMain.split(/\s+vs\.?\s+/i);
  const size = fit(a.length > b.length ? a : b, 112, 54, 18);
  return shell(d, p, `
  <div style="flex:0 0 auto;padding:96px 64px 0"><div class="kicker">${escapeHtml(d.overlayTop)}</div></div>
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:0 64px 150px;gap:30px">
    <div class="balance" style="font-size:${size}px;font-weight:900;line-height:1.02;letter-spacing:-.035em">${escapeHtml(a)}</div>
    <div style="display:flex;align-items:center;gap:30px">
      <div style="flex:1;height:5px;background:${p.soft}55;border-radius:99px"></div>
      <div style="font-family:${SERIF};font-size:76px;font-weight:800;color:${p.accent};line-height:1">vs</div>
      <div style="flex:1;height:5px;background:${p.soft}55;border-radius:99px"></div>
    </div>
    <div class="balance" style="font-size:${size}px;font-weight:900;line-height:1.02;letter-spacing:-.035em">${escapeHtml(b)}</div>
    <div style="margin-top:56px;font-size:38px;line-height:1.38;color:${p.soft};font-weight:500">
      ${escapeHtml(d.overlayBottom)}</div>
  </div>`);
}

function editorial(d: PinRenderData, p: Palette): string {
  const main = fit(d.overlayMain, 96, 50, 54);
  return shell(d, p, `
  <div style="position:absolute;inset:0;background:linear-gradient(158deg,${p.bg} 0%,${p.bg2} 100%)"></div>
  <div style="position:relative;flex:1;display:flex;flex-direction:column;padding:104px 68px 150px">
    <div style="font-family:${SERIF};font-size:170px;line-height:.62;color:${p.accent};opacity:.5;flex:0 0 auto">&ldquo;</div>
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center">
      <h1 class="balance" style="font-family:${SERIF};font-size:${main}px;line-height:1.14;font-weight:800">
        ${escapeHtml(d.overlayMain)}</h1>
      <div style="width:104px;height:7px;background:${p.accent};margin:48px 0 36px;border-radius:99px"></div>
      <p style="font-size:38px;line-height:1.42;color:${p.soft};font-weight:500;max-width:800px">
        ${escapeHtml(d.overlayBottom)}</p>
    </div>
    <div style="font-size:30px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${p.accent}">
      ${escapeHtml(d.overlayTop)}</div>
  </div>`);
}

const RENDERERS: Record<TemplateId, (d: PinRenderData, p: Palette) => string> = {
  "bold-stat": boldStat,
  "split-card": splitCard,
  checklist,
  versus,
  editorial,
};

export function renderPinHtml(templateId: string, data: PinRenderData): string {
  const id = (TEMPLATE_IDS as readonly string[]).includes(templateId)
    ? (templateId as TemplateId)
    : "bold-stat";
  const palette = PALETTES[Math.abs(data.paletteIndex) % PALETTES.length];
  return RENDERERS[id](data, palette);
}
