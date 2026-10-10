"use client";

/**
 * /audit — the governance report.
 *
 * Two read-only sections:
 *  1. Reviews: every condensed review across all reviewers in one clean table
 *     (reviewer, project, date, risk posture, threat/reco counts, AI summary),
 *     filterable by reviewer and exportable to CSV.
 *  2. Activity log: the audit_log of who changed what, when and why.
 */

import { useMemo, useState } from "react";
import { ScrollText, FileText, Download } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  useApi,
  PageHeader,
  LoadingState,
  ErrorState,
} from "@/components/view-helpers";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RISK_COLORS } from "@/lib/risk";
import type { ReportData, ReportRow } from "@/lib/dto";

interface AuditEntry {
  id: string | number;
  at?: string;
  actor?: string;
  action?: string;
  entity?: string;
  entityId?: string | number;
  detail?: string;
}

const ENTITY_OPTIONS = ["all", "submission"];

function fmtDateTime(iso: string | undefined): string {
  if (!iso) return "Not provided";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Not provided" : d.toLocaleString();
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

/** Compact C/H/M/L risk-posture cell for one review. */
function PostureCell({ row }: { row: ReportRow }) {
  const parts = [
    { label: "C", value: row.critical, level: "Critical" },
    { label: "H", value: row.high, level: "High" },
    { label: "M", value: row.medium, level: "Medium" },
    { label: "L", value: row.low, level: "Low" },
  ];
  return (
    <div className="flex items-center gap-1">
      {parts.map((p) => (
        <span
          key={p.label}
          title={`${p.level}: ${p.value}`}
          className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium"
          style={{
            backgroundColor: `${RISK_COLORS[p.level]}1a`,
            color: RISK_COLORS[p.level],
          }}
        >
          {p.label} {p.value}
        </span>
      ))}
    </div>
  );
}

const CSV_HEADERS = [
  "Reviewer", "Role", "Project", "Review date", "Version",
  "Critical", "High", "Medium", "Low", "Threats", "Recommendations",
  "AI", "Summary",
];

function csvEscape(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV from the (filtered) report rows and trigger a client download. */
function exportCsv(rows: ReportRow[]) {
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.reviewer, r.reviewerRole, r.project, r.reviewDate, r.version,
        r.critical, r.high, r.medium, r.low, r.threatCount, r.recoCount,
        r.aiGenerated ? "yes" : "no", r.headline,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stride-review-report-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
// CHUNK_PLACEHOLDER

export default function AuditPage() {
  const [reviewer, setReviewer] = useState("all");
  const [entity, setEntity] = useState("all");

  const report = useApi<ReportData>("/api/report");

  const auditUrl = useMemo(
    () =>
      entity === "all"
        ? "/api/audit?limit=200"
        : `/api/audit?entity=${encodeURIComponent(entity)}&limit=200`,
    [entity],
  );
  const auditApi = useApi<{ entries?: AuditEntry[] }>(auditUrl);

  const reportData = report.data;
  const allRows = reportData?.rows ?? [];
  const reviewers = reportData?.reviewers ?? [];
  const rows = useMemo(
    () =>
      reviewer === "all"
        ? allRows
        : allRows.filter((r) => r.reviewer === reviewer),
    [allRows, reviewer],
  );
  const entries = auditApi.data?.entries ?? [];

  return (
    <AppShell>
      <PageHeader
        eyebrow="Governance"
        title="Audit report"
        hint="Every condensed review across all reviewers in one place, plus the full change log — who reviewed what, when, and the risk they surfaced."
      />

      {/* ── Review report ─────────────────────────────────────────────── */}
      <section className="mb-10">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-title">Reviews</h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={reviewer} onValueChange={setReviewer}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Filter by reviewer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All reviewers</SelectItem>
                {reviewers.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportCsv(rows)}
              disabled={rows.length === 0}
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </div>
        {/* REPORT_BODY_PLACEHOLDER */}
        {report.loading && <LoadingState rows={6} />}
        {report.error && !report.loading && (
          <ErrorState message={report.error} onRetry={report.reload} />
        )}

        {!report.loading && !report.error && allRows.length === 0 && (
          <EmptyState
            icon={FileText}
            title="No reviews yet"
            hint="Condensed reviews appear here once reviewers submit them from the intake page."
          />
        )}

        {!report.loading && !report.error && allRows.length > 0 && (
          <>
            {reportData && (
              <p className="mb-3 text-xs text-muted-foreground">
                {rows.length} review{rows.length === 1 ? "" : "s"}
                {reviewer !== "all"
                  ? ` by ${reviewer}`
                  : ` across ${reportData.totals.reviewers} reviewer${reportData.totals.reviewers === 1 ? "" : "s"}`}
                {" · "}
                {reportData.totals.threatsReviewed} threats ·{" "}
                {reportData.totals.recommendations} recommendations reviewed
              </p>
            )}
            <div className="apple-card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Reviewer</th>
                    <th className="px-4 py-3 font-medium">Project</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Risk posture</th>
                    <th className="px-4 py-3 text-right font-medium">Threats</th>
                    <th className="px-4 py-3 text-right font-medium">Recs</th>
                    <th className="px-4 py-3 font-medium">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-border align-top last:border-0 hover:bg-muted/40"
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="font-medium">{r.reviewer}</span>
                        {r.reviewerRole && (
                          <span className="block text-xs text-muted-foreground">
                            {r.reviewerRole}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {r.project}
                        {r.version > 1 && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            v{r.version}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {fmtDate(r.reviewDate)}
                      </td>
                      <td className="px-4 py-3">
                        <PostureCell row={r} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {r.threatCount}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {r.recoCount}
                      </td>
                      <td className="max-w-md px-4 py-3 text-muted-foreground">
                        {r.headline ||
                          (r.aiGenerated ? (
                            "—"
                          ) : (
                            <span className="italic">No AI summary</span>
                          ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      {/* ACTIVITY_LOG_PLACEHOLDER */}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-title">Activity log</h2>
          </div>
          <div className="flex items-center gap-3">
            <Select value={entity} onValueChange={setEntity}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by entity" />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_OPTIONS.map((e) => (
                  <SelectItem key={e} value={e}>
                    {e === "all" ? "All entities" : e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {entries.length} entr{entries.length === 1 ? "y" : "ies"}
            </span>
          </div>
        </div>

        {auditApi.loading && <LoadingState rows={4} />}
        {auditApi.error && !auditApi.loading && (
          <ErrorState message={auditApi.error} onRetry={auditApi.reload} />
        )}

        {!auditApi.loading && !auditApi.error && entries.length === 0 && (
          <EmptyState
            icon={ScrollText}
            title="No audit entries"
            hint="Every submission is recorded here."
          />
        )}

        {!auditApi.loading && !auditApi.error && entries.length > 0 && (
          <div className="apple-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Actor</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Entity</th>
                  <th className="px-4 py-3 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={String(e.id)}
                    className="border-b border-border last:border-0 hover:bg-muted/40"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                      {fmtDateTime(e.at)}
                    </td>
                    <td className="px-4 py-3">{e.actor || "Not provided"}</td>
                    <td className="px-4 py-3 font-medium">
                      {e.action || "Not provided"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {e.entity || "—"}
                      {e.entityId ? ` #${e.entityId}` : ""}
                    </td>
                    <td className="max-w-md px-4 py-3 text-muted-foreground">
                      {e.detail || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
