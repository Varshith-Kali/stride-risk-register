/**
 * Parse a reviewer's free-text recommendations into discrete items.
 *
 * Splitting strategy (first match wins):
 *  1. Numbered items — lines starting with `1.`, `2)`, … (≥2 markers, or a
 *     single leading marker).
 *  2. Bulleted items — lines starting with `-`, `*`, `•` (≥2 markers).
 *  3. Blank-line separated paragraphs.
 *
 * The original wording is preserved verbatim (trimmed only). Owner,
 * priority and timeline are extracted ONLY when explicitly stated —
 * otherwise they stay "" (rendered as "Not provided" upstream).
 */
import type { ParsedRecommendation } from "./types";

const NUMBERED_RE = /^\s*\d{1,3}[.)]\s+\S/;
const BULLET_RE = /^\s*[-*•]\s+\S/;

/** Split raw text into item bodies, preserving original wording. */
function splitItems(text: string): string[] {
  const normalised = text.replace(/\r\n?/g, "\n");
  const lines = normalised.split("\n");

  const numbered = lines.filter((l) => NUMBERED_RE.test(l)).length;
  const bulleted = lines.filter((l) => BULLET_RE.test(l)).length;
  const firstNonBlank = lines.find((l) => l.trim() !== "") ?? "";
  const startsNumbered = NUMBERED_RE.test(firstNonBlank);

  const flush = (acc: string[], current: string[]): void => {
    const body = current.join("\n").trim();
    if (body) acc.push(body);
  };

  if (numbered >= 2 || (numbered === 1 && startsNumbered)) {
    // Numbered list: a new item starts at each numbered marker; following
    // non-marker lines are continuations of the current item.
    const items: string[] = [];
    let current: string[] = [];
    for (const line of lines) {
      const m = /^\s*\d{1,3}[.)]\s+/.exec(line);
      if (m) {
        flush(items, current);
        current = [line.slice(m[0].length)];
      } else if (current.length > 0 || line.trim() !== "") {
        current.push(line);
      }
    }
    flush(items, current);
    if (items.length > 0) return items;
  }

  if (bulleted >= 2) {
    const items: string[] = [];
    let current: string[] = [];
    for (const line of lines) {
      const m = /^\s*[-*•]\s+/.exec(line);
      if (m) {
        flush(items, current);
        current = [line.slice(m[0].length)];
      } else if (current.length > 0 || line.trim() !== "") {
        current.push(line);
      }
    }
    flush(items, current);
    if (items.length > 0) return items;
  }

  // Fallback: blank-line separated paragraphs.
  return normalised
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

const OWNER_RES: RegExp[] = [
  // Strict: capitalized person/team name (stops before ", P1", ", by …" etc.)
  /\bowner\s*:\s*([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,2})/i,
  /\bowned\s+by\s+([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,2})/,
  /\bassignee\s*:\s*([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,2})/i,
  /\bassigned\s+to\s+([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,2})/i,
  // Fallback: delimited value (comma excluded so trailing metadata is cut)
  /\bowner\s*:\s*([^\n;,|]{1,80})/i,
  /\bassignee\s*:\s*([^\n;,|]{1,80})/i,
];

const PRIORITY_RES: RegExp[] = [
  /\b(P[0-4])\b/,
  /priority\s*:\s*(critical|high|medium|low|p[0-4])/i,
  /\b(critical|high|medium|low)\s+priority\b/i,
];

const TIMELINE_RES: RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}\b/, // 2026-11-30
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, // 30/11/2026
  /\b\d{1,2}-\d{1,2}-\d{2,4}\b/, // 30-11-2026
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:\s*,?\s*\d{4})?\b/i,
  /\bQ[1-4]\s*(?:FY)?\s*\d{2,4}\b/i, // Q1 2027
  /\b(?:by|before|within)\s+\d+\s+(?:days?|weeks?|months?|quarters?)\b/i,
  /\b(?:by|before)\s+(?:end\s+of\s+)?(?:Q[1-4]|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*)(?:\s+\d{2,4})?\b/i,
];

function firstMatch(res: RegExp[], text: string): string {
  for (const re of res) {
    const m = re.exec(text);
    if (m) return (m[1] ?? m[0]).trim().replace(/[.,;:\s]+$/, "");
  }
  return "";
}

/**
 * Parse reviewer free text into discrete recommendation items.
 * Pure and deterministic — no dates are generated, only extracted.
 */
export function parseRecommendations(text: string): ParsedRecommendation[] {
  if (!text || !text.trim()) return [];
  const items = splitItems(text);
  return items.map((body, i) => ({
    index: i + 1,
    text: body,
    owner: firstMatch(OWNER_RES, body),
    priority: firstMatch(PRIORITY_RES, body),
    timeline: firstMatch(TIMELINE_RES, body),
  }));
}
