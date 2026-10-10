import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { all } from "@/db";
import type { SubmissionRow } from "@/db/schema";
import { parseCondensedReview } from "@/core/condense";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/timeline — stock-market-style time series of platform activity.
 *
 * Buckets every submission by day over its `created_at`: reviews and
 * recommendations submitted each day plus a running cumulative total, with a
 * per-reviewer breakdown so all reviewers are visible. Recommendation counts
 * come from each submission's stored condensed review (no raw-row queries).
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const rows = all<SubmissionRow & { reviewer_name: string }>(
      `SELECT s.*, r.name AS reviewer_name
       FROM submissions s
       JOIN reviewers r ON r.id = s.reviewer_id
       ORDER BY s.created_at ASC`
    );

    // Per-day buckets (chronological). created_at is an ISO timestamp.
    const byDay = new Map<string, { reviews: number; recommendations: number }>();
    const reviewerCounts = new Map<string, number>();
    let totalReviews = 0;
    let totalRecommendations = 0;

    for (const s of rows) {
      const day = (s.created_at ?? "").slice(0, 10);
      if (!day) continue;
      const c = parseCondensedReview(s.condensed_review_json);
      const bucket = byDay.get(day) ?? { reviews: 0, recommendations: 0 };
      bucket.reviews += 1;
      bucket.recommendations += c.recoCount;
      byDay.set(day, bucket);

      reviewerCounts.set(
        s.reviewer_name,
        (reviewerCounts.get(s.reviewer_name) ?? 0) + 1
      );
      totalReviews += 1;
      totalRecommendations += c.recoCount;
    }

    let cumReviews = 0;
    let cumRecommendations = 0;
    const points = [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, v]) => {
        cumReviews += v.reviews;
        cumRecommendations += v.recommendations;
        return {
          date,
          reviews: v.reviews,
          recommendations: v.recommendations,
          cumulativeReviews: cumReviews,
          cumulativeRecommendations: cumRecommendations,
        };
      });

    const reviewers = [...reviewerCounts.entries()]
      .map(([name, reviews]) => ({ name, reviews }))
      .sort((a, b) => b.reviews - a.reviews);

    return NextResponse.json({
      ok: true,
      data: {
        points,
        reviewers,
        totals: { reviews: totalReviews, recommendations: totalRecommendations },
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
