import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { all, get } from "@/db";
import type { ReviewerRow } from "@/db/schema";
import {
  queryThreats,
  queryLinksForThreats,
  groupLinksByThreat,
  hasResponse,
  type ThreatListRow,
} from "@/lib/threat-views";
import { sane, daysAgo, isClosedStatus } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

interface ScorecardSubmission {
  id: number;
  projectName: string;
  reviewDate: string;
  submittedAt: string;
  threatCount: number;
  recoCount: number;
}

interface OpenItem {
  id: number;
  ref: string;
  title: string;
  projectName: string;
  status: string;
  risk: string;
  daysOpen: number;
}

interface Scorecard {
  reviewer: string;
  role: string;
  coveragePct: number;
  unmappedRatio: number;
  avgDaysSubmissionToReview: number;
  avgOpenAgeingDays: number;
  oldestOpenDays: number;
  threats: number;
  recommendations: number;
  withResponse: number;
  withoutResponse: number;
  unmappedRecos: number;
  openThreats: number;
  submissions: ScorecardSubmission[];
  openItems: OpenItem[];
  generatedAt: string;
}

function buildScorecard(rev: ReviewerRow, nowIso: string): Scorecard {
  const subs = all<{
    id: number;
    created_at: string;
    review_date: string;
    project_name: string;
  }>(
    `SELECT s.id, s.created_at, s.review_date, p.name AS project_name
     FROM submissions s
     JOIN projects p ON p.id = s.project_id
     WHERE s.reviewer_id = ?
     ORDER BY s.created_at ASC`,
    rev.id
  );
  const submissionIds = subs.map((s) => s.id);

  const threats: ThreatListRow[] =
    submissionIds.length > 0
      ? queryThreats(`t.submission_id IN (${submissionIds.map(() => "?").join(",")})`, ...submissionIds)
      : [];
  const linksByThreat = groupLinksByThreat(queryLinksForThreats(threats.map((t) => t.id)));

  const withResponse = threats.filter((t) => hasResponse(linksByThreat.get(t.id) ?? [])).length;
  const coveragePct = threats.length ? Math.round((withResponse / threats.length) * 1000) / 10 : 0;

  // Per-submission threat/reco counts for the submissions table.
  const threatCountBySub = new Map<number, number>();
  for (const t of threats) {
    threatCountBySub.set(t.submission_id, (threatCountBySub.get(t.submission_id) ?? 0) + 1);
  }
  const recoCountBySub = new Map<number, number>();
  if (submissionIds.length) {
    const recoRows = all<{ submission_id: number; c: number }>(
      `SELECT submission_id, COUNT(*) AS c FROM recommendations
       WHERE submission_id IN (${submissionIds.map(() => "?").join(",")})
       GROUP BY submission_id`,
      ...submissionIds
    );
    for (const r of recoRows) recoCountBySub.set(r.submission_id, r.c);
  }

  const totalRecos = submissionIds.length
    ? get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM recommendations WHERE submission_id IN (${submissionIds.map(() => "?").join(",")})`,
        ...submissionIds
      )?.c ?? 0
    : 0;
  const linkedRecos = submissionIds.length
    ? get<{ c: number }>(
        `SELECT COUNT(DISTINCT recommendation_id) AS c FROM links
         WHERE recommendation_id IN (SELECT id FROM recommendations WHERE submission_id IN (${submissionIds
           .map(() => "?")
           .join(",")}))`,
        ...submissionIds
      )?.c ?? 0
    : 0;
  const unmappedRatio = totalRecos ? Math.round(((totalRecos - linkedRecos) / totalRecos) * 1000) / 10 : 0;

  // Time from submission (upload) to the stated review date, in days.
  const turnarounds = subs
    .filter((s) => s.review_date)
    .map((s) => {
      const ms = new Date(`${s.review_date}T00:00:00Z`).getTime() - new Date(s.created_at).getTime();
      return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 86_400_000)) : null;
    })
    .filter((d): d is number => d !== null);
  const avgDaysSubmissionToReview = turnarounds.length
    ? Math.round((turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length) * 10) / 10
    : 0;

  const openThreats = threats.filter((t) => !isClosedStatus(t.status));
  const ages = openThreats.map((t) => daysAgo(t.review_date || t.created_at));
  const avgOpenAgeingDays = ages.length ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10 : 0;
  const oldestOpenDays = ages.length ? Math.max(...ages) : 0;

  const submissions: ScorecardSubmission[] = subs.map((s) => ({
    id: s.id,
    projectName: s.project_name,
    reviewDate: s.review_date,
    submittedAt: s.created_at,
    threatCount: threatCountBySub.get(s.id) ?? 0,
    recoCount: recoCountBySub.get(s.id) ?? 0,
  }));

  const openItems: OpenItem[] = openThreats.map((t) => ({
    id: t.id,
    ref: t.threat_ref || `T-${t.id}`,
    title: t.title ?? "",
    projectName: t.project_name ?? "",
    status: t.status,
    risk: t.risk_level ?? "",
    daysOpen: daysAgo(t.review_date || t.created_at),
  }));

  return {
    reviewer: rev.name,
    role: rev.role,
    coveragePct,
    unmappedRatio,
    avgDaysSubmissionToReview,
    avgOpenAgeingDays,
    oldestOpenDays,
    threats: threats.length,
    recommendations: totalRecos,
    withResponse,
    withoutResponse: threats.length - withResponse,
    unmappedRecos: totalRecos - linkedRecos,
    openThreats: openThreats.length,
    submissions,
    openItems,
    generatedAt: nowIso,
  };
}

/**
 * Objective reviewer visibility metrics only — coverage, unmapped ratio,
 * review turnaround, ageing of open items. Framed as visibility, not
 * performance policing.
 *
 * With `?reviewer=<name>` returns a single Scorecard object; without it
 * returns `{ scorecards: [...] }` for every active reviewer.
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const reviewerFilter = sane(req.nextUrl.searchParams.get("reviewer"), 200);

    if (reviewerFilter) {
      const rev = get<ReviewerRow>(`SELECT * FROM reviewers WHERE name = ?`, reviewerFilter);
      if (!rev) {
        return NextResponse.json({ ok: false, error: "Reviewer not found." }, { status: 404 });
      }
      return NextResponse.json({ ok: true, data: buildScorecard(rev, new Date().toISOString()) });
    }

    const reviewers = all<ReviewerRow>(`SELECT * FROM reviewers WHERE active = 1 ORDER BY name ASC`);
    const nowIso = new Date().toISOString();
    const scorecards = reviewers.map((rev) => buildScorecard(rev, nowIso));
    return NextResponse.json({ ok: true, data: { scorecards } });
  } catch (e) {
    return handleError(e);
  }
}
