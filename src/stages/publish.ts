import { config, env } from "../lib/config";
import { log } from "../lib/log";
import { articles, pins as pinStore, state } from "../lib/store";
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
  const due = pinStore
    .all()
    .filter((p) => p.status === "scheduled" && p.scheduledAt)
    .filter((p) => opts.force || new Date(p.scheduledAt!).getTime() <= now)
    .sort((a, b) => (a.scheduledAt! < b.scheduledAt! ? -1 : 1));

  if (due.length === 0) {
    log.info("投稿すべきピンはありません");
    return result;
  }

  if (!env.pinterest.configured) {
    log.human(`投稿待ちのピンが ${due.length} 枚ありますが、Pinterest の認証情報が未設定です。`);
    log.info("TODO-HUMAN.md の「Pinterest のビジネスアカウントと API アプリを作る」を済ませてください。");
    log.info("画像と文案は assets/pins/ と data/pins.json に既にあるので、手動投稿もできます。");
    result.dueRemaining = due.length;
    return result;
  }

  const limit = opts.limit ?? c.pins.publishPerDay;
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
