import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..", "..");

export const P = {
  root: ROOT,
  config: path.join(ROOT, "config", "config.json"),
  scoring: path.join(ROOT, "config", "scoring.json"),
  affiliateLinks: path.join(ROOT, "config", "affiliate-links.json"),
  data: path.join(ROOT, "data"),
  programs: path.join(ROOT, "data", "programs.json"),
  articles: path.join(ROOT, "data", "articles.json"),
  pins: path.join(ROOT, "data", "pins.json"),
  metrics: path.join(ROOT, "data", "metrics.json"),
  humanTasks: path.join(ROOT, "data", "human-tasks.json"),
  state: path.join(ROOT, "data", "state.json"),
  runlog: path.join(ROOT, "data", "runlog.json"),
  contentDir: path.join(ROOT, "content", "articles"),
  pinAssets: path.join(ROOT, "assets", "pins"),
  publicDir: path.join(ROOT, "public"),
  docs: path.join(ROOT, "docs"),
};

export function ensureDirs(): void {
  for (const dir of [P.data, P.contentDir, P.pinAssets, P.docs]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
