import { env } from "../lib/config";
import { log } from "../lib/log";
import { pins as pinStore } from "../lib/store";
import { deletePin, PinterestError } from "../integrations/pinterest";
import { nowISO } from "../lib/util";

/**
 * 投稿の取り消しを実行する。
 *
 * なおきさんが管理画面で「Pinterestから削除する」を押すと、
 * data/pins.json のそのピンに takedownRequestedAt が入ります。
 * ここはそれを読んで、実際に Pinterest から削除するだけです。
 *
 * ★設計の意図
 *   取り消しは「人が押したときだけ」起きます。AI は takedownRequestedAt を
 *   自分で書きません（AI が勝手に投稿を消せると、事故の痕跡まで消えてしまうため）。
 *   逆に、削除の実行に人の承認は要りません。**消すのはいつでも安全側だからです。**
 *   投稿するときだけ承認ゲートを通します。
 *
 * 予約中（まだ投稿していない）ピンの取り消しは、ここでは何もしません。
 * 管理画面が status を skipped にした時点で、publishDuePins が拾わなくなります。
 */
export interface TakedownResult {
  takenDown: number;
  alreadyGone: number;
  failed: number;
  pending: number;
  errors: string[];
}

export async function processTakedowns(): Promise<TakedownResult> {
  const result: TakedownResult = { takenDown: 0, alreadyGone: 0, failed: 0, pending: 0, errors: [] };

  const list = pinStore.all();
  const requested = list.filter(
    (p) => p.takedownRequestedAt && p.status === "published" && p.pinterestPinId,
  );

  // 投稿していないのに削除依頼が付いているものは、データを整えるだけで済む。
  const neverPublished = list.filter(
    (p) => p.takedownRequestedAt && p.status !== "published" && p.status !== "taken_down",
  );
  for (const pin of neverPublished) {
    pin.status = "skipped";
    pin.cancelledAt = pin.cancelledAt ?? nowISO();
    log.info(`${pin.id} はまだ投稿されていないので、予約の取り消しだけを記録しました`);
  }

  if (requested.length === 0) {
    if (neverPublished.length > 0) pinStore.save(list);
    return result;
  }

  log.step(`なおきさんが取り消したピンを Pinterest から削除します（${requested.length} 枚）`);

  if (!env.pinterest.configured) {
    // 認証情報がないと消せない。ここで黙って成功にすると「消えたつもり」になるので、
    // 依頼は残したまま、人の手で消せるように URL を出す。
    log.human(`削除依頼が ${requested.length} 枚ありますが、Pinterest の認証情報が未設定です。`);
    for (const pin of requested) {
      log.info(`  手動で削除してください: https://www.pinterest.com/pin/${pin.pinterestPinId}/`);
    }
    result.pending = requested.length;
    if (neverPublished.length > 0) pinStore.save(list);
    return result;
  }

  for (const pin of requested) {
    try {
      const { alreadyGone } = await deletePin(pin.pinterestPinId!);
      pin.status = "taken_down";
      pin.takenDownAt = nowISO();
      pin.lastError = undefined;
      if (alreadyGone) {
        result.alreadyGone++;
        log.info(`${pin.id} は Pinterest 側にすでにありませんでした（結果は同じなので完了とします）`);
      } else {
        result.takenDown++;
        log.ok(`${pin.id} を Pinterest から削除しました`);
      }
    } catch (err) {
      result.failed++;
      const msg = err instanceof PinterestError ? err.message : String(err);
      pin.lastError = `削除に失敗: ${msg}`;
      result.errors.push(`${pin.id}: ${msg}`);
      log.warn(`${pin.id} の削除に失敗しました。依頼は残すので、次の実行でもう一度試します。`);
      log.info(`  すぐ消したい場合は手動で: https://www.pinterest.com/pin/${pin.pinterestPinId}/`);
    }
  }

  pinStore.save(list);

  if (result.failed > 0) {
    log.human(`${result.failed} 枚がまだ削除できていません。次の実行で自動的に再試行します。`);
  }
  return result;
}
