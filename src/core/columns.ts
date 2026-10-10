/**
 * Column-mapping suggestions for threat-model Excel uploads.
 *
 * Two-stage strategy:
 *  1. Exact match against DEFAULT_MAP — the true STRIDE GPT export schema
 *     ("S.No", "STRIDE Category", "Threat Description", "MITRE ATT&CK
 *     Mapping", "Risk Level", "Existing Controls", "Safety Metrics").
 *  2. Fuzzy fallback: headers are normalised (lowercase, non-alphanumerics
 *     stripped) and matched against per-field alias lists.
 *
 * `fingerprint()` gives a stable sha256 of the normalised header list so a
 * confirmed mapping can be remembered and re-applied to the same export shape.
 */
import { createHash } from "node:crypto";
import type { ColumnMapping } from "./types";

/** The true STRIDE GPT export schema. Values are exact header names. */
export const DEFAULT_MAP: ColumnMapping = {
  ref: "S.No",
  title: "Threat Description",
  stride: "STRIDE Category",
  mitre: "MITRE ATT&CK Mapping",
  risk: "Risk Level",
  existingControls: "Existing Controls",
  safetyMetrics: "Safety Metrics",
};

/** Normalise a header for comparison: lowercase, strip non-alphanumerics. */
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
}

/** sha256 hex of the normalised header list (order-sensitive). */
export function fingerprint(headers: string[]): string {
  const normalised = headers
    .map((h) => h.trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
  return createHash("sha256").update(normalised, "utf8").digest("hex");
}

export interface SuggestMappingResult {
  mapping: ColumnMapping;
  confidence: "high" | "medium" | "low";
  notes: string[];
}

/* Aliases are stored pre-normalised (lowercase, alphanumerics only). */
const ALIASES: Record<string, string[]> = {
  ref: ["sno", "slno", "serialno", "id", "threatid", "no", "number", "ref", "reference", "index"],
  title: ["title", "threat", "threatname", "name", "heading", "summary", "threatdescription"],
  description: ["description", "details", "detail", "threatdescription", "longdescription", "finding", "notes"],
  stride: ["stride", "stridecategory", "category", "threatcategory"],
  component: ["component", "asset", "system", "service", "subsystem", "module", "scope"],
  mitre: ["mitre", "mitreattack", "attck", "mitremapping", "attackmapping", "mitreattckmapping", "tactic", "technique"],
  risk: ["risk", "risklevel", "severity", "severityrating", "rating", "riskrating"],
  existingControls: [
    "existingcontrols",
    "currentcontrols",
    "controls",
    "mitigations",
    "existingmitigations",
    "countermeasures",
  ],
  safetyMetrics: ["safetymetrics", "safetymetric", "safety", "verdict", "safetyverdict"],
  severity: ["severityscore", "dread", "dreadscore", "score", "cvss", "cvssscore"],
  owner: ["owner", "assignedto", "assignee", "responsible", "ownername"],
  dueDate: ["duedate", "deadline", "targetdate", "target", "eta", "duedates"],
  likelihood: ["likelihood", "probability"],
  impact: ["impact"],
};

const FIELD_ORDER = [
  "ref",
  "title",
  "description",
  "stride",
  "component",
  "mitre",
  "risk",
  "existingControls",
  "safetyMetrics",
  "severity",
  "owner",
  "dueDate",
  "likelihood",
  "impact",
] as const;

type FieldKey = (typeof FIELD_ORDER)[number];

const REQUIRED_FIELDS: FieldKey[] = ["title", "stride", "risk"];

const FIELD_LABELS: Record<FieldKey, string> = {
  ref: "Reference / S.No",
  title: "Threat title",
  description: "Threat description",
  stride: "STRIDE category",
  component: "Component",
  mitre: "MITRE ATT&CK mapping",
  risk: "Risk level",
  existingControls: "Existing controls",
  safetyMetrics: "Safety metrics",
  severity: "Severity / DREAD score",
  owner: "Owner",
  dueDate: "Due date",
  likelihood: "Likelihood",
  impact: "Impact",
};

export function suggestMapping(headers: string[]): SuggestMappingResult {
  const notes: string[] = [];
  const mapping: ColumnMapping = { title: "", stride: "", risk: "" };
  const claimed = new Set<number>(); // header indices already assigned

  // normalised header → list of indices (first occurrence wins)
  const byNorm = new Map<string, number[]>();
  headers.forEach((h, i) => {
    const n = normalizeHeader(h);
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n)!.push(i);
  });
  const take = (normed: string): number | undefined => {
    const idxs = byNorm.get(normed);
    if (!idxs) return undefined;
    const free = idxs.find((i) => !claimed.has(i));
    return free;
  };

  // Stage 1 — exact DEFAULT_MAP matches (normalised comparison).
  let defaultHits = 0;
  const defaultKeys = Object.keys(DEFAULT_MAP) as (keyof ColumnMapping)[];
  for (const key of defaultKeys) {
    const want = DEFAULT_MAP[key];
    if (typeof want !== "string" || !want) continue;
    const idx = take(normalizeHeader(want));
    if (idx !== undefined) {
      (mapping as unknown as Record<string, string>)[key] = headers[idx];
      claimed.add(idx);
      defaultHits++;
    }
  }

  // Stage 2 — fuzzy alias fallback for anything still unmapped.
  for (const field of FIELD_ORDER) {
    if ((mapping as unknown as Record<string, string | undefined>)[field]) continue;
    const aliases = ALIASES[field] ?? [];
    let matched: number | undefined;
    let via = "";
    for (const alias of aliases) {
      const idx = take(alias);
      if (idx !== undefined) {
        matched = idx;
        via = alias;
        break;
      }
    }
    if (matched !== undefined) {
      (mapping as unknown as Record<string, string>)[field] = headers[matched];
      claimed.add(matched);
      notes.push(
        `"${headers[matched]}" was matched to ${FIELD_LABELS[field]} by similarity (alias "${via}"). Please confirm.`
      );
    }
  }

  // Notes for missing fields.
  for (const field of FIELD_ORDER) {
    if (!(mapping as unknown as Record<string, string | undefined>)[field]) {
      if (REQUIRED_FIELDS.includes(field)) {
        notes.push(
          `No column found for ${FIELD_LABELS[field]} (required). The register will show "Not provided" for it.`
        );
      } else if (field === "description") {
        notes.push(
          `No separate description column found — the "${mapping.title || "title"}" column will be split into title (first line) and description (rest).`
        );
      }
    }
  }

  // Confidence.
  const requiredOk = REQUIRED_FIELDS.every(
    (f) => (mapping as unknown as Record<string, string | undefined>)[f]
  );
  const allDefaults = defaultKeys.every(
    (k) => typeof (mapping as unknown as Record<string, string | undefined>)[k as string] === "string" &&
      ((mapping as unknown as Record<string, string | undefined>)[k as string] as string).length > 0
  );
  const confidence: "high" | "medium" | "low" =
    allDefaults && defaultHits === defaultKeys.length
      ? "high"
      : requiredOk
        ? "medium"
        : "low";

  return { mapping, confidence, notes };
}
