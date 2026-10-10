/**
 * Parse threat-model worksheet data into ParsedThreat records.
 *
 * Pure and defensive: skips fully-empty rows, keeps original 1-based Excel
 * row numbers, tolerates ragged rows and missing mapped columns, and never
 * throws on unexpected cell content. Problems are reported via `warnings`.
 */
import type {
  ColumnMapping,
  ParsedThreat,
  RiskLevel,
  StrideCategory,
} from "./types";
import { cleanCell } from "./sanitize";

export interface SheetRows {
  name: string;
  rows: string[][];
}

export interface ParseThreatsResult {
  threats: ParsedThreat[];
  warnings: string[];
}

const MAX_WARNINGS = 100;

const STRIDE_VALUES: StrideCategory[] = [
  "Spoofing",
  "Tampering",
  "Repudiation",
  "Information Disclosure",
  "Denial of Service",
  "Elevation of Privilege",
];

const RISK_VALUES: RiskLevel[] = ["Critical", "High", "Medium", "Low"];

function normalizeStride(v: string): StrideCategory {
  const t = v.trim().toLowerCase();
  for (const s of STRIDE_VALUES) {
    if (s.toLowerCase() === t) return s;
  }
  return "";
}

function normalizeRisk(v: string): RiskLevel {
  const t = v.trim().toLowerCase();
  for (const r of RISK_VALUES) {
    if (r.toLowerCase() === t) return r;
  }
  // Common shorthand variants seen in exports.
  if (t === "crit" || t === "criticality: critical") return "Critical";
  return "";
}

function parseSeverityScore(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  // Accept "7.5", "7.5/10", "DREAD 32", etc. — first numeric token wins.
  const m = /-?\d+(?:\.\d+)?/.exec(t.replace(",", "."));
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

function splitTitleDescription(cell: string): { title: string; description: string } {
  const nl = cell.indexOf("\n");
  if (nl === -1) return { title: cell.trim(), description: "" };
  return { title: cell.slice(0, nl).trim(), description: cell.slice(nl + 1).trim() };
}

export function parseThreats(
  sheets: SheetRows[],
  mapping: ColumnMapping
): ParseThreatsResult {
  const threats: ParsedThreat[] = [];
  const warnings: string[] = [];
  const warn = (msg: string): void => {
    if (warnings.length < MAX_WARNINGS) warnings.push(msg);
  };

  const mapKeys = Object.keys(mapping) as (keyof ColumnMapping)[];
  let fallbackCounter = 0;
  const unknownStride = new Set<string>();
  const unknownRisk = new Set<string>();

  for (const sheet of sheets) {
    if (sheet.rows.length === 0) {
      warn(`Sheet "${sheet.name}" is empty — skipped.`);
      continue;
    }
    const headerRow = sheet.rows[0];
    const headers = headerRow.map((h) => cleanCell(h));

    // Resolve each mapped field to a column index (exact header match).
    const colOf = new Map<keyof ColumnMapping, number>();
    for (const key of mapKeys) {
      const want = mapping[key];
      if (typeof want !== "string" || !want) continue;
      const idx = headers.indexOf(want);
      if (idx === -1) {
        warn(
          `Sheet "${sheet.name}": mapped column "${want}" was not found — related values will show as "Not provided".`
        );
      } else {
        colOf.set(key, idx);
      }
    }

    const cell = (row: string[], key: keyof ColumnMapping): string => {
      const col = colOf.get(key);
      if (col === undefined) return "";
      return cleanCell(row[col] ?? "");
    };

    const hasDescriptionCol = colOf.has("description");

    for (let i = 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i] ?? [];
      const rowNumber = i + 1; // 1-based; header is row 1
      if (row.every((c) => cleanCell(c) === "")) continue; // fully-empty row

      const titleCell = cell(row, "title");
      let title: string;
      let description: string;
      if (hasDescriptionCol) {
        title = titleCell;
        description = cell(row, "description");
      } else {
        const split = splitTitleDescription(titleCell);
        title = split.title;
        description = split.description;
      }
      if (!title) {
        warn(`Sheet "${sheet.name}" row ${rowNumber}: empty threat title.`);
      }

      const refRaw = cell(row, "ref");
      const ref = refRaw || `T-${String(++fallbackCounter).padStart(3, "0")}`;

      const strideRaw = cell(row, "stride");
      const stride = normalizeStride(strideRaw);
      if (strideRaw && !stride && unknownStride.size < 10) unknownStride.add(strideRaw);

      const riskRaw = cell(row, "risk");
      const risk = normalizeRisk(riskRaw);
      if (riskRaw && !risk && unknownRisk.size < 10) unknownRisk.add(riskRaw);

      const mitreRaw = cell(row, "mitre");
      const mitre = mitreRaw
        .split(/[;\n]+/)
        .map((m) => cleanCell(m))
        .filter((m) => m.length > 0);

      const raw: Record<string, string> = {};
      headers.forEach((h, ci) => {
        const key = h || `Column ${ci + 1}`;
        raw[key] = cleanCell(row[ci] ?? "");
      });

      threats.push({
        sheet: sheet.name,
        row: rowNumber,
        ref,
        title,
        description,
        stride,
        component: cell(row, "component"),
        mitre,
        risk,
        existingControls: cell(row, "existingControls"),
        safetyMetrics: cell(row, "safetyMetrics"),
        severityScore: parseSeverityScore(cell(row, "severity")),
        raw,
      });
    }
  }

  for (const v of unknownStride) {
    warn(`Unrecognised STRIDE category "${v}" — stored as "Not provided".`);
  }
  for (const v of unknownRisk) {
    warn(`Unrecognised risk level "${v}" — stored as "Not provided".`);
  }
  if (warnings.length >= MAX_WARNINGS) {
    warnings.push("Further warnings were suppressed.");
  }

  return { threats, warnings };
}
