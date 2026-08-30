import { z } from "zod";
import { config } from "../lib/config";
import { structured, withFixture } from "../lib/claude";
import { log } from "../lib/log";
import { articles, pins as pinStore, programs } from "../lib/store";
import type { Article, Pin } from "../lib/types";
import { uid } from "../lib/util";
import { TEMPLATE_IDS } from "../pins/templates";
import { renderPins, type RenderRequest } from "../pins/render";
import { readArticleBody } from "./content";
import { templateRanking } from "./optimize";

const PinCopy = z.object({
  templateId: z.enum(TEMPLATE_IDS).describe("Which visual template fits this angle"),
  title: z.string().describe("Pinterest pin title. <=95 characters. Must contain a number or a concrete noun. No emoji. No year."),
  description: z.string().describe("Pinterest description body, 140-320 characters, keyword-rich but readable, written to a person not a crawler. Ends with 2-4 lowercase hashtags. Do NOT write your own affiliate/sponsored disclosure or use the words affiliate/sponsored/ad anywhere in this field — a compliant disclosure is prepended automatically outside this field."),
  overlayTop: z.string().describe("Small uppercase kicker on the image. <=28 characters."),
  overlayMain: z.string().describe("The big headline on the image. <=60 characters. This is what makes the click happen."),
  overlayBottom: z.string().describe("Supporting line on the image, <=90 characters. For the 'checklist' template use 3-5 short items separated by | . For 'versus' put the differentiator here."),
  altText: z.string().describe("Accessible description of the graphic, <=120 characters"),
  angleName: z.string().describe("Two or three words naming the psychological angle, e.g. 'cost objection', 'switching fear'"),
});

const PinSet = z.object({ pins: z.array(PinCopy) });

const PIN_SYSTEM = `You design Pinterest pins for English-language software comparison content.

What you know about this surface:
- Pinterest is a search engine with a visual front end. The pin title and description are indexed.
- The click happens because the image text names a specific problem or a specific number.
  Vague benefit language ("boost your productivity") gets impressions and no clicks.
- Ten pins for one article must attack ten DIFFERENT angles, not ten rewordings of the same angle.
  Angles that work: price objection, hidden limit, switching cost, "I was wrong about X",
  a concrete number, a specific team size, a specific workflow, the thing nobody mentions,
  the free-plan trap, and the "who should not buy this" angle.
- Never date the pin. No years, no "new", no "latest". A pin must still make sense in two years.
- No emoji in titles. Hashtags only at the end of the description, lowercase, 2-4 of them.
- Overlay text is set in a 1000x1500 graphic. Long lines shrink and look weak — respect the limits.
- A short affiliate disclosure is prepended to every description outside of what you write, so that
  it appears before the fold (Pinterest and the FTC require disclosure to be visible without a click).
  Never write your own disclosure and never use the words "affiliate", "sponsored", or "ad" — that
  would duplicate it and read as spam.`;

/** これまでの実測 CTR を生成プロンプトに戻し、効いているテンプレートを厚くする */
function performanceHint(): string {
  const ranking = templateRanking().filter((r) => r.pins >= 2);
  if (ranking.length < 2) return "";
  const best = ranking.slice(0, 2).map((r) => `${r.templateId} (${r.ctrPct}%)`).join(", ");
  const worst = ranking[ranking.length - 1];
  return `- Our own measured results so far: best templates are ${best}; weakest is ${worst.templateId} (${worst.ctrPct}%). Weight the mix toward the best ones and use the weakest at most once.`;
}

/**
 * FTC / Pinterest は「開示はリンクの手前・折りたたまれる前」に必要とする。
 * モデルの言葉選びに委ねず、常にプログラム側で説明文の先頭に固定で挿入する。
 */
function withDisclosure(body: string): string {
  const prefix = config().compliance.pinDisclosurePrefix;
  const budget = Math.max(0, 500 - prefix.length);
  return `${prefix}${body.trim().slice(0, budget)}`;
}

function boardFor(category: string): string {
  return `${category.replace(/\b\w/g, (m) => m.toUpperCase())} Tools`;
}

function fixtureCopy(article: Article, n: number): z.infer<typeof PinSet> {
  return {
    pins: Array.from({ length: n }, (_, i) => ({
      templateId: TEMPLATE_IDS[i % TEMPLATE_IDS.length],
      title: `${article.title.slice(0, 60)} — angle ${i + 1}`,
      description: `Sample DRY_RUN description for ${article.title}. Replace by setting ANTHROPIC_API_KEY. #saas #smallbusiness`,
      overlayTop: "DRY RUN",
      overlayMain: `Sample headline ${i + 1}`,
      overlayBottom: i % TEMPLATE_IDS.length === 2 ? "point one | point two | point three" : "Sample supporting line for the DRY_RUN pin.",
      altText: `Sample pin graphic ${i + 1} for ${article.title}`,
      angleName: `sample angle ${i + 1}`,
    })),
  };
}

function pinPrompt(article: Article, body: string, extra: string): string {
  const c = config();
  const progs = article.programSlugs
    .map((s) => programs.bySlug(s))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  return `Design ${c.pins.perArticle} Pinterest pins for this article.

## Article
Title: ${article.title}
Primary keyword: ${article.primaryKeyword}
Secondary keywords: ${article.secondaryKeywords.join(", ")}
Category: ${article.category}
Destination: ${c.site.baseUrl}/articles/${article.slug}/

## Reader
${c.niche.audience}

## Products covered
${progs.map((p) => `- ${p.name}: ${p.targetPains.join("; ")}`).join("\n") || "(none)"}

## Article body (use real details from it — specific beats clever)
${body.slice(0, 9000)}

${extra}

## Rules
- ${c.pins.perArticle} pins, ${c.pins.perArticle} genuinely different angles.
- Spread the templates: use each of ${TEMPLATE_IDS.join(", ")} at least once.
${performanceHint()}
- overlayMain <= 60 characters. overlayTop <= 28. overlayBottom <= 90.
- For templateId "checklist", overlayBottom must be 3-5 short items separated by " | ".
- For templateId "versus", overlayMain must be exactly "A vs B" using the two product names.
- Descriptions must not promise results. Describe what the reader will learn.
- Every description body ends with ${c.compliance.pinDisclosureSuffix} plus 2-3 topical lowercase hashtags.
- Do not open with a disclosure — "${c.compliance.pinDisclosurePrefix.trim()}" is added automatically before your text.`;
}

export interface PinGenResult { created: number; pins: Pin[] }

export async function generatePinsForArticle(
  articleSlug: string,
  opts: { generation?: number; parentPinId?: string | null; extraInstruction?: string; count?: number } = {},
): Promise<PinGenResult> {
  const c = config();
  const article = articles.bySlug(articleSlug);
  if (!article) throw new Error(`記事が見つかりません: ${articleSlug}`);

  const count = opts.count ?? c.pins.perArticle;
  const body = readArticleBody(article);

  const set = await withFixture(
    () => fixtureCopy(article, count),
    () =>
      structured(PinSet, {
        system: PIN_SYSTEM,
        user: pinPrompt(article, body, opts.extraInstruction ?? ""),
        stage: "pins",
        label: `ピン ${count} 枚の文案: ${article.slug}`,
        effort: "high",
        maxTokens: 12000,
      }),
  );

  const destination = `${c.site.baseUrl}/articles/${article.slug}/?utm_source=pinterest&utm_medium=social&utm_campaign=${article.slug}`;
  const board = boardFor(article.category);
  const existingCount = pinStore.all().length;

  // 配色は既存枚数から順番に回して、ボード全体の見た目が偏らないようにする
  const newPins: Pin[] = set.pins.slice(0, count).map((p) => ({
    id: uid("pin"),
    articleSlug: article.slug,
    templateId: p.templateId,
    title: p.title.slice(0, 100),
    description: withDisclosure(p.description),
    overlayTop: p.overlayTop.slice(0, 32),
    overlayMain: p.overlayMain.slice(0, 72),
    overlayBottom: p.overlayBottom.slice(0, 110),
    altText: p.altText.slice(0, 500),
    boardName: board,
    imagePath: "",
    destinationUrl: destination,
    status: "queued",
    scheduledAt: null,
    publishedAt: null,
    pinterestPinId: null,
    parentPinId: opts.parentPinId ?? null,
    generation: opts.generation ?? 0,
    metrics: undefined,
  }));

  const requests: RenderRequest[] = newPins.map((p, i) => ({
    id: p.id,
    templateId: p.templateId,
    data: {
      overlayTop: p.overlayTop,
      overlayMain: p.overlayMain,
      overlayBottom: p.overlayBottom,
      siteName: c.site.name,
      width: c.pins.width,
      height: c.pins.height,
      paletteIndex: existingCount + i,
    },
  }));

  const rendered = await renderPins(requests);
  for (const p of newPins) p.imagePath = rendered.get(p.id) ?? "";

  const scheduled = schedule(newPins);
  pinStore.addMany(scheduled);
  log.ok(`ピン ${scheduled.length} 枚を作成・予約しました（${article.slug}）`);
  return { created: scheduled.length, pins: scheduled };
}

/**
 * 予約投稿の時刻を決める。
 * - 1日あたり publishPerDay 枚まで
 * - ピンとピンの間は minMinutesBetweenPins 以上
 * - 投稿時刻は postingHoursUtc（Pinterest の US 夕方帯を狙う）
 */
export function schedule(newPins: Pin[], from: Date = new Date()): Pin[] {
  const c = config();
  const taken = pinStore
    .all()
    .filter((p) => p.status === "scheduled" || p.status === "queued")
    .map((p) => (p.scheduledAt ? new Date(p.scheduledAt).getTime() : 0))
    .filter(Boolean)
    .sort((a, b) => a - b);

  const perDay = new Map<string, number>();
  for (const t of taken) {
    const day = new Date(t).toISOString().slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }

  const hours = [...c.pins.postingHoursUtc].sort((a, b) => a - b);
  const gapMs = c.pins.minMinutesBetweenPins * 60_000;
  const out: Pin[] = [];
  let cursor = new Date(from.getTime());

  for (const pin of newPins) {
    let slot: number | null = null;
    for (let dayOffset = 0; dayOffset < 120 && slot === null; dayOffset++) {
      const day = new Date(cursor.getTime() + dayOffset * 86_400_000);
      const dayKey = day.toISOString().slice(0, 10);
      if ((perDay.get(dayKey) ?? 0) >= c.pins.publishPerDay) continue;

      for (const h of hours) {
        const candidate = Date.UTC(
          day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h,
          (pin.generation * 7) % 60, 0, 0,
        );
        if (candidate < from.getTime() + 60_000) continue;
        if (taken.some((t) => Math.abs(t - candidate) < gapMs)) continue;
        slot = candidate;
        break;
      }
      if (slot !== null) {
        perDay.set(dayKey, (perDay.get(dayKey) ?? 0) + 1);
      }
    }

    if (slot === null) {
      out.push({ ...pin, status: "queued", scheduledAt: null });
      continue;
    }
    taken.push(slot);
    taken.sort((a, b) => a - b);
    out.push({ ...pin, status: "scheduled", scheduledAt: new Date(slot).toISOString() });
  }

  return out;
}

export function schedulingSummary(): string {
  const upcoming = pinStore
    .all()
    .filter((p) => p.status === "scheduled" && p.scheduledAt)
    .sort((a, b) => (a.scheduledAt! < b.scheduledAt! ? -1 : 1));
  if (upcoming.length === 0) return "予約中のピンはありません";
  const last = upcoming[upcoming.length - 1].scheduledAt!.slice(0, 10);
  return `予約中 ${upcoming.length} 枚（${upcoming[0].scheduledAt!.slice(0, 16).replace("T", " ")} UTC 〜 ${last} まで）`;
}

