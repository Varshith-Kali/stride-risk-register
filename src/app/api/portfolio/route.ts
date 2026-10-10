import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { all } from "@/db";
import type { SubmissionRow } from "@/db/schema";
import { parseCondensedReview } from "@/core/condense";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/portfolio — every project side by side, from stored condensed
 * reviews (no raw-row queries). The portfolio doubles as the per-project
 * repository of reviews: each project carries the full list of its condensed
 * reviews (newest first) so the UI can open any one of them.
 *
 * Per project: the latest submission's deterministic risk posture, the number
 * of reviews, the last review date, a trend of severe (critical + high)
 * threats across every version for the sparkline, and the review list.
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
       ORDER BY p.name ASC, s.version ASC`
    );

    // Group submissions by project (already ordered by version ascending).
    const byProject = new Map<
      number,
      {
        name: string;
        subs: (SubmissionRow & {
          project_name: string;
          reviewer_name: string;
          reviewer_role: string;
        })[];
      }
    >();
    for (const s of rows) {
      const g = byProject.get(s.project_id) ?? { name: s.project_name, subs: [] };
      g.subs.push(s);
      byProject.set(s.project_id, g);
    }

    const projects = [...byProject.entries()].map(([id, g]) => {
      const trend = g.subs.map((s) => {
        const c = parseCondensedReview(s.condensed_review_json);
        return {
          date: s.review_date,
          severe: c.riskPosture.critical + c.riskPosture.high,
        };
      });

      const last = g.subs[g.subs.length - 1];
      const latest = parseCondensedReview(last.condensed_review_json);

      // Full review list for this project, newest first.
      const reviews = g.subs
        .map((s) => {
          const c = parseCondensedReview(s.condensed_review_json);
          return {
            id: s.id,
            reviewer: s.reviewer_name,
            reviewerRole: s.reviewer_role,
            reviewDate: s.review_date ?? "",
            createdAt: s.created_at,
            version: s.version,
            headline: c.headline,
            riskPosture: c.riskPosture,
            threatCount: c.threatCount,
            recoCount: c.recoCount,
            aiGenerated: c.aiGenerated,
          };
        })
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

      return {
        id,
        name: g.name,
        criticalCount: latest.riskPosture.critical,
        highCount: latest.riskPosture.high,
        mediumCount: latest.riskPosture.medium,
        lowCount: latest.riskPosture.low,
        reviewCount: g.subs.length,
        lastReviewDate: last.review_date ?? "",
        trend,
        reviews,
      };
    });

    projects.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ ok: true, data: { projects } });
  } catch (e) {
    return handleError(e);
  }
}
