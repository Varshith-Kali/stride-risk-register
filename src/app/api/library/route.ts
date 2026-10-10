import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, readJsonRequest, handleError } from "@/lib/api-utils";
import { all, get, run, audit, now } from "@/db";
import type { LibraryRow } from "@/db/schema";
import { sane } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const q = sane(req.nextUrl.searchParams.get("q"), 200);
    const rows = q
      ? all<LibraryRow>(
          `SELECT * FROM recommendation_library WHERE text LIKE ? ORDER BY usage_count DESC, id DESC LIMIT 200`,
          `%${q}%`
        )
      : all<LibraryRow>(
          `SELECT * FROM recommendation_library ORDER BY usage_count DESC, id DESC LIMIT 200`
        );
    return NextResponse.json({ ok: true, data: { library: rows } });
  } catch (e) {
    return handleError(e);
  }
}

interface LibraryCreateBody {
  text?: unknown;
  category?: unknown;
  approvedBy?: unknown;
}

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const parsed = await readJsonRequest<LibraryCreateBody>(req);
    if (!parsed.ok) return parsed.error;
    const body = parsed.data ?? {};

    const text = sane(body.text, 20000);
    if (!text) return bad("text is required.");
    const category = sane(body.category, 200);
    const approvedBy = sane(body.approvedBy, 200);
    if (!approvedBy) return bad("approvedBy is required (who approved this entry?).");

    const { lastInsertRowid } = run(
      `INSERT INTO recommendation_library (text, category, approved_by, usage_count, created_at)
       VALUES (?, ?, ?, 0, ?)`,
      text,
      category,
      approvedBy,
      now()
    );
    const id = Number(lastInsertRowid);
    audit(approvedBy, "library.created", "library", id, `Approved by ${approvedBy}: "${text.slice(0, 120)}"`);

    const entry = get<LibraryRow>(`SELECT * FROM recommendation_library WHERE id = ?`, id);
    return NextResponse.json({ ok: true, data: { entry } }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const idRaw = sane(req.nextUrl.searchParams.get("id"), 20);
    if (!idRaw || !/^\d+$/.test(idRaw)) return bad("id query param is required.");
    const id = Number(idRaw);

    const existing = get<LibraryRow>(`SELECT * FROM recommendation_library WHERE id = ?`, id);
    if (!existing) {
      return NextResponse.json({ ok: false, error: "Library entry not found." }, { status: 404 });
    }
    run(`DELETE FROM recommendation_library WHERE id = ?`, id);
    audit("system", "library.deleted", "library", id, `Deleted: "${existing.text.slice(0, 120)}"`);
    return NextResponse.json({ ok: true, data: { deleted: true } });
  } catch (e) {
    return handleError(e);
  }
}
