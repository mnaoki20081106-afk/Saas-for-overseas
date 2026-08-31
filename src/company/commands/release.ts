import { log } from "../../lib/log";
import { articles, pins as pinStore } from "../../lib/store";
import type { Pin } from "../../lib/types";
import { schedule, schedulingSummary } from "../../stages/pins";
import { limits } from "../limits";
import { approvals } from "../store";

/**
 * 承認された仕事を「実行できる状態」に進める工程。
 *
 * ここが承認ゲートの実体です。
 * ピンに approvalId が入るのは **この関数を通ったときだけ** で、
 * この関数は承認が go でなければ何もしません。
 *
 * 投稿そのものは GitHub Actions（秘密情報を持つ側）が行い、
 * そこでも approvalId を再確認します。二重の防御です。
 */

export interface ScheduleResult {
  articleSlug: string;
  approvalId: string;
  scheduled: number;
  skipped: number;
}

export function scheduleApprovedPins(articleSlug: string, approvalId: string): ScheduleResult {
  const approval = approvals.all().find((a) => a.id === approvalId);
  if (!approval) {
    throw new Error(
      `承認が見つかりません: ${approvalId}\n` +
      "`npm run co -- approval:list --all` で確認してください。",
    );
  }
  if (approval.status !== "go") {
    throw new Error(
      `承認 ${approvalId} は「${approval.status}」です。GO でなければ予約できません。\n` +
      (approval.status === "pending"
        ? "なおきさんが /admin/ で GO を押すまで待ってください。"
        : approval.status === "expired"
          ? "期限切れです。実行しません。必要なら改めて承認依頼を出してください。"
          : `却下されています${approval.decisionNote ? `: ${approval.decisionNote}` : ""}`),
    );
  }

  const article = articles.bySlug(articleSlug);
  if (!article) throw new Error(`記事が見つかりません: ${articleSlug}`);

  const l = limits();
  const all = pinStore.all();
  const targets = all.filter(
    (p) => p.articleSlug === articleSlug && (p.status === "draft" || p.status === "queued"),
  );
  if (targets.length === 0) {
    log.info("予約できるピンがありません（すでに予約済みか、まだ作られていません）。");
    return { articleSlug, approvalId, scheduled: 0, skipped: 0 };
  }

  // 画像のないピンは投稿できないので予約しない
  const ready = targets.filter((p) => p.imagePath);
  const skipped = targets.length - ready.length;
  if (skipped) {
    log.warn(`${skipped} 枚は画像がないため予約しません。\`npm run co -- pins:render\` を先に実行してください。`);
  }

  // ★承認IDを刻む。これが無いピンは Actions が投稿しない。
  const stamped: Pin[] = ready.map((p) => ({ ...p, approvalId }));
  const scheduled = schedule(stamped);

  const rest = all.filter((p) => !ready.some((r) => r.id === p.id));
  pinStore.save([...rest, ...scheduled]);

  const n = scheduled.filter((p) => p.status === "scheduled").length;
  log.ok(`${n} 枚を予約しました（承認 ${approvalId} / 記事 ${articleSlug}）`);
  log.info(schedulingSummary());
  log.info(
    `1日あたりの投稿上限は ${l.output.maxPinsPublishedPerDay} 枚です。` +
    "新規アカウントは段階的に増える設定になっています（スパム判定を避けるため）。",
  );
  return { articleSlug, approvalId, scheduled: n, skipped };
}

/**
 * 承認された記事を公開対象にする。
 * サイトの生成自体は Actions が行うので、ここでは状態を進めるだけ。
 */
export function releaseArticle(slug: string, approvalId: string): void {
  const approval = approvals.all().find((a) => a.id === approvalId);
  if (!approval || approval.status !== "go") {
    throw new Error(`承認 ${approvalId} が GO ではありません。記事を公開対象にできません。`);
  }
  const a = articles.bySlug(slug);
  if (!a) throw new Error(`記事が見つかりません: ${slug}`);
  if (a.status !== "published") {
    throw new Error(
      `記事 ${slug} は「${a.status}」です。Editor の検品を通っていません。\n` +
      "検品を通さずに公開することはできません。",
    );
  }
  log.ok(`${slug} は公開対象です（承認 ${approvalId}）。次のサイトビルドで公開されます。`);
}
