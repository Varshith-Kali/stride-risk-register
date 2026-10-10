import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { all } from "@/db";
import type { SubmissionRow } from "@/db/schema";
import { parseCondensedReview } from "@/core/condense";
import { STRIDE_ORDER } from "@/lib/risk";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/dashboard — the shared visibility hub.
 *
 * Aggregates across EVERY submission from its stored condensed review (no raw
 * per-threat/per-reco queries): a newest-first feed of reviews plus summed
 * aggregates (risk posture, STRIDE distribution, reviews per reviewer, totals).
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const rows = all<
      SubmissionRow & { project_name: string; reviewer_name: string }
    >(
      `SELECT s.*, p.name AS project_name, r.name AS reviewer_name
       FROM submissions s
       JOIN projects p ON p.id = s.project_id
       JOIN reviewers r ON r.id = s.reviewer_id
       ORDER BY s.created_at DESC`
    );

    const riskPosture = { critical: 0, high: 0, medium: 0, low: 0 };
    const strideTotals = new Map<string, number>();
    const reviewerCounts = new Map<string, number>();
    let threatsReviewed = 0;
    let recommendations = 0;

    const reviews = rows.map((s) => {
      const c = parseCondensedReview(s.condensed_review_json);
      riskPosture.critical += c.riskPosture.critical;
      riskPosture.high += c.riskPosture.high;
      riskPosture.medium += c.riskPosture.medium;
      riskPosture.low += c.riskPosture.low;
      for (const [k, v] of Object.entries(c.strideCounts)) {
        if (k === "") continue; // "Not categorised" is noise in the chart
        strideTotals.set(k, (strideTotals.get(k) ?? 0) + v);
      }
      reviewerCounts.set(
        s.reviewer_name,
        (reviewerCounts.get(s.reviewer_name) ?? 0) + 1
      );
      threatsReviewed += c.threatCount;
      recommendations += c.recoCount;

      return {
        id: s.id,
        project: s.project_name,
        reviewer: s.reviewer_name,
        reviewDate: s.review_date,
        createdAt: s.created_at,
        headline: c.headline,
        riskPosture: c.riskPosture,
        threatCount: c.threatCount,
        recoCount: c.recoCount,
        aiGenerated: c.aiGenerated,
      };
    });

    // STRIDE in canonical order (skip the "" bucket), always six slots present.
    const stride = STRIDE_ORDER.filter((name) => name !== "").map((name) => ({
      name,
      value: strideTotals.get(name) ?? 0,
    }));

    const reviewsByReviewer = [...reviewerCounts.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    return NextResponse.json({
      ok: true,
      data: {
        totals: {
          reviews: rows.length,
          threatsReviewed,
          recommendations,
          reviewers: reviewerCounts.size,
        },
        riskPosture,
        stride,
        reviewsByReviewer,
        reviews,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
