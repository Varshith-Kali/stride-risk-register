import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { all } from "@/db";
import { latestSubmissionIds } from "@/lib/threat-views";
import { sane } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

interface RecoRow {
  id: number;
  text: string;
  status: string;
  submission_id: number;
  project_id: number;
  project_name: string;
  reviewer_name: string;
}

interface RecoLinkRow {
  id: number;
  recommendation_id: number;
  threat_id: number;
  threat_ref: string;
  threat_title: string;
  confidence: string;
  decision: string;
  rationale: string;
  quote: string;
}

/**
 * GET /api/recommendations — every reviewer recommendation in the current
 * posture (latest submission version per project) with its linked threats.
 * Optional ?projectId= scopes to one project.
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const projectIdRaw = sane(req.nextUrl.searchParams.get("projectId"), 20);
    let projectId: number | undefined;
    if (projectIdRaw) {
      if (!/^\d+$/.test(projectIdRaw)) {
        return NextResponse.json({ ok: false, error: "Invalid projectId." }, { status: 400 });
      }
      projectId = Number(projectIdRaw);
    }

    const submissionIds = latestSubmissionIds(projectId);
    if (!submissionIds.length) {
      return NextResponse.json({ ok: true, data: { recos: [] } });
    }

    const placeholders = submissionIds.map(() => "?").join(",");
    const rows = all<RecoRow>(
      `SELECT rc.id, rc.text, rc.status, rc.submission_id,
              p.id AS project_id, p.name AS project_name, r.name AS reviewer_name
       FROM recommendations rc
       JOIN submissions s ON s.id = rc.submission_id
       JOIN projects p ON p.id = s.project_id
       JOIN reviewers r ON r.id = s.reviewer_id
       WHERE rc.submission_id IN (${placeholders})
       ORDER BY rc.submission_id ASC, rc.reco_index ASC`,
      ...submissionIds
    );

    const recoIds = rows.map((r) => r.id);
    const linkRows = recoIds.length
      ? all<RecoLinkRow>(
          `SELECT l.id, l.recommendation_id, l.threat_id, l.confidence, l.decision,
                  l.rationale, l.quote,
                  t.threat_ref AS threat_ref, t.title AS threat_title
           FROM links l
           JOIN threats t ON t.id = l.threat_id
           WHERE l.recommendation_id IN (${recoIds.map(() => "?").join(",")})
           ORDER BY l.id ASC`,
          ...recoIds
        )
      : [];

    const linksByReco = new Map<number, RecoLinkRow[]>();
    for (const l of linkRows) {
      const arr = linksByReco.get(l.recommendation_id) ?? [];
      arr.push(l);
      linksByReco.set(l.recommendation_id, arr);
    }

    const recos = rows.map((r) => ({
      id: r.id,
      text: r.text,
      status: r.status,
      projectName: r.project_name,
      projectId: r.project_id,
      submissionId: r.submission_id,
      reviewerName: r.reviewer_name,
      links: (linksByReco.get(r.id) ?? []).map((l) => ({
        id: l.id,
        threatId: l.threat_id,
        threatRef: l.threat_ref || `T-${l.threat_id}`,
        threatTitle: l.threat_title ?? "",
        confidence: l.confidence,
        decision: l.decision,
        rationale: l.rationale ?? "",
        quote: l.quote ?? "",
      })),
    }));

    return NextResponse.json({ ok: true, data: { recos } });
  } catch (e) {
    return handleError(e);
  }
}
