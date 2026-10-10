import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, handleError } from "@/lib/api-utils";
import { all, get, run, transaction, audit, now, getReviewerByName } from "@/db";
import type { ProjectRow, SubmissionRow } from "@/db/schema";
import { readWorkbook, OoxmlError } from "@/core/ooxml";
import { suggestMapping, fingerprint } from "@/core/columns";
import { parseThreats } from "@/core/excel";
import { parseRecommendations } from "@/core/recommendations";
import { rankThreats } from "@/core/ranking";
import type { ColumnMapping, ParsedThreat } from "@/core/types";
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

function validMapping(m: unknown): m is ColumnMapping {
  return (
    typeof m === "object" &&
    m !== null &&
    typeof (m as Record<string, unknown>).title === "string" &&
    (m as Record<string, unknown>).title !== "" &&
    typeof (m as Record<string, unknown>).stride === "string" &&
    typeof (m as Record<string, unknown>).risk === "string"
  );
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

    let mappingJson: unknown = null;
    const mappingRaw = form.get("mappingJson");
    if (typeof mappingRaw === "string" && mappingRaw.trim()) {
      try {
        mappingJson = JSON.parse(mappingRaw);
      } catch {
        return bad("mappingJson is not valid JSON.");
      }
      if (!validMapping(mappingJson)) {
        return bad("mappingJson must be an object with at least title, stride and risk header names.");
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

    // Parse every sheet; each sheet uses the confirmed mapping when provided,
    // otherwise its own suggested mapping (headers may differ across sheets).
    const primarySuggested = suggestMapping(primary.headers);
    const usedMapping: ColumnMapping = (mappingJson as ColumnMapping) ?? primarySuggested.mapping;
    const mappingSource = mappingJson ? "confirmed" : "suggested";

    const allThreats: ParsedThreat[] = [];
    const warnings: string[] = [];
    for (const sheet of workbook.sheets) {
      const headers = sheet.rows[0] ?? [];
      if (!headers.some((h) => h.trim() !== "")) continue;
      const mapping = mappingJson ? (mappingJson as ColumnMapping) : suggestMapping(headers).mapping;
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
            excel_fingerprint, version, mapping_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        project.id,
        reviewer.id,
        reviewDate,
        notes,
        filename,
        fp,
        version,
        JSON.stringify(usedMapping),
        now()
      );
      const submissionId = Number(lastInsertRowid);

      const insertThreat = `INSERT INTO threats
        (submission_id, excel_sheet, excel_row, threat_ref, title, description,
         stride_category, component, mitre, risk_level, existing_controls,
         safety_metrics, severity_score, status, rank_score, rank_explanation, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?, ?)`;
      validThreats.forEach((t, i) => {
        run(
          insertThreat,
          submissionId,
          sane(t.sheet, 200),
          t.row,
          sane(t.ref, 100),
          sane(t.title, 2000),
          sane(t.description, 20000),
          sane(t.stride, 100),
          sane(t.component, 500),
          JSON.stringify(Array.isArray(t.mitre) ? t.mitre : []),
          sane(t.risk, 100),
          sane(t.existingControls, 10000),
          sane(t.safetyMetrics, 10000),
          t.severityScore,
          ranks[i]?.score ?? null,
          sane(ranks[i]?.explanation ?? "", 2000),
          now()
        );
      });

      recos.forEach((r) => {
        run(
          `INSERT INTO recommendations
             (submission_id, reco_index, text, owner, priority, timeline, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'Open', ?)`,
          submissionId,
          r.index,
          sane(r.text, 20000),
          sane(r.owner, 200),
          sane(r.priority, 100),
          sane(r.timeline, 200),
          now()
        );
      });

      run(
        `INSERT OR REPLACE INTO column_mappings (fingerprint, mapping_json, created_at)
         VALUES (?, ?, ?)`,
        fp,
        JSON.stringify(usedMapping),
        now()
      );

      audit(
        reviewerName,
        "submission.created",
        "submission",
        submissionId,
        `v${version} of "${projectName}": ${validThreats.length} threats, ${recos.length} recommendations from ${filename}`
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
        mapping: usedMapping,
        mappingSource,
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
      threat_count: number;
      reco_count: number;
    }>(
      `SELECT s.*,
              p.name AS project_name, r.name AS reviewer_name,
              (SELECT COUNT(*) FROM threats t WHERE t.submission_id = s.id) AS threat_count,
              (SELECT COUNT(*) FROM recommendations rc WHERE rc.submission_id = s.id) AS reco_count
       FROM submissions s
       JOIN projects p ON p.id = s.project_id
       JOIN reviewers r ON r.id = s.reviewer_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY s.created_at DESC`,
      ...params
    );

    const submissions = rows.map((s) => ({
      id: s.id,
      projectName: s.project_name,
      reviewerName: s.reviewer_name,
      version: s.version,
      reviewDate: s.review_date,
      createdAt: s.created_at,
      notes: s.notes,
      excelFilename: s.excel_filename,
      threatCount: s.threat_count,
      recoCount: s.reco_count,
    }));

    return NextResponse.json({ ok: true, data: { submissions } });
  } catch (e) {
    return handleError(e);
  }
}
