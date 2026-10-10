import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { all } from "@/db";
import type { AuditLogRow } from "@/db/schema";
import { sane } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const q = req.nextUrl.searchParams;
    const entity = sane(q.get("entity"), 100);
    const limitRaw = sane(q.get("limit"), 10);

    let limit = 200;
    if (limitRaw) {
      const n = Number(limitRaw);
      if (!Number.isInteger(n) || n <= 0) {
        return NextResponse.json({ ok: false, error: "Invalid limit." }, { status: 400 });
      }
      limit = Math.min(n, 1000);
    }

    const rows = entity
      ? all<AuditLogRow>(`SELECT * FROM audit_log WHERE entity = ? ORDER BY id DESC LIMIT ?`, entity, limit)
      : all<AuditLogRow>(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ?`, limit);

    return NextResponse.json({ ok: true, data: { audit: rows } });
  } catch (e) {
    return handleError(e);
  }
}
