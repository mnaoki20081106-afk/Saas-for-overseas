import fs from "node:fs";
import path from "node:path";
import { P, ensureDirs } from "./paths";
import type {
  Program, Article, Pin, Metrics, HumanTask, PipelineState,
} from "./types";

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`${path.basename(file)} が壊れています (JSON parse error): ${(err as Error).message}`);
  }
}

function writeJson(file: string, value: unknown): void {
  ensureDirs();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

/* ---------------------------------------------------------------- programs */
export const programs = {
  all: (): Program[] => readJson<Program[]>(P.programs, []),
  save: (list: Program[]): void => writeJson(P.programs, list),
  bySlug: (slug: string): Program | undefined => programs.all().find((p) => p.slug === slug),
  upsertMany(incoming: Program[]): { added: number; updated: number } {
    const list = programs.all();
    const index = new Map(list.map((p, i) => [p.slug, i]));
    let added = 0;
    let updated = 0;
    for (const p of incoming) {
      const at = index.get(p.slug);
      if (at === undefined) {
        list.push(p);
        index.set(p.slug, list.length - 1);
        added++;
      } else {
        // 人間が手を入れた status とメモは絶対に上書きしない
        const prev = list[at];
        list[at] = { ...p, status: prev.status, notes: prev.notes ?? p.notes, discoveredAt: prev.discoveredAt };
        updated++;
      }
    }
    list.sort((a, b) => b.score - a.score);
    programs.save(list);
    return { added, updated };
  },
  setStatus(slug: string, status: Program["status"]): void {
    const list = programs.all();
    const p = list.find((x) => x.slug === slug);
    if (!p) return;
    p.status = status;
    programs.save(list);
  },
};

/* ---------------------------------------------------------------- articles */
export const articles = {
  all: (): Article[] => readJson<Article[]>(P.articles, []),
  save: (list: Article[]): void => writeJson(P.articles, list),
  bySlug: (slug: string): Article | undefined => articles.all().find((a) => a.slug === slug),
  upsert(article: Article): void {
    const list = articles.all();
    const at = list.findIndex((a) => a.slug === article.slug);
    if (at === -1) list.push(article);
    else list[at] = article;
    articles.save(list);
  },
};

/* -------------------------------------------------------------------- pins */
export const pins = {
  all: (): Pin[] => readJson<Pin[]>(P.pins, []),
  save: (list: Pin[]): void => writeJson(P.pins, list),
  byId: (id: string): Pin | undefined => pins.all().find((p) => p.id === id),
  addMany(incoming: Pin[]): void {
    const list = pins.all();
    const known = new Set(list.map((p) => p.id));
    for (const p of incoming) if (!known.has(p.id)) list.push(p);
    pins.save(list);
  },
  update(id: string, patch: Partial<Pin>): void {
    const list = pins.all();
    const at = list.findIndex((p) => p.id === id);
    if (at === -1) return;
    list[at] = { ...list[at], ...patch };
    pins.save(list);
  },
};

/* ----------------------------------------------------------------- metrics */
const emptyMetrics: Metrics = { updatedAt: "", pinMetrics: {}, affiliate: [], history: [] };
export const metrics = {
  get: (): Metrics => readJson<Metrics>(P.metrics, emptyMetrics),
  save: (m: Metrics): void => writeJson(P.metrics, m),
};

/* ------------------------------------------------------------- human tasks */
export const humanTasks = {
  all: (): HumanTask[] => readJson<HumanTask[]>(P.humanTasks, []),
  save: (list: HumanTask[]): void => writeJson(P.humanTasks, list),
  open: (): HumanTask[] => humanTasks.all().filter((t) => t.status === "open"),
  upsert(task: HumanTask): void {
    const list = humanTasks.all();
    const at = list.findIndex((t) => t.id === task.id);
    if (at === -1) list.push(task);
    else list[at] = { ...list[at], ...task, status: list[at].status };
    humanTasks.save(list);
  },
  close(id: string): void {
    const list = humanTasks.all();
    const t = list.find((x) => x.id === id);
    if (!t) return;
    t.status = "done";
    t.doneAt = new Date().toISOString();
    humanTasks.save(list);
  },
};

/* ------------------------------------------------------------------- state */
const emptyState: PipelineState = {
  lastResearchAt: null, lastArticleAt: null, lastPinPublishAt: null,
  lastAnalyticsAt: null, lastReportAt: null,
  publishedCategories: [], cursor: 0, milestonesHit: [],
  campaignStartedAt: null,
  lastCeoRunAt: null, routineRunsToday: { date: "", count: 0 },
  phase: "bootstrap", companyStartedAt: null, lastKpiSnapshotAt: null,
  schemaVersion: 0,
};
export const state = {
  get: (): PipelineState => ({ ...emptyState, ...readJson<Partial<PipelineState>>(P.state, {}) }),
  patch(patch: Partial<PipelineState>): PipelineState {
    const next = { ...state.get(), ...patch };
    writeJson(P.state, next);
    return next;
  },
};

/* ------------------------------------------------------------------ runlog */
export interface RunEntry {
  at: string; command: string; ok: boolean; summary: string; details?: string[];
}
export const runlog = {
  all: (): RunEntry[] => readJson<RunEntry[]>(P.runlog, []),
  add(entry: RunEntry): void {
    const list = runlog.all();
    list.unshift(entry);
    writeJson(P.runlog, list.slice(0, 200));
  },
};

export { readJson, writeJson };
