import { z } from "zod";
import { config, scoring } from "../lib/config";
import { research, structured, withFixture } from "../lib/claude";
import { log } from "../lib/log";
import { programs } from "../lib/store";
import type { Network, Program } from "../lib/types";
import { nowISO, slugify, clamp } from "../lib/util";

const NETWORKS = [
  "Impact", "ShareASale", "CJ", "PartnerStack", "Direct",
  "Rewardful", "FirstPromoter", "Tapfiliate", "Awin", "Unknown",
] as const;

const Candidate = z.object({
  name: z.string().describe("SaaS product name"),
  homepage: z.string().describe("Marketing homepage URL, https://..."),
  affiliateProgramUrl: z.string().describe("URL of the affiliate/partner program page"),
  network: z.enum(NETWORKS).describe("Affiliate network the program runs on"),
  category: z.string().describe("Product category, lowercase, e.g. 'email marketing'"),
  pricingFromUsd: z.number().describe("Cheapest paid plan in USD per month"),
  commissionModel: z.enum(["recurring", "one-time", "hybrid", "unknown"]),
  commissionRatePct: z.number().nullable().describe("Percent of subscription paid to the affiliate, null if flat-fee"),
  estMonthlyCommissionUsd: z.number().describe("Realistic USD earned per month per active referral"),
  estAvgRetentionMonths: z.number().describe("Realistic average months a referred customer keeps paying"),
  cookieDays: z.number().nullable(),
  japaneseCompetition: z.number().describe("1-10. 1 = essentially no Japanese-language content covers this tool"),
  englishCompetition: z.number().describe("1-10. 10 = saturated with fresh, thorough English comparison content already. 1 = existing English coverage is thin, outdated, or shallow -- a genuine content gap you can outrank, independent of the Japanese-competition question"),
  reliability: z.number().describe("1-10 confidence the program pays on time and is not about to shut down"),
  whyGoodFit: z.string().describe("2 sentences, concrete"),
  targetPains: z.array(z.string()).describe("3-5 concrete problems the buyer has before purchase"),
  mainCompetitors: z.array(z.string()).describe("2-4 competing products, for comparison articles"),
  evidence: z.array(z.string()).describe("URLs that back the commission and pricing claims"),
});

const CandidateList = z.object({ programs: z.array(Candidate) });
type CandidateT = z.infer<typeof Candidate>;

const RESEARCH_SYSTEM = `You are a senior affiliate-marketing analyst who has personally run six-figure
SaaS partner portfolios. You are rigorous and allergic to hype. You never invent commission numbers:
if you cannot verify a figure from a real page, you say so and give a conservative estimate labelled
as an estimate. You care about one thing: recurring revenue that survives twelve months.`;

function researchPrompt(known: Program[]): string {
  const c = config();
  const s = scoring();
  const knownList = known.length
    ? known.map((p) => `- ${p.name} (${p.category})`).join("\n")
    : "(none yet)";

  return `Find ${c.programs.discoverPerRun} SaaS affiliate programs that fit ALL of the hard criteria below.

## Hard criteria (a program that fails any of these is worthless to us)
1. The commission is RECURRING — paid every month for as long as the referred customer keeps paying.
   One-time bounties do not count.
2. Realistic earnings of at least $${s.hardFilters.minMonthlyCommissionUsd} per month per active referral.
3. Realistic average customer retention of at least ${s.hardFilters.minAvgRetentionMonths} months.
4. Runnable by an individual publisher with a small new site — no "10,000 monthly visitors" minimum,
   no enterprise-only partner gate.
5. Runs on one of: ${c.programs.allowedNetworks.join(", ")}.

## Strategic filter
Our unfair advantage is that we publish in ENGLISH for ${c.niche.geoFocus.join("/")} buyers while
almost nobody in the Japanese-speaking creator market covers these tools. So prefer tools where
Japanese-language coverage is thin or nonexistent (japaneseCompetition 1-3), even if English
competition is moderate. Deprioritise the tools every affiliate blog already writes about
(the very biggest names) unless the recurring economics are unusually good.

Separately, also check the ENGLISH side: search for existing English-language comparison articles
about the tool. If what you find is thin (a handful of listicle mentions, no real hands-on detail)
or outdated (written years ago, references discontinued plans or old pricing), that is a genuine
content gap independent of the Japanese question -- score englishCompetition low and say so in
whyGoodFit. A tool can be a great pick even with moderate Japanese competition if the existing
English coverage is stale enough that a current, detailed comparison would simply outrank it.

## Audience we sell to
${c.niche.audience}

## Categories we want to cover
${c.niche.categories.join(", ")}

## Already in our portfolio — DO NOT return these again
${knownList}

## Method
Use web search. For each program actually open the affiliate/partner page and the pricing page.
Verify: commission model, commission rate, cookie window, payout threshold, and the entry price point.
Where a number is not published, say "not published" and give your own conservative estimate.

## Output
Write structured research notes. For each program use this shape:

### <Product name>
- homepage:
- affiliate program page:
- network:
- category:
- entry price (USD/mo):
- commission model:
- commission rate:
- realistic $/month per active referral (and how you got there):
- realistic average retention in months (and why):
- cookie window:
- Japanese-language competition 1-10 (1 = nobody covers it) and the evidence:
- English competition 1-10:
- reliability 1-10:
- why it fits us (2 sentences):
- 3-5 concrete buyer pains:
- 2-4 competing products:
- evidence URLs:

Be concrete. A number with no reasoning attached is worse than no number.`;
}

function scoreProgram(p: CandidateT): number {
  const w = scoring().weights;
  const norm = {
    recurring: p.commissionModel === "recurring" ? 1 : p.commissionModel === "hybrid" ? 0.5 : 0,
    money: clamp(p.estMonthlyCommissionUsd / 100, 0, 1),
    retention: clamp(p.estAvgRetentionMonths / 24, 0, 1),
    jpBlueOcean: clamp((10 - p.japaneseCompetition) / 9, 0, 1),
    // 日本語競合ゼロでも、英語の比較記事がすでに大量にあるニッチはSEOで勝ちにくい。
    // 「既存記事が薄い/古い」というコンテンツギャップも独立した加点要素にする。
    enBlueOcean: clamp((10 - p.englishCompetition) / 9, 0, 1),
    cookie: clamp((p.cookieDays ?? 30) / 120, 0, 1),
    reliability: clamp(p.reliability / 10, 0, 1),
  };
  const raw =
    norm.recurring * (w.recurringCommission ?? 0) +
    norm.money * (w.monthlyCommissionUsd ?? 0) +
    norm.retention * (w.avgRetentionMonths ?? 0) +
    norm.jpBlueOcean * (w.japaneseCompetitionInverse ?? 0) +
    norm.enBlueOcean * (w.englishCompetitionInverse ?? 0) +
    norm.cookie * (w.cookieDays ?? 0) +
    norm.reliability * (w.programReliability ?? 0);
  return Math.round(raw * 10) / 10;
}

function passesHardFilters(p: CandidateT): string | null {
  const f = scoring().hardFilters;
  if (f.mustBeRecurring && p.commissionModel !== "recurring" && p.commissionModel !== "hybrid") {
    return "継続報酬ではない";
  }
  if (p.estMonthlyCommissionUsd < f.minMonthlyCommissionUsd) {
    return `月額報酬が $${f.minMonthlyCommissionUsd} 未満 ($${p.estMonthlyCommissionUsd})`;
  }
  if (p.estAvgRetentionMonths < f.minAvgRetentionMonths) {
    return `平均継続が ${f.minAvgRetentionMonths}ヶ月 未満 (${p.estAvgRetentionMonths})`;
  }
  if (p.japaneseCompetition > f.maxJapaneseCompetition) {
    return `日本語競合が多い (${p.japaneseCompetition}/10)`;
  }
  return null;
}

function toProgram(c: CandidateT): Program {
  const slug = slugify(c.name);
  return {
    slug,
    name: c.name,
    homepage: c.homepage,
    signupUrl: c.homepage,
    affiliateProgramUrl: c.affiliateProgramUrl,
    network: (NETWORKS as readonly string[]).includes(c.network) ? (c.network as Network) : "Unknown",
    category: c.category.toLowerCase(),
    pricingFromUsd: c.pricingFromUsd,
    commissionModel: c.commissionModel,
    commissionRatePct: c.commissionRatePct,
    estMonthlyCommissionUsd: c.estMonthlyCommissionUsd,
    estAvgRetentionMonths: c.estAvgRetentionMonths,
    cookieDays: c.cookieDays,
    japaneseCompetition: c.japaneseCompetition,
    englishCompetition: c.englishCompetition,
    reliability: c.reliability,
    whyGoodFit: c.whyGoodFit,
    targetPains: c.targetPains,
    mainCompetitors: c.mainCompetitors,
    score: scoreProgram(c),
    status: "candidate",
    discoveredAt: nowISO(),
    evidence: c.evidence,
  };
}

/** DRY_RUN 用の雛形。API キーなしでもパイプライン全体を通せるようにする。 */
function fixtureCandidates(): { programs: CandidateT[] } {
  const base = (
    name: string, category: string, price: number, rate: number,
    monthly: number, retention: number, jp: number,
  ): CandidateT => ({
    name,
    homepage: `https://${slugify(name)}.example.com`,
    affiliateProgramUrl: `https://${slugify(name)}.example.com/affiliates`,
    network: "PartnerStack",
    category,
    pricingFromUsd: price,
    commissionModel: "recurring",
    commissionRatePct: rate,
    estMonthlyCommissionUsd: monthly,
    estAvgRetentionMonths: retention,
    cookieDays: 90,
    japaneseCompetition: jp,
    englishCompetition: 6,
    reliability: 8,
    whyGoodFit: `${name} pays a lifetime recurring share on a plan small teams rarely cancel. Sample data for DRY_RUN only.`,
    targetPains: [
      "paying for three overlapping tools",
      "cannot see which channel actually produced revenue",
      "onboarding a new contractor takes a full day",
    ],
    mainCompetitors: ["Competitor A", "Competitor B"],
    evidence: ["https://example.com/dry-run-fixture"],
  });
  return {
    programs: [
      base("Sample Flowdesk", "email marketing", 39, 30, 42, 14, 2),
      base("Sample Kanbanly", "project management", 49, 25, 36, 16, 1),
      base("Sample Rankwise", "seo tools", 99, 30, 58, 11, 2),
    ],
  };
}

export interface ResearchResult {
  discovered: number;
  accepted: number;
  rejected: { name: string; reason: string }[];
  added: number;
  updated: number;
}

export async function runResearch(): Promise<ResearchResult> {
  log.step("STEP 1 / 案件リサーチ — 継続報酬型 SaaS を探す");
  const known = programs.all();

  const parsed = await withFixture(fixtureCandidates, async () => {
    const notes = await research({
      system: RESEARCH_SYSTEM,
      user: researchPrompt(known),
      stage: "research",
      label: "案件リサーチ(Web検索あり)",
      maxUses: 18,
    });
    return structured(CandidateList, {
      system: "You convert research notes into strict JSON. Never invent a value that is absent from the notes; use the note's own conservative estimate instead.",
      user: `Convert these research notes into JSON. Keep every program the notes describe.\n\n---\n${notes}\n---`,
      stage: "brief",
      label: "案件リサーチ → JSON 化",
      effort: "medium",
    });
  });

  const rejected: { name: string; reason: string }[] = [];
  const accepted: Program[] = [];
  for (const c of parsed.programs) {
    const reason = passesHardFilters(c);
    if (reason) {
      rejected.push({ name: c.name, reason });
      continue;
    }
    accepted.push(toProgram(c));
  }

  const { added, updated } = programs.upsertMany(accepted);

  log.ok(`候補 ${parsed.programs.length} 件 → 条件クリア ${accepted.length} 件 (新規 ${added} / 更新 ${updated})`);
  for (const r of rejected) log.warn(`除外: ${r.name} — ${r.reason}`);
  for (const a of accepted.slice(0, 5)) {
    log.info(`  ${a.score.toFixed(1)}点 ${a.name} — $${a.estMonthlyCommissionUsd}/月 × ${a.estAvgRetentionMonths}ヶ月 = LTV $${Math.round(a.estMonthlyCommissionUsd * a.estAvgRetentionMonths)}`);
  }

  return { discovered: parsed.programs.length, accepted: accepted.length, rejected, added, updated };
}
