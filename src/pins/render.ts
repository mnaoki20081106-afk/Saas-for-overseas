import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { P } from "../lib/paths";
import { log } from "../lib/log";
import { renderPinHtml, type PinRenderData } from "./templates";

/**
 * Chromium の実行ファイルを探す。
 * 1. PLAYWRIGHT_CHROMIUM_PATH（明示指定）
 * 2. Playwright が管理しているブラウザ（npx playwright install chromium）
 * 3. PLAYWRIGHT_BROWSERS_PATH 配下の chromium 系ディレクトリ内の chrome 実行ファイル
 * 4. システムの chromium / google-chrome
 */
function resolveExecutable(): string | undefined {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root && fs.existsSync(root)) {
    const candidates: string[] = [];
    for (const entry of fs.readdirSync(root)) {
      if (!entry.startsWith("chromium")) continue;
      for (const rel of [
        "chrome-linux/chrome",
        "chrome-linux/headless_shell",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
      ]) {
        const full = path.join(root, entry, rel);
        if (fs.existsSync(full)) candidates.push(full);
      }
      const direct = path.join(root, entry);
      if (fs.statSync(direct).isFile()) candidates.push(direct);
    }
    // headless_shell より通常の chrome を優先（フォント描画が安定する）
    candidates.sort((a, b) => Number(a.includes("headless_shell")) - Number(b.includes("headless_shell")));
    if (candidates[0]) return candidates[0];
  }

  for (const sys of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) {
    if (fs.existsSync(sys)) return sys;
  }
  return undefined;
}

const FONT_BUDGET_MS = 4000;

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser) return browser;
  const executablePath = resolveExecutable();
  try {
    browser = await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
    });
  } catch (err) {
    throw new Error(
      `Chromium を起動できませんでした。CI では \`npx playwright install --with-deps chromium\` を実行してください。\n元エラー: ${(err as Error).message}`,
    );
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

export interface RenderRequest {
  id: string;
  templateId: string;
  data: PinRenderData;
}

/** ピン画像（PNG, 2:3）を書き出してパスを返す */
export async function renderPins(requests: RenderRequest[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (requests.length === 0) return out;

  fs.mkdirSync(P.pinAssets, { recursive: true });
  const b = await getBrowser();
  const first = requests[0].data;
  const context = await b.newContext({
    viewport: { width: first.width, height: first.height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();

  // オフライン環境（CI のサンドボックス等）では Web フォントが取れない。
  // 取れないと分かった時点で以降のリクエストを即座に中断し、フォールバック書体で描画する。
  let webFontsAvailable = true;
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => {
    if (webFontsAvailable) void route.continue();
    else void route.abort();
  });

  for (const req of requests) {
    const html = renderPinHtml(req.templateId, req.data);
    await page.setViewportSize({ width: req.data.width, height: req.data.height });
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 20_000 });

    if (webFontsAvailable) {
      await Promise.race([
        page.evaluate(() => (document as unknown as { fonts: FontFaceSet }).fonts.ready).catch(() => undefined),
        page.waitForTimeout(FONT_BUDGET_MS),
      ]);
      const loaded = await page
        .evaluate(() => (document as unknown as { fonts: FontFaceSet }).fonts.check("800 60px Inter"))
        .catch(() => false);
      if (!loaded) {
        webFontsAvailable = false;
        log.warn("Web フォントを取得できないため、システム書体で描画します");
      }
    }
    await page.waitForTimeout(120);

    const file = path.join(P.pinAssets, `${req.id}.png`);
    await page.screenshot({ path: file, type: "png" });
    out.set(req.id, path.relative(P.root, file));
  }

  await context.close();
  log.ok(`ピン画像を ${out.size} 枚レンダリングしました → assets/pins/`);
  return out;
}
