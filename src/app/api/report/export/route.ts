import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { all } from "@/db";
import type { SubmissionRow } from "@/db/schema";
import { parseCondensedReview } from "@/core/condense";
import { buildXlsx, type XlsxCell } from "@/core/xlsx-write";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/report/export — the governance review report as a clean .xlsx.
 *
 * One worksheet, one row per condensed review across all reviewers (optionally
 * filtered to a single reviewer via `?reviewer=`), with a bold frozen header.
 * Numeric columns are written as real numbers so Excel can sort/sum them.
 * Mirrors the on-screen Audit report table — same columns, same order.
 */

const HEADERS = [
  "Reviewer",
  "Role",
  "Project",
  "Review date",
  "Version",
  "Critical",
  "High",
  "Medium",
  "Low",
  "Threats",
  "Recommendations",
  "AI generated",
  "Summary",
];

const COLUMN_WIDTHS = [22, 20, 22, 14, 9, 9, 8, 9, 7, 9, 16, 13, 80];

export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const reviewerFilter = req.nextUrl.searchParams.get("reviewer");

    const rows = all<
      SubmissionRow & {
        project_name: string;
        reviewer_name: string;
        reviewer_role: string;
      }
    >(
      `SELECT s.*, p.name AS project_name,
              r.name AS reviewer_name, r.role AS reviewer_role
       FROM submissions s
       JOIN projects p ON p.id = s.project_id
       JOIN reviewers r ON r.id = s.reviewer_id
       ORDER BY s.created_at DESC`
    );

    const dataRows: XlsxCell[][] = [];
    for (const s of rows) {
      if (reviewerFilter && reviewerFilter !== "all" && s.reviewer_name !== reviewerFilter) {
        continue;
      }
      const c = parseCondensedReview(s.condensed_review_json);
      dataRows.push([
        s.reviewer_name,
        s.reviewer_role ?? "",
        s.project_name,
        s.review_date ?? "",
        s.version,
        c.riskPosture.critical,
        c.riskPosture.high,
        c.riskPosture.medium,
        c.riskPosture.low,
        c.threatCount,
        c.recoCount,
        c.aiGenerated ? "Yes" : "No",
        c.headline ?? "",
      ]);
    }

    const workbook = buildXlsx({
      sheetName: "Reviews",
      headers: HEADERS,
      rows: dataRows,
      columnWidths: COLUMN_WIDTHS,
    });

    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(workbook), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="stride-review-report-${date}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
