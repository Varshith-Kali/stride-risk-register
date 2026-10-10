import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, readJsonRequest, handleError } from "@/lib/api-utils";
import { get, run, audit, now } from "@/db";
import type { ThreatRow, RecommendationRow } from "@/db/schema";
import { sane, isConfidence } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

interface LinkCreateBody {
  threatId?: unknown;
  recommendationId?: unknown;
  decidedBy?: unknown;
  confidence?: unknown;
  rationale?: unknown;
  quote?: unknown;
}

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const parsed = await readJsonRequest<LinkCreateBody>(req);
    if (!parsed.ok) return parsed.error;
    const body = parsed.data ?? {};

    const threatId = Number(body.threatId);
    const recommendationId = Number(body.recommendationId);
    if (!Number.isInteger(threatId) || threatId <= 0) return bad("threatId must be a positive integer.");
    if (!Number.isInteger(recommendationId) || recommendationId <= 0) {
      return bad("recommendationId must be a positive integer.");
    }

    const decidedBy = sane(body.decidedBy, 200);
    if (!decidedBy) return bad("decidedBy is required (who created this link?).");

    const confidence = body.confidence === undefined ? "Medium" : sane(body.confidence, 20);
    if (!isConfidence(confidence)) return bad("confidence must be High, Medium or Low.");

    const rationale = sane(body.rationale, 2000);
    const quote = sane(body.quote, 5000);

    const threat = get<ThreatRow>(`SELECT * FROM threats WHERE id = ?`, threatId);
    if (!threat) return NextResponse.json({ ok: false, error: "Threat not found." }, { status: 404 });
    const reco = get<RecommendationRow>(`SELECT * FROM recommendations WHERE id = ?`, recommendationId);
    if (!reco) {
      return NextResponse.json({ ok: false, error: "Recommendation not found." }, { status: 404 });
    }
    if (threat.submission_id !== reco.submission_id) {
      return bad("Threat and recommendation must belong to the same submission.");
    }

    let linkId: number;
    try {
      const { lastInsertRowid } = run(
        `INSERT INTO links
           (threat_id, recommendation_id, confidence, rationale, quote,
            source_label, decision, decided_by, decided_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'Reviewer-linked', 'accepted', ?, ?, ?)`,
        threatId,
        recommendationId,
        confidence,
        rationale,
        quote,
        decidedBy,
        now(),
        now()
      );
      linkId = Number(lastInsertRowid);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("UNIQUE")) {
        return NextResponse.json(
          { ok: false, error: "This threat–recommendation link already exists." },
          { status: 409 }
        );
      }
      throw e;
    }

    audit(
      decidedBy,
      "link.created",
      "link",
      linkId,
      `Reviewer-linked threat #${threatId} ("${threat.threat_ref || threat.title.slice(0, 60)}") ↔ recommendation #${recommendationId} (${confidence})`
    );

    const link = get(`SELECT * FROM links WHERE id = ?`, linkId);
    return NextResponse.json({ ok: true, data: { link } }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
