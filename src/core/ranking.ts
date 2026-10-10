/**
 * Transparent threat ranking.
 *
 * Scoring (fully explainable, no black box):
 *  - Base score from Risk Level: Critical 100, High 75, Medium 50, Low 25,
 *    missing 0 ("Not provided").
 *  - +10 when a severity/DREAD score is present and >= 7.
 *  - Ties break by STRIDE category order, then by original input order.
 *
 * Every result carries a human-readable "Why ranked here?" explanation.
 * Rank positions use competition ranking (1 + number of strictly better
 * threats), computed from the same deterministic ordering.
 */
import type { ParsedThreat, RiskLevel } from "./types";

export interface ThreatRank {
  score: number;
  explanation: string;
}

const BASE_SCORE: Record<RiskLevel, number> = {
  Critical: 100,
  High: 75,
  Medium: 50,
  Low: 25,
  "": 0,
};

const STRIDE_ORDER = [
  "Spoofing",
  "Tampering",
  "Repudiation",
  "Information Disclosure",
  "Denial of Service",
  "Elevation of Privilege",
  "",
] as const;

function strideRank(t: ParsedThreat): number {
  const i = (STRIDE_ORDER as readonly string[]).indexOf(t.stride);
  return i === -1 ? STRIDE_ORDER.length : i;
}

function threatScore(t: ParsedThreat): number {
  let score = BASE_SCORE[t.risk] ?? 0;
  if (t.severityScore !== null && t.severityScore >= 7) score += 10;
  return score;
}

/**
 * Rank threats. Returns one { score, explanation } per input threat, in the
 * same order as the input array.
 */
export function rankThreats(threats: ParsedThreat[]): ThreatRank[] {
  const n = threats.length;
  const scores = threats.map(threatScore);

  // Deterministic ordering: score desc, STRIDE order asc, input order asc.
  const order = threats
    .map((t, i) => i)
    .sort((a, b) => {
      if (scores[b] !== scores[a]) return scores[b] - scores[a];
      const sa = strideRank(threats[a]);
      const sb = strideRank(threats[b]);
      if (sa !== sb) return sa - sb;
      return a - b;
    });

  // Competition rank: 1 + number of threats strictly ahead in the ordering.
  const rankOf = new Array<number>(n);
  const seen = new Map<string, number>(); // ordering-key → rank
  order.forEach((idx, pos) => {
    const key = `${scores[idx]}|${strideRank(threats[idx])}`;
    let rank = seen.get(key);
    if (rank === undefined) {
      rank = pos + 1;
      seen.set(key, rank);
    }
    rankOf[idx] = rank;
  });

  return threats.map((t, i) => {
    const base = BASE_SCORE[t.risk] ?? 0;
    const score = scores[i];
    const parts: string[] = [];

    if (t.risk) {
      parts.push(`Risk Level ${t.risk} (base ${base})`);
    } else {
      parts.push(`Risk Level Not provided (base 0)`);
    }

    if (t.severityScore !== null && t.severityScore >= 7) {
      parts.push(`severity score ${t.severityScore} (\u2265 7, +10)`);
    } else if (t.severityScore !== null) {
      parts.push(`severity score ${t.severityScore} (< 7, no bonus)`);
    } else {
      parts.push(`no severity score provided`);
    }

    if (t.risk) {
      parts.push(`tie-break by STRIDE category order${t.stride ? ` (${t.stride})` : ""}`);
    } else {
      parts.push(
        `ranked by STRIDE category order only${t.stride ? ` (${t.stride})` : " (no category)"}`
      );
    }

    return {
      score,
      explanation: `Ranked #${rankOf[i]} of ${n}: ${parts.join("; ")}.`,
    };
  });
}
