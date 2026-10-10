import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, readJsonRequest, handleError } from "@/lib/api-utils";
import { get, run, audit, now } from "@/db";
import type { LibraryRow } from "@/db/schema";
import { sane } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

interface LibraryPatchBody {
  usage_count?: unknown;
  text?: unknown;
  category?: unknown;
  changedBy?: unknown;
}

/**
 * PATCH /api/library/[id]
 * - `{ usage_count: <n> }` increments usage (pass any number, or omit for +1).
 * - `{ text }` / `{ category }` edits the entry text or category.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const { id } = await context.params;
    if (!/^\d+$/.test(id)) return bad("Invalid library id.");
    const entryId = Number(id);

    const parsed = await readJsonRequest<LibraryPatchBody>(req);
    if (!parsed.ok) return parsed.error;
    const body = parsed.data ?? {};

    const existing = get<LibraryRow>(`SELECT * FROM recommendation_library WHERE id = ?`, entryId);
    if (!existing) {
      return NextResponse.json({ ok: false, error: "Library entry not found." }, { status: 404 });
    }

    const changedBy = sane(body.changedBy, 200) || "system";
    const sets: string[] = [];
    const params: (string | number)[] = [];
    const notes: string[] = [];

    if (body.usage_count !== undefined) {
      const increment = Number(body.usage_count);
      const delta = Number.isFinite(increment) && increment > 0 ? Math.floor(increment) : 1;
      sets.push("usage_count = usage_count + ?");
      params.push(delta);
      notes.push(`usage +${delta}`);
    }
    if (body.text !== undefined) {
      const text = sane(body.text, 20000);
      if (!text) return bad("text must not be empty.");
      sets.push("text = ?");
      params.push(text);
      notes.push("text edited");
    }
    if (body.category !== undefined) {
      const category = sane(body.category, 200);
      sets.push("category = ?");
      params.push(category);
      notes.push(`category → "${category}"`);
    }
    if (!sets.length) return bad("Nothing to update. Provide usage_count, text and/or category.");

    run(`UPDATE recommendation_library SET ${sets.join(", ")} WHERE id = ?`, ...params, entryId);
    audit(changedBy, "library.updated", "library", entryId, notes.join("; "));

    const updated = get<LibraryRow>(`SELECT * FROM recommendation_library WHERE id = ?`, entryId);
    return NextResponse.json({ ok: true, data: { entry: updated } });
  } catch (e) {
    return handleError(e);
  }
}
