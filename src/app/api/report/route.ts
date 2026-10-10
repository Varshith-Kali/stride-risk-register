import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { all } from "@/db";
import type { SubmissionRow } from "@/db/schema";
import { parseCondensedReview } from "@/core/condense";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/report — the governance review report.
 *
 * One flat, newest-first table of EVERY condensed review across all reviewers
 * (reviewer, project, date, risk posture, threat/recommendation counts and the
 * AI headline), plus the reviewer roster and totals. Derived entirely from each
 * submission's stored condensed review — no raw per-threat/per-reco queries.
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const rows = all<
      SubmissionRow & {
        project_name: string;
        reviewer_name: string;
        reviewer_role: string;
      }
    >(
      `SELECT s.*, p.name AS project_name,
              r.name AS reviewer_name, r.role AS reviewer_role
       FROM submissions s
       JOIN projects p ON p.id = s.project_id
       JOIN reviewers r ON r.id = s.reviewer_id
       ORDER BY s.created_at DESC`
    );

    const reviewerSet = new Set<string>();
    let threatsReviewed = 0;
    let recommendations = 0;

    const reportRows = rows.map((s) => {
      const c = parseCondensedReview(s.condensed_review_json);
      reviewerSet.add(s.reviewer_name);
      threatsReviewed += c.threatCount;
      recommendations += c.recoCount;
      return {
        id: s.id,
        reviewer: s.reviewer_name,
        reviewerRole: s.reviewer_role,
        project: s.project_name,
        reviewDate: s.review_date,
        createdAt: s.created_at,
        version: s.version,
        critical: c.riskPosture.critical,
        high: c.riskPosture.high,
        medium: c.riskPosture.medium,
        low: c.riskPosture.low,
        threatCount: c.threatCount,
        recoCount: c.recoCount,
        headline: c.headline,
        aiGenerated: c.aiGenerated,
      };
    });

    const reviewers = [...reviewerSet].sort((a, b) => a.localeCompare(b));

    return NextResponse.json({
      ok: true,
      data: {
        rows: reportRows,
        reviewers,
        totals: {
          reviews: rows.length,
          reviewers: reviewerSet.size,
          threatsReviewed,
          recommendations,
        },
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
