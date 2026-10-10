import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { all, get, run, transaction, audit, now, getReviewerByName } from "@/db";
import type { ProjectRow, SubmissionRow } from "@/db/schema";
import { readWorkbook, OoxmlError } from "@/core/ooxml";
import { suggestMapping, fingerprint } from "@/core/columns";
import { parseThreats } from "@/core/excel";
import { parseRecommendations } from "@/core/recommendations";
import { rankThreats } from "@/core/ranking";
import {
  buildCondensedReview,
  selectCondenseThreats,
  selectCondenseRecos,
  parseCondensedReview,
} from "@/core/condense";
import { condenseReview } from "@/llm/condense";
import { validateConfig } from "@/lib/llm-config";
import type { LlmConfig } from "@/lib/llm-config";
import type { ColumnMapping, ParsedThreat, CondensedReview } from "@/core/types";
import {
  MAX_FILE_BYTES,
  sane,
  todayIso,
  isIsoDate,
  pickPrimarySheet,
} from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 120;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function ensureProject(name: string): ProjectRow {
  const existing = get<ProjectRow>(`SELECT * FROM projects WHERE name = ?`, name);
  if (existing) return existing;
  const { lastInsertRowid } = run(
    `INSERT INTO projects (name, created_at) VALUES (?, ?)`,
    name,
    now()
  );
  const row = get<ProjectRow>(`SELECT * FROM projects WHERE id = ?`, Number(lastInsertRowid));
  if (!row) throw new Error("Failed to create project");
  return row;
}

export async function POST(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  // Next.js truncates request bodies over ~10 MiB before we see them, which
  // makes formData() throw a generic error. Check Content-Length first so
  // oversized uploads get an accurate 413 instead of a confusing message.
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_FILE_BYTES + 1024 * 1024) {
    return bad("File too large. Maximum size is 10 MiB.", 413);
  }
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
    if (file.size <= 0) return bad("The uploaded file is empty.");
    if (file.size > MAX_FILE_BYTES) return bad("File too large. Maximum size is 10 MiB.", 413);

    const projectName = sane(form.get("projectName"), 200);
    if (!projectName) return bad("projectName is required.");
    const reviewerName = sane(form.get("reviewerName"), 200);
    if (!reviewerName) return bad("reviewerName is required (select a reviewer).");

    const rawReviewDate = sane(form.get("reviewDate"), 10);
    const reviewDate = rawReviewDate || todayIso();
    if (!isIsoDate(reviewDate)) {
      return bad("reviewDate must be YYYY-MM-DD.");
    }

    const notes = sane(form.get("notes"), 5000);
    const recommendationsText = sane(form.get("recommendationsText"), 200_000);

    // Optional AI config (apiKey + model). Carried only in this request body;
    // never persisted. Absent/invalid → deterministic-only review (no narrative).
    let aiConfig: LlmConfig | null = null;
    const configRaw = form.get("config");
    if (typeof configRaw === "string" && configRaw.trim()) {
      try {
        aiConfig = validateConfig(JSON.parse(configRaw));
      } catch {
        aiConfig = null;
      }
    }

    const buf = Buffer.from(await file.arrayBuffer());
    let workbook;
    try {
      workbook = await readWorkbook(buf);
    } catch (e) {
      if (e instanceof OoxmlError) return bad(e.message);
      return handleError(e);
    }

    const primary = pickPrimarySheet(workbook.sheets);
    if (!primary) {
      return bad("No readable sheet found: every sheet is empty or has no header row.");
    }

    // Columns are auto-detected: the STRIDE template is consistent, so each
    // sheet uses its own suggested mapping (no column-mapping step).
    const primarySuggested = suggestMapping(primary.headers);
    const usedMapping: ColumnMapping = primarySuggested.mapping;

    const allThreats: ParsedThreat[] = [];
    const warnings: string[] = [];
    for (const sheet of workbook.sheets) {
      const headers = sheet.rows[0] ?? [];
      if (!headers.some((h) => h.trim() !== "")) continue;
      const mapping = suggestMapping(headers).mapping;
      const parsed = parseThreats([{ name: sheet.name, rows: sheet.rows }], mapping);
      // A sheet that yields no titled threats under this mapping is not a
      // threat table (e.g. a cover/"Notes" sheet). Skip it silently instead of
      // surfacing a "column not found" / "empty title" warning for every row —
      // that noise is what made a normal upload look broken.
      const titled = parsed.threats.filter((t) => t.title.trim() !== "");
      if (titled.length === 0) continue;
      allThreats.push(...parsed.threats);
      for (const w of parsed.warnings) warnings.push(`${sheet.name}: ${w}`);
    }

    if (!allThreats.length) {
      return bad("No threats were parsed from this file. Check the column mapping and try again.");
    }

    // Drop rows with no threat title (blank rows, notes sheets, totals rows).
    // They are warned about, never stored — an empty title is not a threat.
    const validThreats = allThreats.filter((t) => t.title.trim() !== "");
    const droppedEmpty = allThreats.length - validThreats.length;
    if (droppedEmpty > 0) {
      warnings.push(
        `${droppedEmpty} row(s) with no threat title were skipped (blank rows or non-threat sheets).`
      );
    }
    if (!validThreats.length) {
      return bad("No threats were parsed from this file. Check the column mapping and try again.");
    }

    const recos = parseRecommendations(recommendationsText);
    const ranks = rankThreats(validThreats);
    const fp = fingerprint(primary.headers);
    const filename = sane(file.name, 255);

    // Reviewer must be on the active roster (config/reviewers.yaml) —
    // no auto-creation: every submission is attributed to a known reviewer.
    const reviewer = getReviewerByName(reviewerName);
    if (!reviewer || reviewer.active !== 1) {
      return bad(
        "Unknown or inactive reviewer. Select a reviewer from the roster."
      );
    }

    // The single AI call: condense the review's threats + recommendations into
    // a grounded narrative. Deterministic posture/counts are computed in code
    // regardless. No key (or an AI failure) → deterministic-only record; the
    // review still exists, it just carries no narrative. AI never blocks.
    let narrative: {
      headline: string;
      observations: string[];
      keyRecommendations: string[];
    } | null = null;
    if (aiConfig) {
      try {
        narrative = await condenseReview(
          aiConfig,
          selectCondenseThreats(validThreats, ranks),
          selectCondenseRecos(recos)
        );
      } catch {
        narrative = null;
        warnings.push(
          "AI could not condense this review; stored the deterministic risk posture only. Check the API key and re-submit to generate observations."
        );
      }
    }

    const condensed: CondensedReview = buildCondensedReview(
      validThreats,
      ranks,
      recos,
      narrative
    );

    const result = transaction(() => {
      const project = ensureProject(projectName);
      const row = get<{ v: number }>(
        `SELECT COALESCE(MAX(version), 0) AS v FROM submissions WHERE project_id = ?`,
        project.id
      );
      const version = (row?.v ?? 0) + 1;

      const { lastInsertRowid } = run(
        `INSERT INTO submissions
           (project_id, reviewer_id, review_date, notes, excel_filename,
            excel_fingerprint, version, mapping_json, condensed_review_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        project.id,
        reviewer.id,
        reviewDate,
        notes,
        filename,
        fp,
        version,
        JSON.stringify(usedMapping),
        JSON.stringify(condensed),
        now()
      );
      const submissionId = Number(lastInsertRowid);

      // Raw per-threat/per-reco rows are intentionally NOT persisted — only the
      // condensed review is stored (there will be thousands of reviews).

      audit(
        reviewerName,
        "submission.created",
        "submission",
        submissionId,
        `v${version} of "${projectName}": ${validThreats.length} threats, ${recos.length} recommendations condensed from ${filename}`
      );

      return { submissionId, version, projectId: project.id, reviewerId: reviewer.id };
    });

    return NextResponse.json({
      ok: true,
      data: {
        submissionId: result.submissionId,
        version: result.version,
        threatCount: validThreats.length,
        recoCount: recos.length,
        aiGenerated: condensed.aiGenerated,
        warnings,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req);
  if (rl) return rl;
  try {
    const q = req.nextUrl.searchParams;
    const projectFilter = sane(q.get("project"), 200);
    const reviewerFilter = sane(q.get("reviewer"), 200);

    const where: string[] = [];
    const params: (string | number)[] = [];
    if (projectFilter) {
      if (/^\d+$/.test(projectFilter)) {
        where.push("s.project_id = ?");
        params.push(Number(projectFilter));
      } else {
        where.push("p.name = ?");
        params.push(projectFilter);
      }
    }
    if (reviewerFilter) {
      if (/^\d+$/.test(reviewerFilter)) {
        where.push("s.reviewer_id = ?");
        params.push(Number(reviewerFilter));
      } else {
        where.push("r.name = ?");
        params.push(reviewerFilter);
      }
    }

    const rows = all<SubmissionRow & {
      project_name: string;
      reviewer_name: string;
    }>(
      `SELECT s.*,
              p.name AS project_name, r.name AS reviewer_name
       FROM submissions s
       JOIN projects p ON p.id = s.project_id
       JOIN reviewers r ON r.id = s.reviewer_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY s.created_at DESC`,
      ...params
    );

    const submissions = rows.map((s) => {
      const condensed = parseCondensedReview(s.condensed_review_json);
      return {
        id: s.id,
        projectName: s.project_name,
        reviewerName: s.reviewer_name,
        version: s.version,
        reviewDate: s.review_date,
        createdAt: s.created_at,
        notes: s.notes,
        excelFilename: s.excel_filename,
        threatCount: condensed.threatCount,
        recoCount: condensed.recoCount,
        aiGenerated: condensed.aiGenerated,
      };
    });

    return NextResponse.json({ ok: true, data: { submissions } });
  } catch (e) {
    return handleError(e);
  }
}
