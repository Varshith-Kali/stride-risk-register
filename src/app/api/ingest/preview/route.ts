import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { get } from "@/db";
import { readWorkbook, OoxmlError } from "@/core/ooxml";
import { suggestMapping, fingerprint } from "@/core/columns";
import {
  MAX_FILE_BYTES,
  pickPrimarySheet,
  sampleRows,
} from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return bad("Could not read multipart form data.");
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return bad("No file uploaded. Attach an .xlsx threat-model export as 'file'.");
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      return bad("Invalid file type. Only .xlsx files are accepted.");
    }
    if (file.size <= 0) {
      return bad("The uploaded file is empty.");
    }
    if (file.size > MAX_FILE_BYTES) {
      return bad("File too large. Maximum size is 10 MiB.", 413);
    }

    const buf = Buffer.from(await file.arrayBuffer());

    let workbook;
    try {
      workbook = readWorkbook(buf);
    } catch (e) {
      if (e instanceof OoxmlError) return bad(e.message);
      return handleError(e);
    }

    const primary = pickPrimarySheet(workbook.sheets);
    if (!primary) {
      return bad("No readable sheet found: every sheet is empty or has no header row.");
    }

    const suggested = suggestMapping(primary.headers);
    const fp = fingerprint(primary.headers);
    const saved = get<{ mapping_json: string }>(
      `SELECT mapping_json FROM column_mappings WHERE fingerprint = ?`,
      fp
    );

    let savedMapping: unknown = null;
    if (saved) {
      try {
        savedMapping = JSON.parse(saved.mapping_json);
      } catch {
        savedMapping = null;
      }
    }

    const sheets = workbook.sheets.map((s) => ({
      name: s.name,
      headers: s.rows[0] ?? [],
      sampleRows: sampleRows((s.rows ?? []).slice(1), 5),
    }));

    return NextResponse.json({
      ok: true,
      data: {
        fingerprint: fp,
        sheets,
        suggestedMapping: suggested.mapping,
        mappingConfidence: suggested.confidence,
        mappingNotes: suggested.notes,
        savedMapping,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
