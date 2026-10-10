import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { all, get } from "@/db";
import type { ProjectRow } from "@/db/schema";
import { latestSubmissionIds } from "@/lib/threat-views";

export const runtime = "nodejs";
export const maxDuration = 120;

const CRITICAL_HIGH = new Set(["Critical", "High"]);

interface VersionTrend {
  version: number;
  date: string;
  openCount: number;
  totalCount: number;
}

export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const projects = all<ProjectRow>(`SELECT * FROM projects ORDER BY name ASC`);
    const latestIds = new Set(latestSubmissionIds());

    const result = projects.map((p) => {
      const versions = all<{ id: number; version: number; review_date: string; reviewer_name: string }>(
        `SELECT s.id, s.version, s.review_date, r.name AS reviewer_name
         FROM submissions s
         JOIN reviewers r ON r.id = s.reviewer_id
         WHERE s.project_id = ?
         ORDER BY s.version ASC`,
        p.id
      );

      const threatRows = all<{
        submission_id: number;
        risk_level: string;
        status: string;
      }>(
        `SELECT t.submission_id, t.risk_level, t.status
         FROM threats t
         JOIN submissions s ON s.id = t.submission_id
         WHERE s.project_id = ?`,
        p.id
      );

      const latestThreats = threatRows.filter((t) => latestIds.has(t.submission_id));
      const openStatuses = (s: string) => !["Mitigated", "Accepted Risk", "Rejected/Not Applicable"].includes(s);

      const acceptedRisks = get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM accepted_risks ar
         JOIN threats t ON t.id = ar.threat_id
         JOIN submissions s ON s.id = t.submission_id
         WHERE s.project_id = ?`,
        p.id
      )?.c ?? 0;

      const trend: VersionTrend[] = versions.map((v) => {
        const vt = threatRows.filter((t) => t.submission_id === v.id);
        return {
          version: v.version,
          date: v.review_date,
          openCount: vt.filter((t) => openStatuses(t.status)).length,
          totalCount: vt.length,
        };
      });

      const lastVersion = versions[versions.length - 1];

      return {
        id: p.id,
        name: p.name,
        threatCount: latestThreats.length,
        criticalCount: latestThreats.filter((t) => t.risk_level === "Critical").length,
        highCount: latestThreats.filter((t) => t.risk_level === "High").length,
        criticalHigh: latestThreats.filter((t) => CRITICAL_HIGH.has(t.risk_level)).length,
        openCount: latestThreats.filter((t) => openStatuses(t.status)).length,
        acceptedRiskCount: acceptedRisks,
        lastReviewDate: lastVersion?.review_date ?? "",
        lastReviewer: lastVersion?.reviewer_name ?? "",
        versions: versions.length,
        trend,
      };
    });

    return NextResponse.json({ ok: true, data: { projects: result } });
  } catch (e) {
    return handleError(e);
  }
}
