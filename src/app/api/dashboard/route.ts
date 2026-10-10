import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { all } from "@/db";
import {
  queryThreats,
  queryLinksForThreats,
  groupLinksByThreat,
  latestSubmissionIds,
  hasResponse,
} from "@/lib/threat-views";
import { sane, daysAgo, isClosedStatus } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

const CRITICAL_HIGH = new Set(["Critical", "High"]);

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

    // Current posture = latest submission version per project (no double-counting).
    const submissionIds = latestSubmissionIds(projectId);
    if (!submissionIds.length) {
      return NextResponse.json({
        ok: true,
        data: {
          kpis: {
            totalThreats: 0,
            criticalHigh: 0,
            withResponse: 0,
            withoutResponse: 0,
            unmappedRecos: 0,
            reviewerCoveragePct: 0,
          },
          strideDistribution: [],
          riskDistribution: [],
          topThreats: [],
          coverage: { with: 0, without: 0 },
          reviewerWorkload: [],
          componentBreakdown: [],
          ageingBuckets: { "0-7 days": 0, "8-30 days": 0, "31-90 days": 0, "90+ days": 0 },
        },
      });
    }

    const placeholders = submissionIds.map(() => "?").join(",");
    const threats = queryThreats(`t.submission_id IN (${placeholders})`, ...submissionIds);
    const linksByThreat = groupLinksByThreat(queryLinksForThreats(threats.map((t) => t.id)));

    const recos = all<{ id: number; submission_id: number }>(
      `SELECT id, submission_id FROM recommendations WHERE submission_id IN (${placeholders})`,
      ...submissionIds
    );
    const recoLinkCounts = all<{ recommendation_id: number; c: number }>(
      `SELECT recommendation_id, COUNT(*) AS c FROM links
       WHERE recommendation_id IN (SELECT id FROM recommendations WHERE submission_id IN (${placeholders}))
       GROUP BY recommendation_id`,
      ...submissionIds
    );
    const linkedRecoIds = new Set(recoLinkCounts.map((r) => r.recommendation_id));
    const unmappedRecos = recos.filter((r) => !linkedRecoIds.has(r.id)).length;

    const withResponse = threats.filter((t) => hasResponse(linksByThreat.get(t.id) ?? [])).length;
    const totalThreats = threats.length;
    const criticalHigh = threats.filter((t) => CRITICAL_HIGH.has(t.risk_level)).length;
    const reviewerCoveragePct = totalThreats
      ? Math.round((withResponse / totalThreats) * 1000) / 10
      : 0;

    const countBy = (key: (t: (typeof threats)[number]) => string) => {
      const m = new Map<string, number>();
      for (const t of threats) {
        const k = key(t) || "Not provided";
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return [...m.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);
    };

    const strideDistribution = countBy((t) => t.stride_category);
    const riskDistribution = countBy((t) => t.risk_level);
    const componentBreakdown = countBy((t) => t.component).slice(0, 20);

    const topThreats = [...threats]
      .sort((a, b) => (b.rank_score ?? -1) - (a.rank_score ?? -1))
      .slice(0, 10)
      .map((t) => ({
        id: t.id,
        ref: t.threat_ref,
        title: t.title,
        risk: t.risk_level,
        stride: t.stride_category,
        rankScore: t.rank_score,
        rankExplanation: t.rank_explanation,
        project: t.project_name,
        reviewer: t.reviewer_name,
      }));

    // Reviewer workload across the same latest-version scope.
    const workload = new Map<
      string,
      { reviewer: string; submissions: Set<number>; openThreats: number }
    >();
    for (const t of threats) {
      const w = workload.get(t.reviewer_name) ?? {
        reviewer: t.reviewer_name,
        submissions: new Set<number>(),
        openThreats: 0,
      };
      w.submissions.add(t.submission_id);
      if (!isClosedStatus(t.status)) w.openThreats++;
      workload.set(t.reviewer_name, w);
    }
    const reviewerWorkload = [...workload.values()]
      .map((w) => ({ reviewer: w.reviewer, submissions: w.submissions.size, openThreats: w.openThreats }))
      .sort((a, b) => b.openThreats - a.openThreats);

    // Ageing of open threats by review date.
    const buckets: Record<string, number> = {
      "0-7 days": 0,
      "8-30 days": 0,
      "31-90 days": 0,
      "90+ days": 0,
    };
    for (const t of threats) {
      if (isClosedStatus(t.status)) continue;
      const days = daysAgo(t.review_date || t.created_at);
      if (days <= 7) buckets["0-7 days"]++;
      else if (days <= 30) buckets["8-30 days"]++;
      else if (days <= 90) buckets["31-90 days"]++;
      else buckets["90+ days"]++;
    }

    return NextResponse.json({
      ok: true,
      data: {
        kpis: {
          totalThreats,
          criticalHigh,
          withResponse,
          withoutResponse: totalThreats - withResponse,
          unmappedRecos,
          reviewerCoveragePct,
        },
        strideDistribution,
        riskDistribution,
        topThreats,
        coverage: { with: withResponse, without: totalThreats - withResponse },
        reviewerWorkload,
        componentBreakdown,
        ageingBuckets: buckets,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
