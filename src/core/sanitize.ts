/**
 * Cell-text sanitisation: trim, collapse whitespace, strip control
 * characters (keeping \n and \t), cap length. Never throws.
 */

const MAX_CELL_CHARS = 20_000;

export function cleanCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  // Normalise CRLF/CR to LF first so line structure survives.
  s = s.replace(/\r\n?/g, "\n");
  // Strip control characters except \n (0x0A) and \t (0x09).
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  // Collapse horizontal whitespace runs (spaces, tabs, NBSP) to one space.
  s = s.replace(/[ \t\u00a0]+/g, " ");
  s = s.trim();
  if (s.length > MAX_CELL_CHARS) s = s.slice(0, MAX_CELL_CHARS);
  return s;
}
