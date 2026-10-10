import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { get } from "@/db";
import type { SubmissionRow, ProjectRow, ReviewerRow } from "@/db/schema";
import { queryThreats, queryLinksForThreats, groupLinksByThreat } from "@/lib/threat-views";
import { writeWorkbook } from "@/core/ooxml-write";
import { sane, filenameSafe } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

const CELL_CAP = 8000;

function cell(v: unknown): string {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s.length > CELL_CAP ? s.slice(0, CELL_CAP) + "…" : s;
}

export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const idRaw = sane(req.nextUrl.searchParams.get("submissionId"), 20);
    if (!idRaw || !/^\d+$/.test(idRaw)) {
      return NextResponse.json({ ok: false, error: "submissionId query param is required." }, { status: 400 });
    }
    const submissionId = Number(idRaw);

    const submission = get<SubmissionRow>(`SELECT * FROM submissions WHERE id = ?`, submissionId);
    if (!submission) {
      return NextResponse.json({ ok: false, error: "Submission not found." }, { status: 404 });
    }
    const project = get<ProjectRow>(`SELECT * FROM projects WHERE id = ?`, submission.project_id);
    const reviewer = get<ReviewerRow>(`SELECT * FROM reviewers WHERE id = ?`, submission.reviewer_id);

    const threats = queryThreats("t.submission_id = ?", submissionId);
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
        cell(project?.name ?? ""),
        cell(t.title),
        cell(t.stride_category || "Not provided"),
        cell(t.component || "Not provided"),
        cell(t.risk_level || "Not provided"),
        cell(reviewer?.name ?? ""),
        cell(linkedRecos || "No Reviewer Response"),
        cell(t.status),
        cell(`${t.excel_sheet}:${t.excel_row}`),
        cell(t.rank_explanation || "Not provided"),
      ]);
    }

    const buf = writeWorkbook([{ name: "Risk Register", rows }]);
    const filename = `risk-register-${filenameSafe(project?.name ?? "project")}-v${submission.version}.xlsx`;

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
