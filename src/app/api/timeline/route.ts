import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { all } from "@/db";
import { queryThreats } from "@/lib/threat-views";
import { daysBetween, isClosedStatus } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

interface TimelineEvent {
  id: string;
  type: "submission" | "review" | "status_change";
  at: string;
  actor: string;
  title: string;
  detail: string;
  projectName: string;
}

export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const subs = all<{
      id: number;
      project_name: string;
      reviewer_name: string;
      version: number;
      review_date: string;
      created_at: string;
    }>(
      `SELECT s.id, p.name AS project_name, r.name AS reviewer_name,
              s.version, s.review_date, s.created_at
       FROM submissions s
       JOIN projects p ON p.id = s.project_id
       JOIN reviewers r ON r.id = s.reviewer_id
       ORDER BY s.created_at DESC`
    );

    const events: TimelineEvent[] = [];
    for (const s of subs) {
      events.push({
        id: `sub-${s.id}`,
        at: s.created_at,
        type: "submission",
        title: `Submission v${s.version} uploaded`,
        detail: `${s.project_name} · reviewed by ${s.reviewer_name}`,
        actor: s.reviewer_name,
        projectName: s.project_name,
      });
      // A review event only when the review date differs from the upload date.
      if (
        s.review_date &&
        s.review_date.slice(0, 10) !== s.created_at.slice(0, 10)
      ) {
        events.push({
          id: `rev-${s.id}`,
          at: s.review_date,
          type: "review",
          title: `Review completed (v${s.version})`,
          detail: `${s.project_name} · reviewed by ${s.reviewer_name}`,
          actor: s.reviewer_name,
          projectName: s.project_name,
        });
      }
    }

    const changes = all<{
      id: number;
      threat_id: number;
      threat_title: string;
      from_status: string;
      to_status: string;
      changed_by: string;
      changed_at: string;
      reason: string | null;
      project_name: string;
      reviewer_name: string;
    }>(
      `SELECT h.id, h.threat_id, t.title AS threat_title, h.from_status, h.to_status,
              h.changed_by, h.changed_at, h.reason, p.name AS project_name, r.name AS reviewer_name
       FROM status_history h
       JOIN threats t ON t.id = h.threat_id
       JOIN submissions s ON s.id = t.submission_id
       JOIN projects p ON p.id = s.project_id
       JOIN reviewers r ON r.id = s.reviewer_id
       ORDER BY h.changed_at DESC
       LIMIT 500`
    );
    for (const c of changes) {
      const fromPart = c.from_status ? `${c.from_status} → ` : "";
      events.push({
        id: `status-${c.id}`,
        at: c.changed_at,
        type: "status_change",
        title: `"${c.threat_title.slice(0, 80)}" ${fromPart}${c.to_status}`,
        detail: c.reason ? `${c.reason}` : `Status set to ${c.to_status}`,
        actor: c.changed_by,
        projectName: c.project_name,
      });
    }

    events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

    const nowIso = new Date().toISOString();
    const ageing = queryThreats("t.status NOT IN ('Mitigated','Accepted Risk','Rejected/Not Applicable')")
      .filter((t) => !isClosedStatus(t.status))
      .map((t) => ({
        threatId: t.id,
        ref: t.threat_ref || `T-${t.id}`,
        title: t.title,
        projectName: t.project_name,
        status: t.status,
        daysOpen: daysBetween(t.review_date || t.created_at, nowIso),
      }))
      .sort((a, b) => b.daysOpen - a.daysOpen)
      .slice(0, 200);

    return NextResponse.json({ ok: true, data: { events: events.slice(0, 500), ageing } });
  } catch (e) {
    return handleError(e);
  }
}
