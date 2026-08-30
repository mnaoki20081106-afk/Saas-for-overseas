import fs from "node:fs";
import path from "node:path";
import { config } from "../lib/config";
import { log } from "../lib/log";
import { P } from "../lib/paths";
import { pins as pinStore } from "../lib/store";
import type { Pin } from "../lib/types";
import { nowISO, todayISO } from "../lib/util";

/**
 * Pinterest API の Standard access が下りるまでの逃げ道。
 *
 * Trial access で作ったピンは「作成者にしか見えない Sandbox ピン」になるため、
 * 流入源にならない。審査（OAuth フローの録画提出が必要・数日〜数週間）を待つ間、
 * パイプラインを止めないために、生成済みのピンを
 *   ・CSV（予約日時・ボード・タイトル・説明・alt・リンク）
 *   ・連番付きの画像フォルダ
 * として書き出す。手動投稿にも、Tailwind などの外部予約ツールの一括取り込みにも使える。
 */

function csvCell(value: string): string {
  const needsQuote = /[",\r\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

function jst(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return `${d.toISOString().slice(0, 16).replace("T", " ")} JST`;
}

function fileStamp(iso: string, index: number): string {
  const d = new Date(iso);
  const day = d.toISOString().slice(0, 10);
  const hm = d.toISOString().slice(11, 16).replace(":", "");
  return `${String(index + 1).padStart(3, "0")}_${day}_${hm}`;
}

export interface ExportResult {
  dir: string;
  count: number;
  csvPath: string;
  marked: number;
}

export function exportPins(opts: { days?: number; mark?: boolean } = {}): ExportResult {
  log.step("手動投稿・外部ツール用にピンを書き出す（API 審査待ちの逃げ道）");
  const c = config();
  const horizonMs = (opts.days ?? 14) * 86_400_000;
  const until = Date.now() + horizonMs;

  const targets = pinStore
    .all()
    .filter((p) => (p.status === "scheduled" || p.status === "queued") && p.imagePath)
    .filter((p) => !p.scheduledAt || new Date(p.scheduledAt).getTime() <= until)
    .sort((a, b) => {
      const at = a.scheduledAt ?? "9999";
      const bt = b.scheduledAt ?? "9999";
      return at < bt ? -1 : at > bt ? 1 : 0;
    });

  if (targets.length === 0) {
    log.warn("書き出せるピンがありません。先に `npm run autopilot pins` を実行してください。");
    return { dir: "", count: 0, csvPath: "", marked: 0 };
  }

  const dir = path.join(P.root, "export", `pins-${todayISO()}`);
  const imagesDir = path.join(dir, "images");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(imagesDir, { recursive: true });

  const header = [
    "順番", "投稿予定(JST)", "ボード名", "タイトル", "説明",
    "代替テキスト", "リンク先URL", "画像ファイル", "テンプレート", "ピンID",
  ];
  const rows: string[] = [header.map(csvCell).join(",")];

  targets.forEach((pin, i) => {
    const stamp = pin.scheduledAt ? fileStamp(pin.scheduledAt, i) : `${String(i + 1).padStart(3, "0")}_unscheduled`;
    const imageName = `${stamp}.png`;
    const src = path.join(P.root, pin.imagePath);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(imagesDir, imageName));

    rows.push(
      [
        String(i + 1),
        pin.scheduledAt ? jst(pin.scheduledAt) : "未定",
        pin.boardName,
        pin.title,
        pin.description,
        pin.altText,
        pin.destinationUrl,
        `images/${imageName}`,
        pin.templateId,
        pin.id,
      ]
        .map(csvCell)
        .join(","),
    );
  });

  // Excel が UTF-8 と認識できるよう BOM を付ける
  const csvPath = path.join(dir, "pins.csv");
  fs.writeFileSync(csvPath, `﻿${rows.join("\r\n")}\r\n`, "utf8");

  const boards = [...new Set(targets.map((p) => p.boardName))];
  fs.writeFileSync(
    path.join(dir, "はじめに.txt"),
    [
      `${c.site.name} — ピン ${targets.length} 枚の書き出し`,
      `作成日時: ${nowISO()}`,
      "",
      "■ これは何か",
      "  Pinterest API の Standard access が下りるまでの間、手で投稿するための一式です。",
      "  Trial access のまま API 投稿すると、ピンが自分にしか見えない Sandbox 扱いになり",
      "  流入源になりません。だから審査が通るまでは手動投稿のほうが確実です。",
      "",
      "■ 中身",
      "  pins.csv   … 1行 = 1ピン。投稿予定の早い順に並んでいます",
      "  images/    … 同じ順番で連番になった画像（1000x1500）",
      "",
      "■ 手で投稿する場合（1枚あたり約40秒）",
      "  1. Pinterest で「作成」→「ピンを作成」",
      "  2. images/ の画像を、番号の若い順にドラッグ&ドロップ",
      "  3. pins.csv の同じ行から タイトル / 説明 / 代替テキスト / リンク先URL を貼る",
      "  4. ボードは下記のものを使ってください（無ければ作成）",
      ...boards.map((b) => `       - ${b}`),
      "  5. 1日6枚まで、間隔を空けて投稿してください（連投はスパム判定されます）",
      "",
      "■ 外部の予約ツールを使う場合",
      "  Tailwind / Buffer / Later などは既に Standard access を持っているので、",
      "  そこに画像とテキストを流し込めば予約投稿できます。",
      "  CSV の列名はツールに合わせて読み替えてください。",
      "",
      "■ 投稿し終えたら",
      "  npm run autopilot pins:export --mark",
      "  を実行すると、書き出したピンが投稿済みとして記録され、二重投稿を防げます。",
      "  （手動投稿ぶんは Pinterest のピンIDが無いため、数値の自動取得の対象外になります）",
      "",
    ].join("\n"),
    "utf8",
  );

  let marked = 0;
  if (opts.mark) {
    for (const pin of targets) {
      pinStore.update(pin.id, { status: "published", publishedAt: nowISO(), pinterestPinId: null });
      marked++;
    }
  }

  const rel = path.relative(P.root, dir);
  log.ok(`ピン ${targets.length} 枚を書き出しました → ${rel}/`);
  log.info(`  ${rel}/pins.csv と ${rel}/images/ を使って投稿してください`);
  if (marked) log.ok(`${marked} 枚を投稿済みとして記録しました`);
  else log.info("投稿し終えたら --mark を付けて再実行すると、投稿済みとして記録されます");

  return { dir, count: targets.length, csvPath, marked };
}

export function exportedPinSummary(list: Pin[]): string {
  return `${list.length} 枚 / ボード ${new Set(list.map((p) => p.boardName)).size} 種`;
}
