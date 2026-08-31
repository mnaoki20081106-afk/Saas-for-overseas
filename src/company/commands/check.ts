import fs from "node:fs";
import { z } from "zod";
import { log } from "../../lib/log";
import { P } from "../../lib/paths";
import { readJson, articles, pins as pinStore } from "../../lib/store";
import { todayISO } from "../../lib/util";
import { limits } from "../limits";
import {
  Approval, ContentIdea, Decision, ErrorRecord, Experiment, KpiSnapshot,
  ResearchCandidate, Review, Task,
} from "../schemas";
import { CP, approvals } from "../store";

/**
 * データとルールの検査。
 *
 * これは guard.yml（GitHub Actions）から実行されます。
 * つまり **AI が書いた commit を、AI が触れないコードが検査する** という構造です。
 * ここで落ちれば CI が赤くなり、main にマージされません。
 *
 * AI が安全装置を外そうとしても、その commit 自体が通りません。
 */

export interface CheckIssue {
  severity: "error" | "warn";
  where: string;
  message: string;
}

function checkList<T extends z.ZodType>(
  file: string, schema: T, label: string, issues: CheckIssue[],
): void {
  if (!fs.existsSync(file)) return;
  const rel = file.replace(`${P.root}/`, "");
  let raw: unknown;
  try {
    raw = readJson<unknown>(file, []);
  } catch (err) {
    issues.push({ severity: "error", where: rel, message: `JSON として読めません: ${(err as Error).message}` });
    return;
  }
  if (!Array.isArray(raw)) {
    issues.push({ severity: "error", where: rel, message: "配列であるべきファイルが配列ではありません" });
    return;
  }
  raw.forEach((item, i) => {
    const r = schema.safeParse(item);
    if (!r.success) {
      for (const issue of r.error.issues.slice(0, 3)) {
        issues.push({
          severity: "error",
          where: `${rel}[${i}]`,
          message: `${label}: ${issue.path.join(".") || "(ルート)"} — ${issue.message}`,
        });
      }
    }
  });
}

/** 承認ゲート：承認レコードのない公開状態が存在しないこと。ここが破れたら重大事故。 */
function checkApprovalGate(issues: CheckIssue[]): number {
  const l = limits();
  if (!l.gates.publishPins?.requiresApproval) return 0;

  const approvedIds = new Set(approvals.all().filter((a) => a.status === "go").map((a) => a.id));
  let violations = 0;

  for (const pin of pinStore.all() as unknown as Record<string, unknown>[]) {
    const status = String(pin.status);
    // draft / queued は「外に出ていない」ので承認不要。
    // scheduled 以降（＝投稿の対象になる）には必ず承認が必要。
    if (!["scheduled", "published"].includes(status)) continue;
    const approvalId = pin.approvalId as string | null | undefined;
    if (!approvalId || !approvedIds.has(approvalId)) {
      violations++;
      issues.push({
        severity: "error",
        where: `data/pins.json#${pin.id}`,
        message:
          `承認のないピンが ${status} になっています（approvalId=${approvalId ?? "null"}）。` +
          "承認ゲートが破れています。co で予約すれば必ず承認IDが付きます。手で書き換えないでください。",
      });
    }
  }
  return violations;
}

/** 安全装置そのものが改変されていないこと */
function checkGuardFilesIntact(issues: CheckIssue[]): void {
  if (!fs.existsSync(CP.limits)) {
    issues.push({ severity: "error", where: "config/limits.json", message: "安全装置の設定ファイルがありません" });
    return;
  }
  const l = readJson<Record<string, unknown>>(CP.limits, {});
  for (const key of ["output", "routine", "duplication", "quality", "gates", "approval", "killSwitch"]) {
    if (!l[key]) {
      issues.push({
        severity: "error",
        where: "config/limits.json",
        message: `必須セクション "${key}" がありません。安全装置が壊れています。`,
      });
    }
  }
  const gates = l.gates as Record<string, { requiresApproval?: boolean }> | undefined;
  for (const gate of ["publishArticle", "publishPins", "postToX"]) {
    if (gates?.[gate]?.requiresApproval === false) {
      issues.push({
        severity: "warn",
        where: "config/limits.json",
        message:
          `${gate} の承認が不要になっています。自律レベルを上げたのであれば正常ですが、` +
          "AI が勝手に外していないか確認してください（→ SECURITY.md）。",
      });
    }
  }
}

/** 上限を超えていないこと */
function checkLimits(issues: CheckIssue[]): void {
  const l = limits();
  const today = todayISO();

  const publishedToday = pinStore.all().filter((p) => p.publishedAt?.startsWith(today)).length;
  if (publishedToday > l.output.maxPinsPublishedPerDay) {
    issues.push({
      severity: "error",
      where: "data/pins.json",
      message:
        `本日 ${publishedToday} 枚投稿しています（上限 ${l.output.maxPinsPublishedPerDay}）。` +
        "Pinterest のスパム判定を受ける危険があります。",
    });
  }

  const perArticle = new Map<string, number>();
  for (const p of pinStore.all()) perArticle.set(p.articleSlug, (perArticle.get(p.articleSlug) ?? 0) + 1);
  for (const [slug, n] of perArticle) {
    if (n > l.output.maxPinsPerArticleTotal) {
      issues.push({
        severity: "warn",
        where: `data/pins.json (${slug})`,
        message: `1記事あたりのピンが ${n} 枚です（上限 ${l.output.maxPinsPerArticleTotal}）。`,
      });
    }
  }

  const pendingApprovals = approvals.all().filter((a) => a.status === "pending").length;
  if (pendingApprovals > l.output.maxPendingApprovals) {
    issues.push({
      severity: "warn",
      where: "data/approvals.json",
      message: `承認待ちが ${pendingApprovals} 件です（上限 ${l.output.maxPendingApprovals}）。`,
    });
  }
}

/** 記事とピンの整合性 */
function checkReferences(issues: CheckIssue[]): void {
  const slugs = new Set(articles.all().map((a) => a.slug));
  for (const p of pinStore.all()) {
    if (!slugs.has(p.articleSlug)) {
      issues.push({
        severity: "error",
        where: `data/pins.json#${p.id}`,
        message: `存在しない記事を指しています: ${p.articleSlug}`,
      });
    }
  }
  for (const a of articles.all()) {
    const full = `${P.root}/${a.filePath}`;
    if (!fs.existsSync(full)) {
      issues.push({
        severity: "error",
        where: `data/articles.json#${a.slug}`,
        message: `本文ファイルがありません: ${a.filePath}`,
      });
    }
  }
}

export interface CheckResult {
  issues: CheckIssue[];
  errors: number;
  warnings: number;
  unapprovedPublishCount: number;
}

export function runCheck(): CheckResult {
  log.step("会社のデータと安全装置を検査します");
  const issues: CheckIssue[] = [];

  checkList(CP.tasks, Task, "task", issues);
  checkList(CP.approvals, Approval, "approval", issues);
  checkList(CP.decisions, Decision, "decision", issues);
  checkList(CP.research, ResearchCandidate, "research", issues);
  checkList(CP.ideas, ContentIdea, "idea", issues);
  checkList(CP.reviews, Review, "review", issues);
  checkList(CP.experiments, Experiment, "experiment", issues);
  checkList(CP.kpis, KpiSnapshot, "kpi", issues);
  checkList(CP.errors, ErrorRecord, "error", issues);

  checkGuardFilesIntact(issues);
  const unapproved = checkApprovalGate(issues);
  checkLimits(issues);
  checkReferences(issues);

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warn").length;

  for (const i of issues) {
    const line = `${i.where}: ${i.message}`;
    if (i.severity === "error") log.error(line);
    else log.warn(line);
  }

  if (errorCount === 0 && warnCount === 0) log.ok("問題ありません");
  else log.info(`エラー ${errorCount} 件 / 警告 ${warnCount} 件`);

  if (unapproved > 0) {
    console.log("");
    log.error("🛑 承認なしの公開が検出されました。これは重大事故です。");
    log.error("   config/limits.json の killSwitch を有効にして、原因を調べてください。");
  }

  return { issues, errors: errorCount, warnings: warnCount, unapprovedPublishCount: unapproved };
}
