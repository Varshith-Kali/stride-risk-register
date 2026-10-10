import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, readJsonRequest, handleError } from "@/lib/api-utils";
import { run, get, audit, now, transaction } from "@/db";
import type { ThreatRow, RecommendationRow } from "@/db/schema";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Persist AI-proposed threat↔recommendation links as `proposed` (human review
 * happens in the register / recommendations views via accept/reject).
 *
 * Body: { submissionId: number, links: [{ threatRow, recoIndex, confidence, rationale, quote }] }
 *  - threatRow  = 1-based Excel row (matches threats.excel_row)
 *  - recoIndex  = 1-based recommendation index (matches recommendations.reco_index)
 *
 * Resolution is strict: a link is stored only when exactly one threat matches
 * (submission_id, excel_row) and exactly one recommendation matches
 * (submission_id, reco_index). Ambiguous or dangling references are skipped
 * and counted — never guessed — per the no-hallucination rule.
 */

interface BulkLinkInput {
  threatRow: number;
  recoIndex: number;
  confidence?: string;
  rationale?: string;
  quote?: string;
}

const CONFIDENCES = new Set(["High", "Medium", "Low"]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const limited = checkRateLimit(req);
  if (limited) return limited;

  try {
    const parsed = await readJsonRequest<{
      submissionId: number;
      links: BulkLinkInput[];
    }>(req);
    if (!parsed.ok) return parsed.error;
    const { submissionId, links } = parsed.data;

    if (!Number.isInteger(submissionId) || submissionId < 1) {
      return NextResponse.json(
        { error: "submissionId must be a positive integer." },
        { status: 400 }
      );
    }
    if (!Array.isArray(links)) {
      return NextResponse.json(
        { error: "links must be an array." },
        { status: 400 }
      );
    }

    let created = 0;
    let skipped = 0;

    transaction(() => {
      for (const l of links) {
        const threatRow = l?.threatRow;
        const recoIndex = l?.recoIndex;
        if (
          typeof threatRow !== "number" ||
          !Number.isInteger(threatRow) ||
          typeof recoIndex !== "number" ||
          !Number.isInteger(recoIndex)
        ) {
          skipped++;
          continue;
        }
        const threat = get<ThreatRow>(
          `SELECT id FROM threats WHERE submission_id = ? AND excel_row = ?`,
          submissionId,
          threatRow
        );
        // Ambiguity guard: excel_row must identify exactly one threat
        // (multi-sheet workbooks can repeat row numbers — never guess).
        const threatCount =
          get<{ n: number }>(
            `SELECT COUNT(*) AS n FROM threats WHERE submission_id = ? AND excel_row = ?`,
            submissionId,
            threatRow
          )?.n ?? 0;
        const reco = get<RecommendationRow>(
          `SELECT id FROM recommendations WHERE submission_id = ? AND reco_index = ?`,
          submissionId,
          recoIndex
        );
        if (threatCount !== 1 || !threat || !reco) {
          skipped++;
          continue;
        }
        const confidence = CONFIDENCES.has(l.confidence ?? "")
          ? (l.confidence as string)
          : "Medium";
        const res = run(
          `INSERT OR IGNORE INTO links
             (threat_id, recommendation_id, confidence, rationale, quote,
              source_label, decision, created_at)
           VALUES (?, ?, ?, ?, ?, 'AI-inferred link', 'proposed', ?)`,
          threat.id,
          reco.id,
          confidence,
          String(l.rationale ?? "").slice(0, 500),
          String(l.quote ?? "").slice(0, 2000),
          now()
        );
        if (Number(res.changes) > 0) created++;
        else skipped++;
      }
    });

    audit(
      "system",
      "links.bulk_created",
      "submission",
      submissionId,
      `${created} proposed AI links stored, ${skipped} skipped (ambiguous/dangling)`
    );

    return NextResponse.json({ ok: true, data: { created, skipped } });
  } catch (e) {
    return handleError(e);
  }
}
