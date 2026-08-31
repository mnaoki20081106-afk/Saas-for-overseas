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
  role: "CEO" | "CMO" | "CTO";
  displayName: string;
  /** 1=オーナー 2=CEO 3=実務 */
  layer: number;
  /** この人が使う co コマンドの接頭辞 */
  owns: string[];
  /** 旧役職のうち、この人が吸収したもの（過去データの assignee を解決するため） */
  absorbs: string[];
  maxRunsPerDay?: number;
  /**
   * 週あたりの起動上限。いまは誰にも設定していない。
   * リサーチの頻度（週1回程度）は state.lastResearchAt と
   * 諭吉の判断ルール（有効案件3件未満 or 7日経過なら実行）で決めている。
   */
  maxRunsPerWeek?: number;
  maxCandidatesPerRun?: number;
  maxWebFetches?: number;
  maxArticlesPerRun?: number;
  maxRoundsPerArticle?: number;
  maxPinsPerRun?: number;
  maxNewTasksPerRun?: number;
  timeoutMinutes: number;
  maxRetries: number;
  active: boolean;
  /** CMOとCTOは false。部下を持たないプレイングマネージャー。 */
  hasSubordinates: boolean;
  /** 実行実績（co が自動で記録する） */
  runs: { date: string; count: number }[];
}

/**
 * 3層構造の社員台帳。
 *
 * 人は3人だけです。旧構成の6役職（Researcher / Analyst / Writer / Editor /
 * Designer / QA）は、無駄な多重下請けだったため廃止し、この3人に統合しました。
 * CMOとCTOはプレイングマネージャーで、部下を持ちません。
 *
 * co のコマンド名（researcher: / writer: など）は「道具の名前」であって
 * 「人の名前」ではありません。誰がどの道具を使うかは owns に書いてあります。
 */
export const DEFAULT_EMPLOYEES: Record<string, EmployeeConfig> = {
  yukichi: {
    role: "CEO", displayName: "諭吉", layer: 2,
    owns: ["status", "check", "task", "approval", "decision", "release", "error"],
    absorbs: ["ceo", "analyst"],
    maxRunsPerDay: 3, maxNewTasksPerRun: 5, timeoutMinutes: 20, maxRetries: 2,
    active: true, hasSubordinates: true, runs: [],
  },
  sara: {
    role: "CMO", displayName: "サラ", layer: 3,
    owns: ["researcher", "designer", "pins"],
    absorbs: ["researcher", "designer", "growth"],
    maxRunsPerDay: 2, maxCandidatesPerRun: 10, maxWebFetches: 30, maxPinsPerRun: 10,
    timeoutMinutes: 25, maxRetries: 2,
    active: true, hasSubordinates: false, runs: [],
  },
  ken: {
    role: "CTO", displayName: "ケン", layer: 3,
    owns: ["writer", "editor", "qa"],
    absorbs: ["writer", "editor", "qa"],
    maxRunsPerDay: 2, maxArticlesPerRun: 1, maxRoundsPerArticle: 2,
    timeoutMinutes: 30, maxRetries: 2,
    active: true, hasSubordinates: false, runs: [],
  },
};

/** 社員台帳ではないキー（説明文など）を除く */
function isEmployeeKey(key: string): boolean {
  return !key.startsWith("_");
}

export const employees = {
  all(): Record<string, EmployeeConfig> {
    const stored = readJson<Record<string, unknown>>(CP.employees, {});
    const merged: Record<string, EmployeeConfig> = { ...DEFAULT_EMPLOYEES };
    for (const [k, v] of Object.entries(stored)) {
      if (!isEmployeeKey(k)) continue;
      merged[k] = { ...merged[k], ...(v as EmployeeConfig) };
    }
    return merged;
  },

  /**
   * 機能ID（researcher / writer など）から、それを担当する人を引く。
   * 過去データの assignee や、道具の名前から担当者を解決するために使う。
   */
  personFor(idOrFunction: string): { id: string; config: EmployeeConfig } | null {
    const all = employees.all();
    if (all[idOrFunction]) return { id: idOrFunction, config: all[idOrFunction] };
    for (const [id, cfg] of Object.entries(all)) {
      if (cfg.absorbs.includes(idOrFunction) || cfg.owns.includes(idOrFunction)) {
        return { id, config: cfg };
      }
    }
    return null;
  },

  get(id: string): EmployeeConfig {
    const found = employees.personFor(id);
    if (!found) throw new Error(`知らない社員です: ${id}（いるのは 諭吉 / サラ / ケン の3人だけです）`);
    return found.config;
  },

  save: (all: Record<string, EmployeeConfig>): void => writeJson(CP.employees, all),

  /** 実行回数を1つ増やす。上限チェックは limits.ts が行う。 */
  recordRun(id: string, date: string): void {
    const found = employees.personFor(id);
    if (!found) return;
    const all = employees.all();
    const cfg = all[found.id];
    const row = cfg.runs.find((r) => r.date === date);
    if (row) row.count += 1;
    else cfg.runs.push({ date, count: 1 });
    cfg.runs = cfg.runs.slice(-60);
    employees.save(all);
  },

  runsOn(id: string, date: string): number {
    const found = employees.personFor(id);
    return found?.config.runs.find((r) => r.date === date)?.count ?? 0;
  },

  runsSince(id: string, sinceDate: string): number {
    const found = employees.personFor(id);
    return (found?.config.runs ?? [])
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
