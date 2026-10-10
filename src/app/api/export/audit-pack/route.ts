import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { all, get } from "@/db";
import type {
  SubmissionRow,
  ProjectRow,
  ReviewerRow,
  RecommendationRow,
  StatusHistoryRow,
  AuditLogRow,
  AcceptedRiskRow,
} from "@/db/schema";
import { queryThreats, queryLinksForThreats, enrichThreats } from "@/lib/threat-views";
import { sane } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Evidence-linked audit pack: everything an auditor needs to prove what was
 * threat-modelled, what was recommended, who reviewed it, and what was
 * decided. Consumed by the printable report page (/report/[id]).
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const idRaw = sane(req.nextUrl.searchParams.get("submissionId"), 20);
    if (!idRaw || !/^\d+$/.test(idRaw)) {
      return NextResponse.json({ ok: false, error: "submissionId query param is required." }, { status: 400 });
    }
    const submissionId = Number(idRaw);

    const submission = get<SubmissionRow>(`SELECT * FROM submissions WHERE id = ?`, submissionId);
    if (!submission) {
      return NextResponse.json({ ok: false, error: "Submission not found." }, { status: 404 });
    }
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
       ORDER BY h.changed_at ASC`,
      submissionId
    );

    const acceptedRisks = all<AcceptedRiskRow>(
      `SELECT ar.* FROM accepted_risks ar
       JOIN threats t ON t.id = ar.threat_id
       WHERE t.submission_id = ?
       ORDER BY ar.id ASC`,
      submissionId
    );

    const auditLog = all<AuditLogRow>(
      `SELECT * FROM audit_log
       WHERE (entity = 'submission' AND entity_id = ?)
          OR (entity = 'threat' AND entity_id IN (SELECT CAST(id AS TEXT) FROM threats WHERE submission_id = ?))
          OR (entity = 'recommendation' AND entity_id IN (SELECT CAST(id AS TEXT) FROM recommendations WHERE submission_id = ?))
          OR (entity = 'link' AND entity_id IN (SELECT CAST(id AS TEXT) FROM links WHERE threat_id IN (SELECT id FROM threats WHERE submission_id = ?)))
       ORDER BY id ASC`,
      String(submissionId),
      submissionId,
      submissionId,
      submissionId
    );

    return NextResponse.json({
      ok: true,
      data: {
        pack: {
          generatedAt: new Date().toISOString(),
          submission,
          project,
          reviewer,
          threats,
          recommendations,
          links,
          statusHistory,
          acceptedRisks,
          auditLog,
        },
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
