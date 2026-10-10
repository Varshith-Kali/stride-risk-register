/**
 * Deterministic review aggregation.
 *
 * Everything in here is computed in code from the parsed rows — never asked of
 * the AI (the no-hallucination rule). The AI only writes the grounded narrative
 * (headline, observations) and clubs recommendations; these functions own every
 * number and every risk/STRIDE classification.
 */
import type {
  ParsedThreat,
  ParsedRecommendation,
  RiskLevel,
  StrideCategory,
  CondensedReview,
} from "./types";
import type { ThreatRank } from "./ranking";
import type { CondenseThreatInput, CondenseRecoInput } from "@/llm/prompts";

const STRIDE_CATEGORIES: StrideCategory[] = [
  "Spoofing",
  "Tampering",
  "Repudiation",
  "Information Disclosure",
  "Denial of Service",
  "Elevation of Privilege",
  "",
];

/** Critical/High/Medium/Low counts over the full set (unknown risk ignored). */
export function computeRiskPosture(
  threats: ParsedThreat[]
): CondensedReview["riskPosture"] {
  const posture = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const t of threats) {
    switch (t.risk) {
      case "Critical":
        posture.critical += 1;
        break;
      case "High":
        posture.high += 1;
        break;
      case "Medium":
        posture.medium += 1;
        break;
      case "Low":
        posture.low += 1;
        break;
    }
  }
  return posture;
}

/** Count of threats per STRIDE category (all six keys always present). */
export function computeStrideCounts(
  threats: ParsedThreat[]
): Record<StrideCategory, number> {
  const counts = Object.fromEntries(
    STRIDE_CATEGORIES.map((c) => [c, 0])
  ) as Record<StrideCategory, number>;
  for (const t of threats) {
    const key: StrideCategory = STRIDE_CATEGORIES.includes(t.stride)
      ? t.stride
      : "";
    counts[key] += 1;
  }
  return counts;
}

/** Top-N threats by rank score (score desc, then input order), title + risk. */
export function computeTopRisks(
  threats: ParsedThreat[],
  ranks: ThreatRank[],
  limit = 5
): { title: string; risk: RiskLevel }[] {
  return threats
    .map((t, i) => ({ t, score: ranks[i]?.score ?? 0, i }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.i - b.i))
    .slice(0, limit)
    .map(({ t }) => ({ title: t.title, risk: t.risk }));
}

/**
 * Select the top-N threats by rank score for the AI condense prompt. Full-set
 * counts are computed separately — this only trims what the model reads.
 */
export function selectCondenseThreats(
  threats: ParsedThreat[],
  ranks: ThreatRank[],
  limit = 50
): CondenseThreatInput[] {
  return threats
    .map((t, i) => ({ t, score: ranks[i]?.score ?? 0, i }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.i - b.i))
    .slice(0, limit)
    .map(({ t }) => ({
      title: t.title,
      description: t.description,
      stride: t.stride,
      risk: t.risk,
      component: t.component,
    }));
}

/** Shape recommendations for the AI condense prompt. */
export function selectCondenseRecos(
  recos: ParsedRecommendation[]
): CondenseRecoInput[] {
  return recos.map((r) => ({ index: r.index, text: r.text }));
}

/**
 * Assemble the full CondensedReview: deterministic aggregates always, plus the
 * AI narrative when supplied. When `narrative` is null (no API key, or the AI
 * call failed), the record is still valid — just posture-only.
 */
export function buildCondensedReview(
  threats: ParsedThreat[],
  ranks: ThreatRank[],
  recos: ParsedRecommendation[],
  narrative: {
    headline: string;
    observations: string[];
    keyRecommendations: string[];
  } | null
): CondensedReview {
  return {
    headline: narrative?.headline ?? "",
    observations: narrative?.observations ?? [],
    keyRecommendations: narrative?.keyRecommendations ?? [],
    riskPosture: computeRiskPosture(threats),
    strideCounts: computeStrideCounts(threats),
    topRisks: computeTopRisks(threats, ranks),
    threatCount: threats.length,
    recoCount: recos.length,
    aiGenerated: narrative !== null,
  };
}

const EMPTY_STRIDE_COUNTS = Object.fromEntries(
  STRIDE_CATEGORIES.map((c) => [c, 0])
) as Record<StrideCategory, number>;

/**
 * Parse a stored `condensed_review_json` TEXT value back into a CondensedReview,
 * tolerating legacy/empty rows ('{}') and malformed JSON — every field falls
 * back to a safe default so callers never crash on a bad row.
 */
export function parseCondensedReview(json: string | null | undefined): CondensedReview {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = json ? JSON.parse(json) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      raw = parsed as Record<string, unknown>;
    }
  } catch {
    raw = {};
  }

  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const asNum = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;

  const postureRaw = (raw.riskPosture ?? {}) as Record<string, unknown>;
  const strideRaw = (raw.strideCounts ?? {}) as Record<string, unknown>;
  const strideCounts = { ...EMPTY_STRIDE_COUNTS };
  for (const c of STRIDE_CATEGORIES) strideCounts[c] = asNum(strideRaw[c]);

  const topRisks = Array.isArray(raw.topRisks)
    ? (raw.topRisks as unknown[])
        .filter(
          (r): r is Record<string, unknown> =>
            !!r && typeof r === "object" && !Array.isArray(r)
        )
        .map((r) => ({
          title: typeof r.title === "string" ? r.title : "",
          risk: (typeof r.risk === "string" ? r.risk : "") as RiskLevel,
        }))
    : [];

  return {
    headline: typeof raw.headline === "string" ? raw.headline : "",
    observations: asStrings(raw.observations),
    keyRecommendations: asStrings(raw.keyRecommendations),
    riskPosture: {
      critical: asNum(postureRaw.critical),
      high: asNum(postureRaw.high),
      medium: asNum(postureRaw.medium),
      low: asNum(postureRaw.low),
    },
    strideCounts,
    topRisks,
    threatCount: asNum(raw.threatCount),
    recoCount: asNum(raw.recoCount),
    aiGenerated: raw.aiGenerated === true,
  };
}
