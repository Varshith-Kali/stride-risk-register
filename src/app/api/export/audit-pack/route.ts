import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { all, get } from "@/db";
import type {
  SubmissionRow,
  ProjectRow,
  ReviewerRow,
  RecommendationRow,
  AuditLogRow,
} from "@/db/schema";
import {
  queryThreats,
  queryLinksForThreats,
  enrichThreats,
  groupLinksByThreat,
  hasResponse,
  type LinkView,
} from "@/lib/threat-views";
import { sane, isClosedStatus } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

const CRITICAL_HIGH = new Set(["Critical", "High"]);

/**
 * Evidence-linked audit pack: everything an auditor needs to prove what was
 * threat-modelled, what was recommended, who reviewed it, and what was
 * decided. Consumed by the printable report page (/report/[id]).
 *
 * The response `data` IS the pack (camelCase DTO), not a nested wrapper.
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
    const reviewerName = reviewer?.name ?? "";

    const threats = enrichThreats(queryThreats("t.submission_id = ?", submissionId));

    const recommendations = all<RecommendationRow>(
      `SELECT * FROM recommendations WHERE submission_id = ? ORDER BY reco_index ASC`,
      submissionId
    );

    const links = queryLinksForThreats(threats.map((t) => t.id));
    const linksByReco = new Map<number, LinkView[]>();
    for (const l of links) {
      const arr = linksByReco.get(l.recommendation_id) ?? [];
      arr.push(l);
      linksByReco.set(l.recommendation_id, arr);
    }

    const acceptedRisks = all<{
      threat_ref: string;
      threat_title: string;
      justification: string;
      approver: string;
      expiry_date: string;
    }>(
      `SELECT t.threat_ref AS threat_ref, t.title AS threat_title,
              ar.justification, ar.approver, ar.expiry_date
       FROM accepted_risks ar
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

    // KPIs for the "Key figures" row.
    const byThreat = groupLinksByThreat(links);
    const withResponse = threats.filter((t) => hasResponse(byThreat.get(t.id) ?? [])).length;
    const openCount = threats.filter((t) => !isClosedStatus(t.status)).length;
    const linkedRecoIds = new Set(links.map((l) => l.recommendation_id));
    const unmappedRecos = recommendations.filter((r) => !linkedRecoIds.has(r.id)).length;
    const coveragePct = threats.length ? Math.round((withResponse / threats.length) * 100) : 0;

    const kpis: Record<string, number | string> = {
      Threats: threats.length,
      "Critical / High": threats.filter((t) => CRITICAL_HIGH.has(t.risk_level)).length,
      Open: openCount,
      Recommendations: recommendations.length,
      "Unmapped recos": unmappedRecos,
      Coverage: `${coveragePct}%`,
    };

    const pack = {
      generatedAt: new Date().toISOString(),
      submission: {
        id: submission.id,
        projectName: project?.name ?? "",
        reviewerName,
        reviewDate: submission.review_date,
        version: submission.version,
        createdAt: submission.created_at,
      },
      kpis,
      threats: threats.map((t) => ({
        id: t.id,
        ref: t.threat_ref || `T-${t.id}`,
        title: t.title ?? "",
        stride: t.stride_category ?? "",
        component: t.component ?? "",
        risk: t.risk_level ?? "",
        status: t.status,
        excel_sheet: t.excel_sheet ?? "",
        excel_row: t.excel_row ?? 0,
      })),
      recommendations: recommendations.map((r) => ({
        text: r.text,
        reviewerName,
        status: r.status,
        links: (linksByReco.get(r.id) ?? []).map((l) => ({
          threatRef: l.threat_ref || `T-${l.threat_id}`,
          threatTitle: l.threat_title ?? "",
          confidence: l.confidence,
          decision: l.decision,
          rationale: l.rationale ?? "",
          quote: l.quote ?? "",
        })),
      })),
      acceptedRisks: acceptedRisks.map((a) => ({
        threatRef: a.threat_ref || "",
        threatTitle: a.threat_title ?? "",
        justification: a.justification ?? "",
        approver: a.approver ?? "",
        expiryDate: a.expiry_date ?? "",
      })),
      auditTrail: auditLog.map((e) => ({
        at: e.created_at,
        actor: e.actor,
        action: e.action,
        detail: e.detail,
      })),
    };

    return NextResponse.json({ ok: true, data: pack });
  } catch (e) {
    return handleError(e);
  }
}
