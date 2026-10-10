import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { all, get } from "@/db";
import type {
  SubmissionRow,
  ProjectRow,
  ReviewerRow,
  RecommendationRow,
  StatusHistoryRow,
} from "@/db/schema";
import { queryThreats, queryLinksForThreats, enrichThreats } from "@/lib/threat-views";

export const runtime = "nodejs";
export const maxDuration = 120;

function notFound(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 404 });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const { id } = await context.params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ ok: false, error: "Invalid submission id." }, { status: 400 });
    }
    const submissionId = Number(id);

    const submission = get<SubmissionRow>(`SELECT * FROM submissions WHERE id = ?`, submissionId);
    if (!submission) return notFound("Submission not found.");

    const project = get<ProjectRow>(`SELECT * FROM projects WHERE id = ?`, submission.project_id);
    const reviewer = get<ReviewerRow>(`SELECT * FROM reviewers WHERE id = ?`, submission.reviewer_id);

    const threats = enrichThreats(queryThreats("t.submission_id = ?", submissionId));

    const recommendations = all<RecommendationRow>(
      `SELECT * FROM recommendations WHERE submission_id = ? ORDER BY reco_index ASC`,
      submissionId
    );

    const links = queryLinksForThreats(threats.map((t) => t.id));

    const statusHistory = all<StatusHistoryRow>(
      `SELECT h.* FROM status_history h
       JOIN threats t ON t.id = h.threat_id
       WHERE t.submission_id = ?
       ORDER BY h.changed_at DESC`,
      submissionId
    );

    return NextResponse.json({
      ok: true,
      data: { submission, project, reviewer, threats, recommendations, links, statusHistory },
    });
  } catch (e) {
    return handleError(e);
  }
}
