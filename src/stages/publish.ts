import { config, env } from "../lib/config";
import { log } from "../lib/log";
import { articles, pins as pinStore, state } from "../lib/store";
import { approvals } from "../company/store";
import { limits } from "../company/limits";
import { createPin, ensureBoard, PinterestError } from "../integrations/pinterest";
import type { Pin } from "../lib/types";
import { nowISO, sleep } from "../lib/util";

export interface PublishResult {
  published: number;
  failed: number;
  skipped: number;
  dueRemaining: number;
  errors: string[];
}

/** 予約時刻を過ぎたピンを Pinterest に投稿する。cron から数時間おきに叩く想定。 */
export async function publishDuePins(opts: { limit?: number; force?: boolean } = {}): Promise<PublishResult> {
  log.step("STEP 4 / 予約時刻を過ぎたピンを Pinterest に投稿する");
  const c = config();
  const result: PublishResult = { published: 0, failed: 0, skipped: 0, dueRemaining: 0, errors: [] };

  const now = Date.now();
  const scheduled = pinStore
    .all()
    .filter((p) => p.status === "scheduled" && p.scheduledAt)
    .filter((p) => opts.force || new Date(p.scheduledAt!).getTime() <= now)
    .sort((a, b) => (a.scheduledAt! < b.scheduledAt! ? -1 : 1));

  // ★承認ゲート（外部への副作用の直前で、もう一度確かめる）
  //
  // 承認レコードが go のピンだけを投稿する。AI がどれだけ間違えても、
  // なおきさんが GO を押していないピンは1枚も外に出ない。
  // ここは AI が編集しないコードなので、プロンプトの言い回しに左右されない。
  const l = limits();
  let due = scheduled;
  if (l.gates.publishPins?.requiresApproval ?? true) {
    const goIds = new Set(approvals.all().filter((a) => a.status === "go").map((a) => a.id));
    const approved = scheduled.filter((p) => p.approvalId && goIds.has(p.approvalId));
    const unapproved = scheduled.length - approved.length;
    if (unapproved > 0) {
      log.human(`${unapproved} 枚は承認がないため投稿しません。`);
      log.info("  /admin/ で GO を押すか、`npm run co -- approval:list` で承認待ちを確認してください。");
      log.info("  （旧経路 bootstrap / daily で作られたピンは承認IDを持たないため、ここで止まります）");
      result.skipped += unapproved;
    }
    due = approved;
  }

  if (due.length === 0) {
    log.info("投稿すべきピンはありません");
    return result;
  }

  // その日すでに投稿した実績を数え直す。予約時の計算が間違っていても、
  // ここで上限を超えないようにする（スパム判定はアカウント停止に直結するため）。
  const today = new Date().toISOString().slice(0, 10);
  const publishedToday = pinStore.all().filter((p) => p.publishedAt?.startsWith(today)).length;
  const remainingToday = Math.max(0, l.output.maxPinsPublishedPerDay - publishedToday);
  if (remainingToday === 0) {
    log.warn(`本日はすでに ${publishedToday} 枚投稿しています（上限 ${l.output.maxPinsPublishedPerDay}）。今日はここまでにします。`);
    result.dueRemaining = due.length;
    return result;
  }

  if (!env.pinterest.configured) {
    log.human(`投稿待ちのピンが ${due.length} 枚ありますが、Pinterest の認証情報が未設定です。`);
    log.info("TODO-HUMAN.md の「Pinterest のビジネスアカウントと API アプリを作る」を済ませてください。");
    log.info("画像と文案は assets/pins/ と data/pins.json に既にあるので、手動投稿もできます。");
    result.dueRemaining = due.length;
    return result;
  }

  const limit = Math.min(opts.limit ?? c.pins.publishPerDay, remainingToday);
  const batch = due.slice(0, limit);
  result.dueRemaining = due.length - batch.length;

  for (const pin of batch) {
    try {
      const boardId = await ensureBoard(pin.boardName, boardDescription(pin));
      const pinterestPinId = await createPin({
        boardId,
        title: pin.title,
        description: pin.description,
        altText: pin.altText,
        link: pin.destinationUrl,
        imagePath: pin.imagePath,
      });
      pinStore.update(pin.id, {
        status: "published",
        publishedAt: nowISO(),
        pinterestPinId,
        lastError: undefined,
      });
      result.published++;
      log.ok(`投稿: ${pin.title.slice(0, 60)} → pin ${pinterestPinId}`);
      await sleep(3000); // 連投しない（スパム判定を避ける）
    } catch (err) {
      const message = (err as Error).message;
      const retryable = err instanceof PinterestError && err.retryable;
      pinStore.update(pin.id, {
        status: retryable ? "scheduled" : "failed",
        lastError: message.slice(0, 500),
      });
      result.failed++;
      result.errors.push(`${pin.id}: ${message.slice(0, 200)}`);
      log.error(`投稿失敗 (${pin.id}): ${message.slice(0, 200)}`);
      if (err instanceof PinterestError && err.status === 401) {
        log.error("認証エラーです。PINTEREST_REFRESH_TOKEN を再取得してください（pinterest:auth）。");
        break;
      }
    }
  }

  state.patch({ lastPinPublishAt: nowISO() });
  log.ok(`投稿 ${result.published} 枚 / 失敗 ${result.failed} 枚 / 残り ${result.dueRemaining} 枚`);
  return result;
}

function boardDescription(pin: Pin): string {
  const c = config();
  const article = articles.bySlug(pin.articleSlug);
  const topic = article?.category ?? "software";
  return `Honest, hands-on comparisons of ${topic} for ${c.niche.audience}. Curated by ${c.site.name}.`;
}

/** 失敗したピンを予約に戻す（原因が解消したあとに使う） */
export function requeueFailedPins(): number {
  const list = pinStore.all();
  let n = 0;
  for (const p of list) {
    if (p.status !== "failed") continue;
    p.status = "scheduled";
    p.scheduledAt = new Date(Date.now() + 5 * 60_000 + n * 60_000).toISOString();
    p.lastError = undefined;
    n++;
  }
  if (n) pinStore.save(list);
  log.ok(`失敗した ${n} 枚を再予約しました`);
  return n;
}
