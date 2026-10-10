import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, readJsonRequest, handleError } from "@/lib/api-utils";
import { get, run, audit, now } from "@/db";
import type { LinkRow } from "@/db/schema";
import { sane, isLinkDecision } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

interface LinkPatchBody {
  decision?: unknown;
  decidedBy?: unknown;
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const { id } = await context.params;
    if (!/^\d+$/.test(id)) return bad("Invalid link id.");
    const linkId = Number(id);

    const parsed = await readJsonRequest<LinkPatchBody>(req);
    if (!parsed.ok) return parsed.error;
    const body = parsed.data ?? {};

    const decision = sane(body.decision, 20);
    if (!isLinkDecision(decision)) {
      return bad('decision must be "accepted" or "rejected".');
    }
    const decidedBy = sane(body.decidedBy, 200);
    if (!decidedBy) return bad("decidedBy is required (who made this decision?).");

    const existing = get<LinkRow>(`SELECT * FROM links WHERE id = ?`, linkId);
    if (!existing) {
      return NextResponse.json({ ok: false, error: "Link not found." }, { status: 404 });
    }

    run(
      `UPDATE links SET decision = ?, decided_by = ?, decided_at = ? WHERE id = ?`,
      decision,
      decidedBy,
      now(),
      linkId
    );
    audit(
      decidedBy,
      `link.${decision}`,
      "link",
      linkId,
      `threat #${existing.threat_id} ↔ recommendation #${existing.recommendation_id} ${decision} (was ${existing.decision})`
    );

    const updated = get<LinkRow>(`SELECT * FROM links WHERE id = ?`, linkId);
    return NextResponse.json({ ok: true, data: { link: updated } });
  } catch (e) {
    return handleError(e);
  }
}
