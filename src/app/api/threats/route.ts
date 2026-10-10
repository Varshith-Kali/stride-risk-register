import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { queryThreats, enrichThreats } from "@/lib/threat-views";
import { sane, isThreatStatus } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const q = req.nextUrl.searchParams;
    const submissionId = sane(q.get("submissionId"), 20);
    const projectId = sane(q.get("projectId"), 20);
    const status = sane(q.get("status"), 50);
    const risk = sane(q.get("risk"), 50);
    const stride = sane(q.get("stride"), 100);
    const search = sane(q.get("q"), 200);

    const where: string[] = [];
    const params: (string | number)[] = [];

    if (submissionId) {
      if (!/^\d+$/.test(submissionId)) {
        return NextResponse.json({ ok: false, error: "Invalid submissionId." }, { status: 400 });
      }
      where.push("t.submission_id = ?");
      params.push(Number(submissionId));
    }
    if (projectId) {
      if (!/^\d+$/.test(projectId)) {
        return NextResponse.json({ ok: false, error: "Invalid projectId." }, { status: 400 });
      }
      where.push("s.project_id = ?");
      params.push(Number(projectId));
    }
    if (status) {
      if (!isThreatStatus(status)) {
        return NextResponse.json({ ok: false, error: "Invalid status filter." }, { status: 400 });
      }
      where.push("t.status = ?");
      params.push(status);
    }
    if (risk) {
      where.push("t.risk_level = ?");
      params.push(risk);
    }
    if (stride) {
      where.push("t.stride_category = ?");
      params.push(stride);
    }
    if (search) {
      where.push(
        "(t.title LIKE ? OR t.description LIKE ? OR t.threat_ref LIKE ? OR t.component LIKE ?)"
      );
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    const threats = enrichThreats(queryThreats(where.length ? where.join(" AND ") : "1=1", ...params));
    return NextResponse.json({ ok: true, data: { threats } });
  } catch (e) {
    return handleError(e);
  }
}
