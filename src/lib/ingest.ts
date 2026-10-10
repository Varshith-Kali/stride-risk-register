/**
 * Shared helpers for the data API routes (Agent C).
 * Sanitization, upload guards, primary-sheet selection, filename safety.
 */

import { cleanCell } from "@/core/sanitize";

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB

/**
 * Sanitize a free-form string input: trim, collapse whitespace, strip
 * control chars (via cleanCell), then enforce a hard length cap.
 */
export function sane(v: unknown, maxLen = 500): string {
  const raw = typeof v === "string" ? v : v == null ? "" : String(v);
  const s = cleanCell(raw);
  return s.length > maxLen ? s.slice(0, maxLen).trimEnd() : s;
}

export interface SheetLike {
  name: string;
  rows: string[][];
}

export interface PrimarySheet {
  name: string;
  headers: string[];
  rows: string[][];
}

/**
 * Pick the sheet that best represents the STRIDE GPT export for
 * mapping purposes: the one with a non-empty header row and the most
 * data rows. Returns null when no sheet has a usable header row.
 */
export function pickPrimarySheet(sheets: SheetLike[]): PrimarySheet | null {
  const candidates = sheets
    .map((s, i) => ({
      sheet: s,
      index: i,
      headers: s.rows[0] ?? [],
      dataRows: Math.max(0, s.rows.length - 1),
    }))
    .filter((c) => c.headers.some((h) => h.trim() !== ""));
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.dataRows - a.dataRows || a.index - b.index);
  const best = candidates[0];
  return { name: best.sheet.name, headers: best.headers, rows: best.sheet.rows };
}

/** First n data rows (headers excluded by caller), capped at 20 columns. */
export function sampleRows(rows: string[][], n = 5): string[][] {
  return rows.slice(0, n).map((r) => r.slice(0, 20));
}

/** Make a string safe for use inside a download filename (ASCII slug). */
export function filenameSafe(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "project";
}

/** Today as YYYY-MM-DD (UTC). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Whole days between two ISO datetimes (floored, never negative). */
export function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** Whole days from an ISO datetime until now. */
export function daysAgo(iso: string): number {
  return daysBetween(iso, new Date().toISOString());
}

const THREAT_STATUSES = [
  "Open",
  "In Progress",
  "Mitigated",
  "Accepted Risk",
  "Deferred",
  "Rejected/Not Applicable",
] as const;

export type ThreatStatusValue = (typeof THREAT_STATUSES)[number];

export function isThreatStatus(v: unknown): v is ThreatStatusValue {
  return typeof v === "string" && (THREAT_STATUSES as readonly string[]).includes(v);
}

export const THREAT_STATUS_LIST: string[] = [...THREAT_STATUSES];

const RECO_STATUSES = ["Open", "In Progress", "Done", "Deferred"] as const;

export function isRecoStatus(v: unknown): v is (typeof RECO_STATUSES)[number] {
  return typeof v === "string" && (RECO_STATUSES as readonly string[]).includes(v);
}

export const RECO_STATUS_LIST: string[] = [...RECO_STATUSES];

const CONFIDENCES = ["High", "Medium", "Low"] as const;

export function isConfidence(v: unknown): v is (typeof CONFIDENCES)[number] {
  return typeof v === "string" && (CONFIDENCES as readonly string[]).includes(v);
}

const LINK_DECISIONS = ["accepted", "rejected"] as const;

export function isLinkDecision(v: unknown): v is (typeof LINK_DECISIONS)[number] {
  return typeof v === "string" && (LINK_DECISIONS as readonly string[]).includes(v);
}

/** Statuses that close a threat (excluded from open/ageing counts). */
export const CLOSED_STATUSES = ["Mitigated", "Accepted Risk", "Rejected/Not Applicable"];

export function isClosedStatus(status: string): boolean {
  return CLOSED_STATUSES.includes(status);
}
