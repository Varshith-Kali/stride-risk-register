import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { all } from "@/db";
import type { ReviewerRow, SubmissionRow } from "@/db/schema";
import { parseCondensedReview } from "@/core/condense";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/scorecard — per-reviewer visibility, from stored condensed reviews.
 *
 * Each active reviewer's number of reviews, total threats reviewed, total
 * recommendations, summed risk posture and last activity. Framed as visibility
 * across the platform, not performance policing. Coverage/unmapped ratios are
 * gone with the raw link rows.
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const reviewers = all<ReviewerRow>(
      `SELECT * FROM reviewers WHERE active = 1 ORDER BY name ASC`
    );
    const rows = all<SubmissionRow>(
      `SELECT * FROM submissions ORDER BY created_at ASC`
    );

    // Aggregate submissions per reviewer in one pass.
    const agg = new Map<
      number,
      {
        reviews: number;
        threatsReviewed: number;
        recommendations: number;
        riskPosture: { critical: number; high: number; medium: number; low: number };
        lastActivity: string;
      }
    >();
    for (const s of rows) {
      const c = parseCondensedReview(s.condensed_review_json);
      const a =
        agg.get(s.reviewer_id) ?? {
          reviews: 0,
          threatsReviewed: 0,
          recommendations: 0,
          riskPosture: { critical: 0, high: 0, medium: 0, low: 0 },
          lastActivity: "",
        };
      a.reviews += 1;
      a.threatsReviewed += c.threatCount;
      a.recommendations += c.recoCount;
      a.riskPosture.critical += c.riskPosture.critical;
      a.riskPosture.high += c.riskPosture.high;
      a.riskPosture.medium += c.riskPosture.medium;
      a.riskPosture.low += c.riskPosture.low;
      if (s.created_at > a.lastActivity) a.lastActivity = s.created_at;
      agg.set(s.reviewer_id, a);
    }

    const scorecards = reviewers.map((rev) => {
      const a = agg.get(rev.id);
      return {
        id: rev.id,
        name: rev.name,
        role: rev.role,
        reviews: a?.reviews ?? 0,
        threatsReviewed: a?.threatsReviewed ?? 0,
        recommendations: a?.recommendations ?? 0,
        riskPosture: a?.riskPosture ?? {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
        },
        lastActivity: a?.lastActivity ?? "",
      };
    });

    return NextResponse.json({ ok: true, data: { scorecards } });
  } catch (e) {
    return handleError(e);
  }
}
