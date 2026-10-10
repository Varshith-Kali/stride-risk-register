import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { all, get } from "@/db";
import type { ReviewerRow } from "@/db/schema";
import { queryThreats, queryLinksForThreats, groupLinksByThreat, hasResponse } from "@/lib/threat-views";
import { sane, daysAgo, isClosedStatus } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Objective reviewer visibility metrics only — coverage, unmapped ratio,
 * review turnaround, ageing of open items. Framed as visibility, not
 * performance policing.
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const reviewerFilter = sane(req.nextUrl.searchParams.get("reviewer"), 200);

    const reviewers = reviewerFilter
      ? all<ReviewerRow>(`SELECT * FROM reviewers WHERE name = ?`, reviewerFilter)
      : all<ReviewerRow>(`SELECT * FROM reviewers WHERE active = 1 ORDER BY name ASC`);

    if (reviewerFilter && !reviewers.length) {
      return NextResponse.json({ ok: false, error: "Reviewer not found." }, { status: 404 });
    }

    const nowIso = new Date().toISOString();
    const scorecards = reviewers.map((rev) => {
      const subs = all<{ id: number; created_at: string; review_date: string }>(
        `SELECT id, created_at, review_date FROM submissions WHERE reviewer_id = ? ORDER BY created_at ASC`,
        rev.id
      );
      const submissionIds = subs.map((s) => s.id);

      const threats =
        submissionIds.length > 0
          ? queryThreats(`t.submission_id IN (${submissionIds.map(() => "?").join(",")})`, ...submissionIds)
          : [];
      const linksByThreat = groupLinksByThreat(queryLinksForThreats(threats.map((t) => t.id)));

      const withResponse = threats.filter((t) => hasResponse(linksByThreat.get(t.id) ?? [])).length;
      const coveragePct = threats.length ? Math.round((withResponse / threats.length) * 1000) / 10 : 0;

      const totalRecos =
        get<{ c: number }>(
          `SELECT COUNT(*) AS c FROM recommendations WHERE submission_id IN (${submissionIds.map(() => "?").join(",")})`,
          ...submissionIds
        )?.c ?? 0;
      const linkedRecos =
        get<{ c: number }>(
          `SELECT COUNT(DISTINCT recommendation_id) AS c FROM links
           WHERE recommendation_id IN (SELECT id FROM recommendations WHERE submission_id IN (${submissionIds.map(() => "?").join(",")}))`,
          ...submissionIds
        )?.c ?? 0;
      const unmappedRatio = totalRecos ? Math.round(((totalRecos - linkedRecos) / totalRecos) * 1000) / 10 : 0;

      // Time from submission (upload) to the stated review date, in days.
      const turnarounds = subs
        .filter((s) => s.review_date)
        .map((s) => {
          const ms = new Date(`${s.review_date}T00:00:00Z`).getTime() - new Date(s.created_at).getTime();
          return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 86_400_000)) : null;
        })
        .filter((d): d is number => d !== null);
      const avgDaysToReview = turnarounds.length
        ? Math.round((turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length) * 10) / 10
        : 0;

      const openThreats = threats.filter((t) => !isClosedStatus(t.status));
      const ages = openThreats.map((t) => daysAgo(t.review_date || t.created_at));
      const ageingOpen = ages.length ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10 : 0;
      const oldestOpen = ages.length ? Math.max(...ages) : 0;

      return {
        reviewer: rev.name,
        role: rev.role,
        submissions: subs.length,
        threats: threats.length,
        recommendations: totalRecos,
        coveragePct,
        withResponse,
        withoutResponse: threats.length - withResponse,
        unmappedRatio,
        unmappedRecos: totalRecos - linkedRecos,
        avgDaysToReview,
        ageingOpen,
        oldestOpenDays: oldestOpen,
        openThreats: openThreats.length,
        generatedAt: nowIso,
      };
    });

    return NextResponse.json({ ok: true, data: { scorecards } });
  } catch (e) {
    return handleError(e);
  }
}
