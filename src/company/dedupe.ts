import crypto from "node:crypto";
import fs from "node:fs";
import { matches } from "../lib/util";

/**
 * 重複の検出。
 *
 * 完全自動運用でいちばん起きやすい事故が「同じものを繰り返し作る」です。
 * 同じ記事を書けば Google に重複コンテンツと見なされ、
 * 同じピンを投稿すれば Pinterest にスパムと判定されてアカウントが飛びます。
 *
 * AI に「重複しないでください」と頼むのではなく、ここで機械的に弾きます。
 */

/** 表記ゆれを潰して比較用の文字列にする */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hashText(text: string): string {
  return crypto.createHash("sha256").update(normalize(text), "utf8").digest("hex").slice(0, 32);
}

export function hashFile(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").slice(0, 32);
}

/** Markdown から H2 見出しの集合を取り出す */
export function headingSet(markdown: string): Set<string> {
  return new Set(
    matches(markdown, /^##\s+.+$/gm).map((h) => normalize(h.replace(/^##\s+/, ""))),
  );
}

/**
 * 2つの記事の見出しがどれだけ重なっているか（Jaccard 係数、%）。
 * 「同じ構成の記事を量産していないか」の判定に使う。
 */
export function headingOverlapPct(a: string, b: string): number {
  const sa = headingSet(a);
  const sb = headingSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const h of sa) if (sb.has(h)) shared++;
  const union = sa.size + sb.size - shared;
  return union === 0 ? 0 : Math.round((shared / union) * 1000) / 10;
}

export interface DuplicateHit {
  kind: "primaryKeyword" | "headingOverlap" | "pinCopy" | "pinImage" | "idempotencyKey";
  existingRef: string;
  detail: string;
}

/** 主キーワードの完全一致（正規化後） */
export function findKeywordDuplicate(
  keyword: string,
  existing: { slug: string; primaryKeyword: string }[],
): DuplicateHit | null {
  const target = normalize(keyword);
  const hit = existing.find((a) => normalize(a.primaryKeyword) === target);
  if (!hit) return null;
  return {
    kind: "primaryKeyword",
    existingRef: hit.slug,
    detail: `主キーワード "${keyword}" は既に /articles/${hit.slug}/ が狙っています。` +
      "同じキーワードで2本書くと、自分の記事同士で検索順位を食い合います（共食い）。",
  };
}

/** 見出し構成が既存記事と似すぎていないか */
export function findHeadingDuplicate(
  markdown: string,
  existing: { slug: string; body: string }[],
  maxPct: number,
): DuplicateHit | null {
  for (const other of existing) {
    const pct = headingOverlapPct(markdown, other.body);
    if (pct > maxPct) {
      return {
        kind: "headingOverlap",
        existingRef: other.slug,
        detail: `見出し構成が /articles/${other.slug}/ と ${pct}% 重なっています（上限 ${maxPct}%）。` +
          "見出しを変えるだけでなく、扱う切り口そのものを変えてください。",
      };
    }
  }
  return null;
}

/** ピンの文案が既存と同じでないか */
export function findPinCopyDuplicate(
  overlayMain: string,
  existing: { id: string; copyHash?: string; overlayMain: string }[],
): DuplicateHit | null {
  const h = hashText(overlayMain);
  const hit = existing.find((p) => (p.copyHash ?? hashText(p.overlayMain)) === h);
  if (!hit) return null;
  return {
    kind: "pinCopy",
    existingRef: hit.id,
    detail: `見出し "${overlayMain}" は既存のピン ${hit.id} と同じです。` +
      "同じ文言のピンを繰り返し投稿すると、Pinterest にスパムと判定されます。",
  };
}

/** ピン画像のバイトが既存と同じでないか */
export function findPinImageDuplicate(
  imagePath: string,
  existing: { id: string; imageHash?: string }[],
): DuplicateHit | null {
  if (!fs.existsSync(imagePath)) return null;
  const h = hashFile(imagePath);
  const hit = existing.find((p) => p.imageHash === h);
  if (!hit) return null;
  return {
    kind: "pinImage",
    existingRef: hit.id,
    detail: `画像の中身が既存のピン ${hit.id} と完全に同じです。`,
  };
}

export class DuplicateError extends Error {
  constructor(public hits: DuplicateHit[]) {
    super(`重複を検出しました（${hits.length} 件）`);
    this.name = "DuplicateError";
  }
}
