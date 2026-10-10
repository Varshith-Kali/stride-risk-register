import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, readJsonRequest, handleError } from "@/lib/api-utils";
import { get, run, transaction, audit, now } from "@/db";
import type { ThreatRow } from "@/db/schema";
import { queryThreats, enrichThreats } from "@/lib/threat-views";
import { toThreat } from "@/lib/serialize";
import { sane, isIsoDate, isThreatStatus } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

interface AcceptedRiskBody {
  justification?: unknown;
  approver?: unknown;
  expiryDate?: unknown;
}

interface ThreatPatchBody {
  status?: unknown;
  statusReason?: unknown;
  priorityOverride?: unknown;
  priorityOverrideReason?: unknown;
  changedBy?: unknown;
  acceptedRisk?: AcceptedRiskBody;
  // flat alternates for accepted-risk fields
  justification?: unknown;
  approver?: unknown;
  expiryDate?: unknown;
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const { id } = await context.params;
    if (!/^\d+$/.test(id)) return bad("Invalid threat id.");
    const threatId = Number(id);

    const parsed = await readJsonRequest<ThreatPatchBody>(req);
    if (!parsed.ok) return parsed.error;
    const body = parsed.data ?? {};

    const changedBy = sane(body.changedBy, 200);
    if (!changedBy) return bad("changedBy is required (who made this change?).");

    const existing = get<ThreatRow>(`SELECT * FROM threats WHERE id = ?`, threatId);
    if (!existing) {
      return NextResponse.json({ ok: false, error: "Threat not found." }, { status: 404 });
    }

    const status = body.status === undefined ? undefined : sane(body.status, 50);
    if (status !== undefined && !isThreatStatus(status)) {
      return bad("Invalid status. Must be one of: Open, In Progress, Mitigated, Accepted Risk, Deferred, Rejected/Not Applicable.");
    }

    // Reason attached to the status change (shown in the audit/status history).
    const statusReason = sane(body.statusReason, 2000);

    const hasOverrideKey = body.priorityOverride !== undefined && body.priorityOverride !== null;
    const priorityOverride = hasOverrideKey ? sane(body.priorityOverride, 100) : undefined;
    const priorityOverrideReason = sane(body.priorityOverrideReason, 2000);
    if (priorityOverride && !priorityOverrideReason) {
      return bad("priorityOverrideReason is required when setting a priority override.");
    }

    // Accepted Risk requires justification + approver + expiry date.
    let acceptedRisk: { justification: string; approver: string; expiryDate: string } | null = null;
    if (status === "Accepted Risk") {
      const src = (body.acceptedRisk ?? {}) as AcceptedRiskBody;
      const justification = sane(src.justification ?? body.justification, 5000);
      const approver = sane(src.approver ?? body.approver, 200);
      const expiryDate = sane(src.expiryDate ?? body.expiryDate, 10);
      if (!justification || !approver || !expiryDate) {
        return bad("Accepted Risk requires justification, approver and expiryDate.");
      }
      if (!isIsoDate(expiryDate)) return bad("expiryDate must be YYYY-MM-DD.");
      acceptedRisk = { justification, approver, expiryDate };
    }

    if (status === undefined && priorityOverride === undefined && !hasOverrideKey) {
      return bad("Nothing to update. Provide status and/or priorityOverride.");
    }

    transaction(() => {
      const sets: string[] = [];
      const params: (string | number | null)[] = [];
      if (status !== undefined) {
        sets.push("status = ?");
        params.push(status);
      }
      if (hasOverrideKey) {
        sets.push("priority_override = ?", "priority_override_reason = ?");
        params.push(priorityOverride || null, priorityOverride ? priorityOverrideReason : null);
      }
      if (sets.length) {
        run(`UPDATE threats SET ${sets.join(", ")} WHERE id = ?`, ...params, threatId);
      }

      if (status !== undefined && status !== existing.status) {
        run(
          `INSERT INTO status_history (threat_id, from_status, to_status, changed_by, reason, changed_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          threatId,
          existing.status,
          status,
          changedBy,
          statusReason || priorityOverrideReason || null,
          now()
        );
      }

      if (acceptedRisk) {
        run(
          `INSERT OR REPLACE INTO accepted_risks
             (threat_id, justification, approver, expiry_date, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          threatId,
          acceptedRisk.justification,
          acceptedRisk.approver,
          acceptedRisk.expiryDate,
          now()
        );
      }

      const detailParts: string[] = [];
      if (status !== undefined && status !== existing.status) {
        detailParts.push(
          `status ${existing.status} → ${status}` +
            (statusReason ? ` (reason: ${statusReason})` : "")
        );
      }
      if (hasOverrideKey) {
        detailParts.push(
          priorityOverride
            ? `priority override set to "${priorityOverride}" (reason: ${priorityOverrideReason})`
            : "priority override cleared"
        );
      }
      audit(changedBy, "threat.updated", "threat", threatId, detailParts.join("; ") || "no-op");
    });

    const updated = enrichThreats(queryThreats("t.id = ?", threatId))[0];
    return NextResponse.json({ ok: true, data: toThreat(updated) });
  } catch (e) {
    return handleError(e);
  }
}
