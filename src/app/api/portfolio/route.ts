import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { all } from "@/db";
import type { SubmissionRow } from "@/db/schema";
import { parseCondensedReview } from "@/core/condense";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/portfolio — every project side by side, from stored condensed
 * reviews (no raw-row queries).
 *
 * Per project: the latest submission's deterministic risk posture, the number
 * of reviews, the last review date, and a trend of severe (critical + high)
 * threats across every version for the sparkline.
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const rows = all<
      SubmissionRow & { project_name: string }
    >(
      `SELECT s.*, p.name AS project_name
       FROM submissions s
       JOIN projects p ON p.id = s.project_id
       ORDER BY p.name ASC, s.version ASC`
    );

    // Group submissions by project (already ordered by version ascending).
    const byProject = new Map<
      number,
      { name: string; subs: (SubmissionRow & { project_name: string })[] }
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
      };
    });

    projects.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ ok: true, data: { projects } });
  } catch (e) {
    return handleError(e);
  }
}
