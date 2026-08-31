import { limits } from "./limits";
import { approvals, reviews } from "./store";
import { articles, pins } from "../lib/store";
import { errors } from "./store";

/**
 * 「投稿の承認（GO）を外してよいか」を、データから判定する。
 *
 * ★なぜこれをコードにするのか
 *
 *   2026-08-31、オーナーは「最初はA案（毎回GOを押す）。しばらく運用して
 *   品質が保証できるようになったらB案（自動投稿）を提案して」と決めました。
 *
 *   この「品質が保証できるようになったら」を諭吉の記憶や感覚に任せると、
 *   ①いつまでも提案されない ②根拠なく早すぎる提案をする、のどちらかになります。
 *   どちらもオーナーの時間を損ないます。だから条件を数字にして、ここで数えます。
 *
 * ★AI はこの判定で自動化できません
 *
 *   ここが出すのは「オーナーに提案してよい状態か」だけです。
 *   実際のゲートは config/limits.json にあり、AI は書き換えられません（guard.yml）。
 *   最後に外すのは、必ずオーナー本人の操作です。
 *
 * ★数え方は「承認の履歴から毎回計算する」
 *
 *   カウンタを別に持つと、管理画面から GO を押したときに増えない・
 *   セッションが落ちるとずれる、といった食い違いが起きます。
 *   data/approvals.json を毎回読み直して数えれば、誰がどこで押しても同じ答になります。
 */

/** limits.json の autonomy キー → 承認の kind */
const GATE_TO_APPROVAL_KIND: Record<string, string> = {
  publishArticle: "publish_article",
  publishPins: "publish_pins",
  postToX: "post_x",
};

const GATE_LABEL: Record<string, string> = {
  publishArticle: "記事の公開",
  publishPins: "ピンの投稿",
  postToX: "X への投稿",
};

export interface Condition {
  /** オーナーが読んで分かる言い方。専門用語を使わない */
  label: string;
  met: boolean;
  /** いまの状態（例: "3 回 / 必要 20 回"） */
  progress: string;
}

export interface GateReadiness {
  gate: string;
  label: string;
  /** そもそも自動化を想定していないゲート（limits.json の autoAfter が null） */
  neverAuto: boolean;
  conditions: Condition[];
  /** 全部の条件を満たしたか */
  ready: boolean;
  /** まだ一度も承認していない＝提案の話をする段階ですらない */
  notStarted: boolean;
}

function daysBetween(fromIso: string, to = Date.now()): number {
  return Math.floor((to - new Date(fromIso).getTime()) / 86_400_000);
}

/**
 * 直近の連続GO数と、数え始めた日を返す。
 *
 * STOP が入ったら 0 に戻します。「一度でも止められた」＝品質が保証されていない、
 * という意味だからです。
 * 期限切れ（expired）は 0 に戻しません。オーナーが忙しかっただけで、
 * 中身を否定されたわけではないためです（ただし GO としても数えません）。
 */
function consecutiveGo(kind: string): { count: number; since: string | null } {
  const decided = approvals.all()
    .filter((a) => a.kind === kind && a.decidedAt)
    .sort((a, b) => String(a.decidedAt).localeCompare(String(b.decidedAt)));

  let count = 0;
  let since: string | null = null;
  for (const a of decided) {
    if (a.status === "go") {
      if (count === 0) since = a.decidedAt;
      count++;
    } else if (a.status === "stop") {
      count = 0;
      since = null;
    }
  }
  return { count, since };
}

export function gateReadiness(gate: string): GateReadiness {
  const l = limits();
  const label = GATE_LABEL[gate] ?? gate;
  const rule = l.autonomy[gate]?.autoAfter ?? null;
  const kind = GATE_TO_APPROVAL_KIND[gate] ?? gate;

  if (!rule) {
    return { gate, label, neverAuto: true, conditions: [], ready: false, notStarted: false };
  }

  const { count, since } = consecutiveGo(kind);
  const needCount = Number(rule.consecutiveApprovals ?? 0);
  const needDays = Number(rule.minDays ?? 0);

  const conditions: Condition[] = [
    {
      label: `STOP を1度も挟まずに GO が ${needCount} 回続いている`,
      met: count >= needCount,
      progress: `${count} 回 / 必要 ${needCount} 回`,
    },
  ];

  const days = since ? daysBetween(since) : 0;
  conditions.push({
    label: `その状態が ${needDays} 日以上続いている`,
    met: since !== null && days >= needDays,
    progress: since ? `${days} 日 / 必要 ${needDays} 日` : `まだ0日 / 必要 ${needDays} 日`,
  });

  if (rule.zeroQaFailures) {
    // 数え始めてから、梅子の検品で「作り直し」「判断がつかない」が出ていないこと
    const bad = reviews.all().filter(
      (r) => ["reject", "needs_human"].includes(r.verdict) && (!since || r.at >= since),
    );
    conditions.push({
      label: "梅子の検品で「作り直し」「判断がつかない」が1件も出ていない",
      met: bad.length === 0,
      progress: bad.length === 0 ? "0 件" : `${bad.length} 件あり`,
    });
  }

  /* ── ここから下は limits.json より厳しい、諭吉が足した条件 ────────────
   *
   * 安全装置を緩める向きには足せません（それは limits.json＝オーナーの領分）。
   * 足せるのは「もっと慎重にする」向きだけです。
   * オーナーが自分で引っ込めた実績があるうちは、品質は保証されていません。
   */
  const withdrawnAfter = articles.all().filter(
    (a) => a.status === "withdrawn" && (!since || String(a.withdrawnAt ?? "") >= since),
  ).length;
  const takenDownAfter = pins.all().filter(
    (p) => p.takedownRequestedAt && (!since || p.takedownRequestedAt >= since),
  ).length;
  conditions.push({
    label: "なおきさんが取り下げた記事・削除したピンが1件もない",
    met: withdrawnAfter + takenDownAfter === 0,
    progress: withdrawnAfter + takenDownAfter === 0
      ? "0 件"
      : `記事 ${withdrawnAfter} 本・ピン ${takenDownAfter} 枚`,
  });

  const openErrors = errors.all().filter((e) => !e.handled).length;
  conditions.push({
    label: "未処理の失敗が残っていない",
    met: openErrors === 0,
    progress: `${openErrors} 件`,
  });

  return {
    gate,
    label,
    neverAuto: false,
    conditions,
    ready: conditions.every((c) => c.met),
    notStarted: count === 0 && since === null,
  };
}

export function autonomyReadiness(): GateReadiness[] {
  return Object.keys(limits().autonomy).map(gateReadiness);
}

/** `co status` に出す短い要約。まだ何も始まっていないときは null（余計なことを出さない）。 */
export function autonomySummary(): string[] | null {
  const all = autonomyReadiness().filter((g) => !g.neverAuto);
  const started = all.filter((g) => !g.notStarted);
  if (started.length === 0) return null;

  const lines: string[] = [];
  for (const g of started) {
    if (g.ready) {
      lines.push(`★ 【${g.label}】は自動化の条件をすべて満たしました。`);
      lines.push("  なおきさんに『毎回の GO をやめてよいか』をA案/B案で提案してください。");
      lines.push("  外すのはなおきさん本人の操作です（config/limits.json は AI が触れません）。");
    } else {
      const done = g.conditions.filter((c) => c.met).length;
      lines.push(`【${g.label}】自動化までの条件 ${done}/${g.conditions.length}`);
      for (const c of g.conditions) {
        lines.push(`    ${c.met ? "✓" : "・"} ${c.label} … ${c.progress}`);
      }
    }
  }
  lines.push("");
  lines.push("いまは A案（毎回 GO を押す）で運用中です。2026-08-31 のオーナー判断。");
  return lines;
}
