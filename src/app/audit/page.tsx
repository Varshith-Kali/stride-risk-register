"use client";

/**
 * /audit — audit log table with entity filter, plus one-click exports:
 * Excel register, evidence-pack JSON, and the printable executive report.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ScrollText, Download, FileSpreadsheet, FileJson } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import {
  useApi,
  PageHeader,
  LoadingState,
  ErrorState,
} from "@/components/view-helpers";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

interface AuditEntry {
  id: string | number;
  at?: string;
  actor?: string;
  action?: string;
  entity?: string;
  entityId?: string | number;
  detail?: string;
}

interface SubmissionOption {
  id: string | number;
  projectName?: string;
  reviewerName?: string;
  version?: number;
  reviewDate?: string;
}

const ENTITY_OPTIONS = [
  "all",
  "submission",
  "threat",
  "recommendation",
  "link",
  "status",
  "library",
];

function fmtDateTime(iso: string | undefined): string {
  if (!iso) return "Not provided";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Not provided" : d.toLocaleString();
}

function download(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function AuditPage() {
  const [entity, setEntity] = useState("all");
  const [submissionId, setSubmissionId] = useState<string>("");

  const auditUrl = useMemo(
    () =>
      entity === "all"
        ? "/api/audit?limit=200"
        : `/api/audit?entity=${encodeURIComponent(entity)}&limit=200`,
    [entity],
  );
  const { data, loading, error, reload } = useApi<{ entries?: AuditEntry[] }>(
    auditUrl,
  );
  const entries = data?.entries ?? [];

  const subsRes = useApi<{ submissions?: SubmissionOption[] }>(
    "/api/submissions",
  );
  const submissions = subsRes.data?.submissions ?? [];

  function exportRegister() {
    if (!submissionId) {
      toast.error("Select a submission first");
      return;
    }
    download(
      `/api/export/register?submissionId=${encodeURIComponent(submissionId)}`,
      `risk-register-${submissionId}.xlsx`,
    );
    toast.success("Excel register download started");
  }

  function exportAuditPack() {
    if (!submissionId) {
      toast.error("Select a submission first");
      return;
    }
    download(
      `/api/export/audit-pack?submissionId=${encodeURIComponent(submissionId)}`,
      `audit-pack-${submissionId}.json`,
    );
    toast.success("Evidence pack download started");
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Governance"
        title="Audit & exports"
        hint="Who changed what, when and why — plus the evidence exports: the Excel register, the audit pack, and the printable executive report."
      />

      {/* Exports */}
      <div className="apple-card mb-6 p-5">
        <p className="text-eyebrow mb-4 text-muted-foreground">
          Exports — pick a submission
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64">
            <Label htmlFor="audit-submission">Submission</Label>
            <Select value={submissionId} onValueChange={setSubmissionId}>
              <SelectTrigger id="audit-submission" className="mt-1.5">
                <SelectValue placeholder="Select a submission…" />
              </SelectTrigger>
              <SelectContent>
                {submissions.map((s) => (
                  <SelectItem key={String(s.id)} value={String(s.id)}>
                    {s.projectName || "Untitled"}
                    {typeof s.version === "number" ? ` · v${s.version}` : ""}
                    {s.reviewerName ? ` · ${s.reviewerName}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            className="rounded-full"
            onClick={exportRegister}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Excel register
          </Button>
          <Button
            variant="outline"
            className="rounded-full"
            onClick={exportAuditPack}
          >
            <FileJson className="h-4 w-4" />
            Evidence pack (JSON)
          </Button>
          {submissionId ? (
            <Button asChild variant="outline" className="rounded-full">
              <Link href={`/report/${submissionId}`}>
                <Download className="h-4 w-4" />
                Printable report
              </Link>
            </Button>
          ) : (
            <Button variant="outline" className="rounded-full" disabled>
              <Download className="h-4 w-4" />
              Printable report
            </Button>
          )}
        </div>
        {!subsRes.loading && submissions.length === 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            No submissions yet — exports will be available once a submission is
            processed.
          </p>
        )}
      </div>

      <Separator className="mb-6" />

      {/* Audit log */}
      <div className="apple-card mb-4 flex flex-wrap items-center gap-3 p-4">
        <ScrollText className="h-4 w-4 text-muted-foreground" />
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

      {loading && <LoadingState rows={6} />}
      {error && !loading && <ErrorState message={error} onRetry={reload} />}

      {!loading && !error && entries.length === 0 && (
        <EmptyState
          icon={ScrollText}
          title="No audit entries"
          hint="Every submission, status change, link decision and override is recorded here."
        />
      )}

      {!loading && !error && entries.length > 0 && (
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
    </AppShell>
  );
}
