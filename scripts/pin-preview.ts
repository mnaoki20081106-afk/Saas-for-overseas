/**
 * ピンのデザインを目視で確認するためのプレビュー生成。
 *   npx tsx scripts/pin-preview.ts
 * → assets/preview/ に 5 テンプレート分の PNG が出ます。
 */
import fs from "node:fs";
import path from "node:path";
import { closeBrowser, renderPins } from "../src/pins/render";
import { TEMPLATE_IDS } from "../src/pins/templates";
import { P } from "../src/lib/paths";

const SAMPLES: Record<string, { top: string; main: string; bottom: string }> = {
  "bold-stat": {
    top: "PRICING REALITY",
    main: "The $49 plan that quietly costs $312",
    bottom: "Three add-ons nobody mentions until month two",
  },
  "split-card": {
    top: "BEFORE YOU SWITCH",
    main: "Migrating 4,000 contacts took us nine hours",
    bottom: "What we would do differently, and the two exports you should run first.",
  },
  checklist: {
    top: "SHORTLIST",
    main: "5 checks before you pay for a helpdesk",
    bottom: "Seat pricing or ticket pricing | Shared inbox limits | SLA on the entry plan | Export format | Who owns the data",
  },
  versus: {
    top: "HEAD TO HEAD",
    main: "Kanbanly vs Notion",
    bottom: "One wins on speed, one wins on the day you hire your fifth person.",
  },
  editorial: {
    top: "WHAT NOBODY TELLS YOU",
    main: "We cancelled after four months, and it was our fault, not the tool's",
    bottom: "The setup decision that made the whole thing unusable for a three-person team.",
  },
};

async function main(): Promise<void> {
  const dir = path.join(P.root, "assets", "preview");
  fs.mkdirSync(dir, { recursive: true });

  const requests = TEMPLATE_IDS.map((id, i) => ({
    id: `preview-${id}`,
    templateId: id,
    data: {
      overlayTop: SAMPLES[id].top,
      overlayMain: SAMPLES[id].main,
      overlayBottom: SAMPLES[id].bottom,
      siteName: "Worked For Us",
      width: 1000,
      height: 1500,
      paletteIndex: i,
    },
  }));

  const out = await renderPins(requests);
  for (const [id, file] of out) {
    fs.renameSync(path.join(P.root, file), path.join(dir, `${id}.png`));
    console.log(`${id} → assets/preview/${id}.png`);
  }
  await closeBrowser();
}

void main();
