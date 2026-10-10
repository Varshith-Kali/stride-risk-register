import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { get } from "@/db";
import type { SubmissionRow, ProjectRow } from "@/db/schema";
import {
  queryThreats,
  queryLinksForThreats,
  groupLinksByThreat,
  latestSubmissionIds,
  type ThreatListRow,
} from "@/lib/threat-views";
import { writeWorkbook } from "@/core/ooxml-write";
import { sane, filenameSafe, isThreatStatus } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

const CELL_CAP = 8000;
const RISK_LEVELS = new Set(["Critical", "High", "Medium", "Low"]);

function cell(v: unknown): string {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s.length > CELL_CAP ? s.slice(0, CELL_CAP) + "…" : s;
}

/**
 * Excel export of the risk register. Two modes:
 *  - `?submissionId=` scopes to a single submission (used by the audit page).
 *  - otherwise exports the current posture (latest version per project)
 *    with optional `?status=&risk=&stride=&q=&projectId=` filters (used by
 *    the register page's "Export Excel" button, which carries its filters).
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const sp = req.nextUrl.searchParams;
    const idRaw = sane(sp.get("submissionId"), 20);

    let threats: ThreatListRow[];
    let filenameBase: string;
    let versionSuffix = "";

    if (idRaw) {
      if (!/^\d+$/.test(idRaw)) {
        return NextResponse.json({ ok: false, error: "Invalid submissionId." }, { status: 400 });
      }
      const submissionId = Number(idRaw);
      const submission = get<SubmissionRow>(`SELECT * FROM submissions WHERE id = ?`, submissionId);
      if (!submission) {
        return NextResponse.json({ ok: false, error: "Submission not found." }, { status: 404 });
      }
      const project = get<ProjectRow>(`SELECT * FROM projects WHERE id = ?`, submission.project_id);
      threats = queryThreats("t.submission_id = ?", submissionId);
      filenameBase = filenameSafe(project?.name ?? "project");
      versionSuffix = `-v${submission.version}`;
    } else {
      // Current posture across all projects (or one project), with filters.
      const projectIdRaw = sane(sp.get("projectId"), 20);
      const projectId = projectIdRaw && /^\d+$/.test(projectIdRaw) ? Number(projectIdRaw) : undefined;
      const submissionIds = latestSubmissionIds(projectId);

      if (!submissionIds.length) {
        threats = [];
      } else {
        const clauses = [`t.submission_id IN (${submissionIds.map(() => "?").join(",")})`];
        const params: (string | number)[] = [...submissionIds];

        const status = sane(sp.get("status"), 50);
        if (status && isThreatStatus(status)) {
          clauses.push("t.status = ?");
          params.push(status);
        }
        const risk = sane(sp.get("risk"), 50);
        if (risk && RISK_LEVELS.has(risk)) {
          clauses.push("t.risk_level = ?");
          params.push(risk);
        }
        const stride = sane(sp.get("stride"), 100);
        if (stride) {
          clauses.push("t.stride_category = ?");
          params.push(stride);
        }
        const q = sane(sp.get("q"), 200);
        if (q) {
          clauses.push("(t.title LIKE ? OR t.component LIKE ? OR t.threat_ref LIKE ?)");
          params.push(`%${q}%`, `%${q}%`, `%${q}%`);
        }

        threats = queryThreats(clauses.join(" AND "), ...params);
      }
      filenameBase = projectId ? filenameSafe(threats[0]?.project_name ?? "project") : "portfolio";
    }

    const linksByThreat = groupLinksByThreat(queryLinksForThreats(threats.map((t) => t.id)));

    const header = [
      "Risk ID",
      "Project",
      "Threat",
      "STRIDE",
      "Component",
      "Risk Level",
      "Reviewer",
      "Linked Recommendations",
      "Status",
      "Source (sheet:row)",
      "Rank explanation",
    ];

    const rows: string[][] = [header];
    for (const t of threats) {
      const accepted = (linksByThreat.get(t.id) ?? []).filter((l) => l.decision === "accepted");
      const linkedRecos = accepted
        .map((l, i) => `[${i + 1}] ${l.reco_text} (${l.confidence})`)
        .join("\n");
      rows.push([
        cell(t.threat_ref || `T-${t.id}`),
        cell(t.project_name ?? ""),
        cell(t.title),
        cell(t.stride_category || "Not provided"),
        cell(t.component || "Not provided"),
        cell(t.risk_level || "Not provided"),
        cell(t.reviewer_name ?? ""),
        cell(linkedRecos || "No Reviewer Response"),
        cell(t.status),
        cell(`${t.excel_sheet}:${t.excel_row}`),
        cell(t.rank_explanation || "Not provided"),
      ]);
    }

    const buf = writeWorkbook([{ name: "Risk Register", rows }]);
    const filename = `risk-register-${filenameBase}${versionSuffix}.xlsx`;

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buf.length),
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
