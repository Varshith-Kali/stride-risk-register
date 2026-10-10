import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { get } from "@/db";
import type { SubmissionRow, ProjectRow, ReviewerRow } from "@/db/schema";
import { parseCondensedReview } from "@/core/condense";

export const runtime = "nodejs";
export const maxDuration = 120;

function notFound(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 404 });
}

/**
 * GET /api/submissions/[id] — full condensed review detail.
 *
 * Returns the stored condensed review (headline, observations, key
 * recommendations, deterministic posture/STRIDE/top-risks) tagged to its
 * project and reviewer. Raw per-threat/per-reco rows are no longer persisted,
 * so this reads solely from `condensed_review_json`.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const { id } = await context.params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json(
        { ok: false, error: "Invalid submission id." },
        { status: 400 }
      );
    }
    const submissionId = Number(id);

    const submission = get<SubmissionRow>(
      `SELECT * FROM submissions WHERE id = ?`,
      submissionId
    );
    if (!submission) return notFound("Submission not found.");

    const project = get<ProjectRow>(
      `SELECT * FROM projects WHERE id = ?`,
      submission.project_id
    );
    const reviewer = get<ReviewerRow>(
      `SELECT * FROM reviewers WHERE id = ?`,
      submission.reviewer_id
    );

    const review = parseCondensedReview(submission.condensed_review_json);

    return NextResponse.json({
      ok: true,
      data: {
        id: submission.id,
        project: project?.name ?? "Unknown project",
        reviewer: reviewer?.name ?? "Unknown reviewer",
        reviewDate: submission.review_date,
        createdAt: submission.created_at,
        version: submission.version,
        notes: submission.notes,
        excelFilename: submission.excel_filename,
        review,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
