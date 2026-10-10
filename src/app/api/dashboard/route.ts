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
import { sane } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

const CRITICAL_HIGH = new Set(["Critical", "High"]);

export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const q = req.nextUrl.searchParams;
    const projectIdRaw = sane(q.get("projectId"), 20);
    let projectId: number | undefined;
    if (projectIdRaw) {
      if (!/^\d+$/.test(projectIdRaw)) {
        return NextResponse.json({ ok: false, error: "Invalid projectId." }, { status: 400 });
      }
      projectId = Number(projectIdRaw);
    }

    const submissionIdRaw = sane(q.get("submissionId"), 20);
    let submissionIdFilter: number | undefined;
    if (submissionIdRaw) {
      if (!/^\d+$/.test(submissionIdRaw)) {
        return NextResponse.json({ ok: false, error: "Invalid submissionId." }, { status: 400 });
      }
      submissionIdFilter = Number(submissionIdRaw);
    }

    const emptyData = {
      kpis: {
        totalThreats: 0,
        criticalHigh: 0,
        withResponse: 0,
        noResponse: 0,
        unmappedRecos: 0,
        coveragePct: 0,
      },
      stride: [],
      risk: [],
      topThreats: [],
      components: [],
      coverage: { withResponse: 0, noResponse: 0 },
      reviewers: [],
    };

    // A specific submission scopes to exactly that submission; otherwise
    // "current posture" = latest submission version per project.
    const submissionIds = submissionIdFilter
      ? [submissionIdFilter]
      : latestSubmissionIds(projectId);
    if (!submissionIds.length) {
      return NextResponse.json({ ok: true, data: emptyData });
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
    const coveragePct = totalThreats
      ? Math.round((withResponse / totalThreats) * 1000) / 10
      : 0;

    const countBy = (key: (t: (typeof threats)[number]) => string) => {
      const m = new Map<string, number>();
      for (const t of threats) {
        const k = key(t) || "Not provided";
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return [...m.entries()]
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);
    };

    const stride = countBy((t) => t.stride_category);
    const risk = countBy((t) => t.risk_level);
    const components = countBy((t) => t.component).slice(0, 20);

    const topThreats = [...threats]
      .sort((a, b) => (b.rank_score ?? -1) - (a.rank_score ?? -1))
      .slice(0, 10)
      .map((t) => ({
        id: t.id,
        title: t.title,
        risk: t.risk_level,
        project: t.project_name,
        score: t.rank_score ?? undefined,
      }));

    // Reviewer workload across the same scope.
    const workload = new Map<
      string,
      { name: string; submissions: Set<number>; threats: number }
    >();
    for (const t of threats) {
      const w = workload.get(t.reviewer_name) ?? {
        name: t.reviewer_name,
        submissions: new Set<number>(),
        threats: 0,
      };
      w.submissions.add(t.submission_id);
      w.threats++;
      workload.set(t.reviewer_name, w);
    }
    const reviewers = [...workload.values()]
      .map((w) => ({ name: w.name, threats: w.threats, submissions: w.submissions.size }))
      .sort((a, b) => b.threats - a.threats);

    return NextResponse.json({
      ok: true,
      data: {
        kpis: {
          totalThreats,
          criticalHigh,
          withResponse,
          noResponse: totalThreats - withResponse,
          unmappedRecos,
          coveragePct,
        },
        stride,
        risk,
        topThreats,
        components,
        coverage: { withResponse, noResponse: totalThreats - withResponse },
        reviewers,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
