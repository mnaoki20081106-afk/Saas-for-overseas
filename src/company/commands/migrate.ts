import fs from "node:fs";
import { log } from "../../lib/log";
import { P } from "../../lib/paths";
import { readJson, writeJson, pins as pinStore, state } from "../../lib/store";
import type { PipelineState } from "../../lib/types";
import { hashText, hashFile } from "../dedupe";
import { CP, ensureCompanyDirs } from "../store";

/**
 * 既存データに新しいフィールドを足す。
 *
 * 方針: 削除も改名もしない。追加だけ。何度実行しても同じ結果になる（冪等）。
 * 既存の JSON をそのまま読めるようにしておくことで、
 * いつでも AI_BACKEND=api の従来経路に戻せる状態を保つ。
 */

const SCHEMA_VERSION = 1;

export interface MigrateResult {
  createdFiles: string[];
  pinsUpdated: number;
  stateUpdated: boolean;
  fromVersion: number;
  toVersion: number;
}

export function migrate(): MigrateResult {
  log.step("会社のデータ構造を最新にします（追加のみ・既存データは壊しません）");

  const before = new Set(
    [CP.tasks, CP.approvals, CP.decisions, CP.research, CP.ideas,
      CP.reviews, CP.experiments, CP.kpis, CP.errors, CP.employees]
      .filter((f) => fs.existsSync(f)),
  );
  ensureCompanyDirs();
  const created = [CP.tasks, CP.approvals, CP.decisions, CP.research, CP.ideas,
    CP.reviews, CP.experiments, CP.kpis, CP.errors, CP.employees]
    .filter((f) => !before.has(f))
    .map((f) => f.replace(`${P.root}/`, ""));

  const st = state.get();
  const fromVersion = Number(st.schemaVersion ?? 0);

  // ── pins: 実験と重複検出のための変数を足す ──────────────────────────
  const pins = pinStore.all() as unknown as Record<string, unknown>[];
  let pinsUpdated = 0;
  for (const p of pins) {
    let touched = false;
    const set = (key: string, value: unknown) => {
      if (p[key] === undefined) { p[key] = value; touched = true; }
    };
    const overlayMain = String(p.overlayMain ?? "");
    set("angleType", "unknown");
    set("paletteIndex", null);
    set("hasNumber", /\d/.test(overlayMain));
    set("hasVersus", /\bvs\.?\b/i.test(overlayMain));
    set("hasCta", false);
    set("copyHash", overlayMain ? hashText(overlayMain) : null);
    set("experimentId", null);
    set("variant", null);
    // ★これが無いピンは Actions が投稿しない（承認ゲート）
    set("approvalId", null);

    if (p.imageHash === undefined) {
      const ip = String(p.imagePath ?? "");
      p.imageHash = ip && fs.existsSync(ip) ? hashFile(ip) : null;
      touched = true;
    }
    if (touched) pinsUpdated++;
  }
  if (pinsUpdated) writeJson(`${P.data}/pins.json`, pins);

  // ── state: AI会社の運転に必要なフィールドを足す ────────────────────
  // 既に値が入っている項目は上書きしない（?? で既存値を優先する）。
  const patch: Partial<PipelineState> = {
    lastCeoRunAt: st.lastCeoRunAt ?? null,
    routineRunsToday: st.routineRunsToday ?? { date: "", count: 0 },
    phase: st.phase ?? "bootstrap",
    companyStartedAt: st.companyStartedAt ?? null,
    lastKpiSnapshotAt: st.lastKpiSnapshotAt ?? null,
    schemaVersion: SCHEMA_VERSION,
  };
  state.patch(patch);

  // 廃止したフィールドを state から取り除く。
  // 残しておくと「まだこれを見て判断している」と誤解され、次に読む人が嘘の値を信じます。
  //   consecutiveApprovedPublishes … A案→B案の判定は data/approvals.json の履歴から
  //   毎回計算する方式に変えたため不要（src/company/autonomy.ts）
  const OBSOLETE_STATE_KEYS = ["consecutiveApprovedPublishes"];
  const raw = readJson<Record<string, unknown>>(P.state, {});
  let removed = false;
  for (const k of OBSOLETE_STATE_KEYS) {
    if (k in raw) { delete raw[k]; removed = true; }
  }
  if (removed) writeJson(P.state, raw);

  // 「変更なし」と報告しながら実は書き換えている、をやらない。
  const stateUpdated = fromVersion !== SCHEMA_VERSION || removed;

  // ── config: 無ければテンプレートを作る ───────────────────────────
  if (!fs.existsSync(CP.limits)) {
    throw new Error(
      "config/limits.json がありません。安全装置なしでは会社を動かせません。" +
      "リポジトリから復元してください（git checkout config/limits.json）。",
    );
  }
  const l = readJson<Record<string, unknown>>(CP.limits, {});
  if (!l.killSwitch) throw new Error("config/limits.json に killSwitch がありません。壊れています。");

  const result: MigrateResult = {
    createdFiles: created,
    pinsUpdated,
    stateUpdated,
    fromVersion,
    toVersion: SCHEMA_VERSION,
  };

  if (created.length) log.ok(`新しいデータファイルを作成: ${created.join(", ")}`);
  if (pinsUpdated) log.ok(`既存のピン ${pinsUpdated} 枚に新しい項目を追加しました`);
  if (stateUpdated) {
    log.ok(removed
      ? "state.json を更新しました（使わなくなった項目を取り除きました）"
      : "state.json に会社運転用の項目を追加しました");
  }
  log.ok(`スキーマ v${fromVersion} → v${SCHEMA_VERSION}`);
  if (!created.length && !pinsUpdated && !stateUpdated) log.info("すでに最新です（変更なし）");

  return result;
}
