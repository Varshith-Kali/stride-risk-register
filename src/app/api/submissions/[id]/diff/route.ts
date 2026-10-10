import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { get } from "@/db";
import type { SubmissionRow, ThreatRow } from "@/db/schema";
import { queryThreats } from "@/lib/threat-views";
import { sane } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/** Identity key: threat_ref when present, otherwise the title (normalized). */
function threatKey(t: ThreatRow): string {
  const ref = (t.threat_ref ?? "").trim().toLowerCase();
  if (ref) return `ref:${ref}`;
  return `title:${(t.title ?? "").trim().toLowerCase()}`;
}

interface FieldDiff {
  field: string;
  from: string;
  to: string;
}

const COMPARED_FIELDS: Array<{ field: string; key: keyof ThreatRow }> = [
  { field: "title", key: "title" },
  { field: "description", key: "description" },
  { field: "stride", key: "stride_category" },
  { field: "risk", key: "risk_level" },
  { field: "component", key: "component" },
];

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const { id } = await context.params;
    if (!/^\d+$/.test(id)) return bad("Invalid submission id.");
    const compareToRaw = sane(req.nextUrl.searchParams.get("compareTo"), 20);
    if (!compareToRaw || !/^\d+$/.test(compareToRaw)) {
      return bad("compareTo query param (submission id) is required.");
    }

    const currentId = Number(id);
    const otherId = Number(compareToRaw);
    if (currentId === otherId) return bad("compareTo must differ from the submission id.");

    const current = get<SubmissionRow>(`SELECT * FROM submissions WHERE id = ?`, currentId);
    const other = get<SubmissionRow>(`SELECT * FROM submissions WHERE id = ?`, otherId);
    if (!current || !other) {
      return NextResponse.json({ ok: false, error: "Submission not found." }, { status: 404 });
    }
    if (current.project_id !== other.project_id) {
      return bad("Both submissions must belong to the same project to diff them.");
    }

    const currentThreats = queryThreats("t.submission_id = ?", currentId);
    const otherThreats = queryThreats("t.submission_id = ?", otherId);

    const otherByKey = new Map(otherThreats.map((t) => [threatKey(t), t]));
    const currentByKey = new Map(currentThreats.map((t) => [threatKey(t), t]));

    const added = currentThreats.filter((t) => !otherByKey.has(threatKey(t)));
    const removed = otherThreats.filter((t) => !currentByKey.has(threatKey(t)));

    const changed: Array<{ threat: ThreatRow; diffs: FieldDiff[] }> = [];
    for (const t of currentThreats) {
      const prev = otherByKey.get(threatKey(t));
      if (!prev) continue;
      const diffs: FieldDiff[] = [];
      for (const { field, key } of COMPARED_FIELDS) {
        const from = String(prev[key] ?? "");
        const to = String(t[key] ?? "");
        if (from !== to) diffs.push({ field, from, to });
      }
      if (diffs.length) changed.push({ threat: t, diffs });
    }

    return NextResponse.json({
      ok: true,
      data: {
        current: { id: current.id, version: current.version },
        compareTo: { id: other.id, version: other.version },
        added,
        removed,
        changed,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
