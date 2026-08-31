import fs from "node:fs";
import path from "node:path";
import { P } from "../lib/paths";
import { readJson, writeJson } from "../lib/store";
import type {
  Approval, ContentIdea, Decision, ErrorRecord, Experiment, KpiSnapshot,
  ResearchCandidate, Review, Task,
} from "./schemas";

/**
 * AI会社が使う新しいデータファイル群。
 *
 * 既存の store.ts（programs / articles / pins / metrics / human-tasks / state / runlog）は
 * そのまま残し、こちらは新規エンティティだけを扱う。既存の読み書きには一切触らない。
 *
 * 書き込みは既存の writeJson()（tmp に書いて rename する原子的書き込み）を使う。
 */

export const CP = {
  tasks: path.join(P.data, "tasks.json"),
  approvals: path.join(P.data, "approvals.json"),
  decisions: path.join(P.data, "decisions.json"),
  research: path.join(P.data, "research.json"),
  ideas: path.join(P.data, "ideas.json"),
  reviews: path.join(P.data, "reviews.json"),
  experiments: path.join(P.data, "experiments.json"),
  kpis: path.join(P.data, "kpis.json"),
  errors: path.join(P.data, "errors.json"),
  employees: path.join(P.data, "employees.json"),
  limits: path.join(P.root, "config", "limits.json"),
  kpiConfig: path.join(P.root, "config", "kpi.json"),
  draftsDir: path.join(P.root, "content", "drafts"),
  archiveDir: path.join(P.data, "archive"),
};

/** 単純な「配列1本のJSONファイル」のストアを作る */
function listStore<T>(file: string) {
  return {
    file,
    all: (): T[] => readJson<T[]>(file, []),
    save: (list: T[]): void => writeJson(file, list),
    add(item: T): T {
      const list = readJson<T[]>(file, []);
      list.push(item);
      writeJson(file, list);
      return item;
    },
    replace(predicate: (item: T) => boolean, patch: Partial<T>): T | null {
      const list = readJson<T[]>(file, []);
      const at = list.findIndex(predicate);
      if (at === -1) return null;
      list[at] = { ...list[at], ...patch };
      writeJson(file, list);
      return list[at];
    },
  };
}

export const tasks = listStore<Task>(CP.tasks);
export const approvals = listStore<Approval>(CP.approvals);
export const decisions = listStore<Decision>(CP.decisions);
export const research = listStore<ResearchCandidate>(CP.research);
export const ideas = listStore<ContentIdea>(CP.ideas);
export const reviews = listStore<Review>(CP.reviews);
export const experiments = listStore<Experiment>(CP.experiments);
export const kpis = listStore<KpiSnapshot>(CP.kpis);
export const errors = listStore<ErrorRecord>(CP.errors);

/* ------------------------------------------------------------- employees */

export interface EmployeeConfig {
  maxRunsPerDay?: number;
  maxRunsPerWeek?: number;
  maxNewTasksPerRun?: number;
  maxCandidatesPerRun?: number;
  maxWebFetches?: number;
  maxIdeasPerRun?: number;
  maxLiveExperiments?: number;
  maxArticlesPerRun?: number;
  maxRoundsPerArticle?: number;
  maxPinsPerRun?: number;
  maxProposalsPerRun?: number;
  timeoutMinutes: number;
  maxRetries: number;
  /** Phase 1 で稼働するか。false の社員はまだ起動しない（→ DESIGN_REVIEW.md §6） */
  active: boolean;
  /** 実行実績（co が自動で記録する） */
  runs: { date: string; count: number }[];
}

export const DEFAULT_EMPLOYEES: Record<string, EmployeeConfig> = {
  ceo:        { maxRunsPerDay: 3,  maxNewTasksPerRun: 5,   timeoutMinutes: 20, maxRetries: 2, active: true,  runs: [] },
  researcher: { maxRunsPerWeek: 2, maxCandidatesPerRun: 10, maxWebFetches: 30, timeoutMinutes: 25, maxRetries: 2, active: true, runs: [] },
  writer:     { maxRunsPerDay: 2,  maxArticlesPerRun: 1,   timeoutMinutes: 30, maxRetries: 2, active: true,  runs: [] },
  editor:     { maxRunsPerDay: 4,  maxRoundsPerArticle: 2, timeoutMinutes: 20, maxRetries: 1, active: true,  runs: [] },
  designer:   { maxRunsPerDay: 2,  maxPinsPerRun: 10,      timeoutMinutes: 20, maxRetries: 2, active: true,  runs: [] },
  // Phase 2〜3 で有効化する。分析対象のデータが存在しないうちは起動しない。
  qa:         { maxRunsPerDay: 4,  timeoutMinutes: 15,     maxRetries: 1, active: false, runs: [] },
  analyst:    { maxRunsPerDay: 2,  maxIdeasPerRun: 3, maxLiveExperiments: 2, timeoutMinutes: 15, maxRetries: 2, active: false, runs: [] },
  growth:     { maxRunsPerDay: 1,  maxProposalsPerRun: 3,  timeoutMinutes: 15, maxRetries: 1, active: false, runs: [] },
};

export const employees = {
  all: (): Record<string, EmployeeConfig> =>
    ({ ...DEFAULT_EMPLOYEES, ...readJson<Record<string, EmployeeConfig>>(CP.employees, {}) }),
  get(id: string): EmployeeConfig {
    const cfg = employees.all()[id];
    if (!cfg) throw new Error(`知らない社員です: ${id}`);
    return cfg;
  },
  save: (all: Record<string, EmployeeConfig>): void => writeJson(CP.employees, all),
  /** 実行回数を1つ増やす。上限チェックは limits.ts が行う。 */
  recordRun(id: string, date: string): void {
    const all = employees.all();
    const cfg = all[id];
    if (!cfg) return;
    const row = cfg.runs.find((r) => r.date === date);
    if (row) row.count += 1;
    else cfg.runs.push({ date, count: 1 });
    // 直近60日ぶんだけ残す
    cfg.runs = cfg.runs.slice(-60);
    employees.save(all);
  },
  runsOn(id: string, date: string): number {
    return employees.all()[id]?.runs.find((r) => r.date === date)?.count ?? 0;
  },
  runsSince(id: string, sinceDate: string): number {
    return (employees.all()[id]?.runs ?? [])
      .filter((r) => r.date >= sinceDate)
      .reduce((s, r) => s + r.count, 0);
  },
};

/* ---------------------------------------------------------------- drafts */

export const drafts = {
  dir: CP.draftsDir,
  pathFor: (slug: string): string => path.join(CP.draftsDir, `${slug}.md`),
  exists: (slug: string): boolean => fs.existsSync(drafts.pathFor(slug)),
  read(slug: string): string {
    const p = drafts.pathFor(slug);
    if (!fs.existsSync(p)) throw new Error(`下書きがありません: ${path.relative(P.root, p)}`);
    return fs.readFileSync(p, "utf8");
  },
  write(slug: string, markdown: string): string {
    fs.mkdirSync(CP.draftsDir, { recursive: true });
    const p = drafts.pathFor(slug);
    fs.writeFileSync(p, markdown, "utf8");
    return p;
  },
  list: (): string[] =>
    fs.existsSync(CP.draftsDir)
      ? fs.readdirSync(CP.draftsDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))
      : [],
};

/** 新しいデータファイルとディレクトリを用意する（無ければ空で作る） */
export function ensureCompanyDirs(): void {
  fs.mkdirSync(P.data, { recursive: true });
  fs.mkdirSync(CP.draftsDir, { recursive: true });
  fs.mkdirSync(CP.archiveDir, { recursive: true });
  for (const file of [
    CP.tasks, CP.approvals, CP.decisions, CP.research,
    CP.ideas, CP.reviews, CP.experiments, CP.kpis, CP.errors,
  ]) {
    if (!fs.existsSync(file)) writeJson(file, []);
  }
  if (!fs.existsSync(CP.employees)) writeJson(CP.employees, DEFAULT_EMPLOYEES);
}
