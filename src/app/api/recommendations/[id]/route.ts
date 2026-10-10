import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, readJsonRequest, handleError } from "@/lib/api-utils";
import { get, run, audit, now } from "@/db";
import type { RecommendationRow } from "@/db/schema";
import { sane, isRecoStatus } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

interface RecoPatchBody {
  status?: unknown;
  changedBy?: unknown;
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const { id } = await context.params;
    if (!/^\d+$/.test(id)) return bad("Invalid recommendation id.");
    const recoId = Number(id);

    const parsed = await readJsonRequest<RecoPatchBody>(req);
    if (!parsed.ok) return parsed.error;
    const body = parsed.data ?? {};

    const status = sane(body.status, 50);
    if (!isRecoStatus(status)) {
      return bad("Invalid status. Must be one of: Open, Pending, In Progress, Done, Implemented, Deferred, Rejected.");
    }
    const changedBy = sane(body.changedBy, 200) || "system";

    const existing = get<RecommendationRow>(`SELECT * FROM recommendations WHERE id = ?`, recoId);
    if (!existing) {
      return NextResponse.json({ ok: false, error: "Recommendation not found." }, { status: 404 });
    }
    if (existing.status === status) {
      return NextResponse.json({ ok: true, data: { recommendation: existing } });
    }

    run(`UPDATE recommendations SET status = ? WHERE id = ?`, status, recoId);
    audit(
      changedBy,
      "recommendation.status_changed",
      "recommendation",
      recoId,
      `status ${existing.status} → ${status}`
    );

    const updated = get<RecommendationRow>(`SELECT * FROM recommendations WHERE id = ?`, recoId);
    return NextResponse.json({ ok: true, data: { recommendation: updated } });
  } catch (e) {
    return handleError(e);
  }
}
