/**
 * No-hallucination guards for AI-proposed threat↔recommendation links.
 *
 * `assertTraceable` is the post-validation step: every link must quote an
 * exact span from its source text (case-insensitive substring of the
 * recommendation text or the threat title+description). Anything that fails
 * this check throws — the link is rejected, never silently kept.
 */
import type {
  ParsedRecommendation,
  ParsedThreat,
  ProposedLink,
} from "./types";

export class TraceabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TraceabilityError";
  }
}

/**
 * Throw TraceabilityError if any link is not grounded in its sources.
 * - Unknown threatRow / recoIndex → throw.
 * - Empty quote → throw.
 * - Quote not found (case-insensitive) in the recommendation text nor in
 *   the threat's title+description → throw.
 */
export function assertTraceable(
  links: ProposedLink[],
  threats: ParsedThreat[],
  recos: ParsedRecommendation[]
): void {
  const threatByRow = new Map<number, ParsedThreat>();
  for (const t of threats) {
    if (!threatByRow.has(t.row)) threatByRow.set(t.row, t);
  }
  const recoByIndex = new Map<number, ParsedRecommendation>();
  for (const r of recos) recoByIndex.set(r.index, r);

  for (const link of links) {
    const where = `link (threat row ${link.threatRow}, recommendation ${link.recoIndex})`;
    const threat = threatByRow.get(link.threatRow);
    if (!threat) {
      throw new TraceabilityError(
        `Untraceable ${where}: no threat exists for Excel row ${link.threatRow}.`
      );
    }
    const reco = recoByIndex.get(link.recoIndex);
    if (!reco) {
      throw new TraceabilityError(
        `Untraceable ${where}: no recommendation exists with index ${link.recoIndex}.`
      );
    }
    const quote = (link.quote ?? "").trim();
    if (!quote) {
      throw new TraceabilityError(`Untraceable ${where}: the quote is empty.`);
    }
    const q = quote.toLowerCase();
    const inReco = reco.text.toLowerCase().includes(q);
    const threatText = `${threat.title}\n${threat.description}`.toLowerCase();
    const inThreat = threatText.includes(q);
    if (!inReco && !inThreat) {
      throw new TraceabilityError(
        `Untraceable ${where}: the quote does not appear in the recommendation text or the threat text. ` +
          `Quote: "${quote.slice(0, 120)}${quote.length > 120 ? "…" : ""}"`
      );
    }
  }
}

/** Threats with no proposed/accepted link — "No Reviewer Response". */
export function findUnmappedThreats(
  threats: ParsedThreat[],
  links: ProposedLink[]
): ParsedThreat[] {
  const mappedRows = new Set(links.map((l) => l.threatRow));
  return threats.filter((t) => !mappedRows.has(t.row));
}

/** Recommendations with no proposed/accepted link — "Unmapped Recommendation". */
export function findUnmappedRecos(
  recos: ParsedRecommendation[],
  links: ProposedLink[]
): ParsedRecommendation[] {
  const mappedIndexes = new Set(links.map((l) => l.recoIndex));
  return recos.filter((r) => !mappedIndexes.has(r.index));
}
