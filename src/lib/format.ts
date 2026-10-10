/**
 * Small formatting helpers. No-hallucination rule: anything the input did not
 * provide must render as "Not provided" — never an empty hole, never a guess.
 */

export const NOT_PROVIDED = "Not provided";

/** Render a possibly-missing string field per the no-hallucination rule. */
export function displayOrNA(value: unknown): string {
  if (value === null || value === undefined) return NOT_PROVIDED;
  if (typeof value === "string") {
    const t = value.trim();
    return t ? t : NOT_PROVIDED;
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : NOT_PROVIDED;
  }
  return String(value);
}

/** Format an ISO date as dd Mon yyyy; falls back to "Not provided". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return NOT_PROVIDED;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NOT_PROVIDED;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Whole days between now and an ISO date; null when unavailable. */
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

/** Download a text blob (CSV) from the browser. */
export function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** CSV-escape a cell value. */
export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
