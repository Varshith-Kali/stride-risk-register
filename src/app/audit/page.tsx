"use client";

/**
 * /audit — the governance audit log: who changed what, when and why, with an
 * entity filter. Submissions are the main recorded action under the
 * condensed-only model.
 */

import { useMemo, useState } from "react";
import { ScrollText } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
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

interface AuditEntry {
  id: string | number;
  at?: string;
  actor?: string;
  action?: string;
  entity?: string;
  entityId?: string | number;
  detail?: string;
}

const ENTITY_OPTIONS = ["all", "submission", "library"];

function fmtDateTime(iso: string | undefined): string {
  if (!iso) return "Not provided";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Not provided" : d.toLocaleString();
}

export default function AuditPage() {
  const [entity, setEntity] = useState("all");

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

  return (
    <AppShell>
      <PageHeader
        eyebrow="Governance"
        title="Audit"
        hint="Who changed what, when and why — every submission and library change is recorded here."
      />

      {/* Entity filter */}
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
          hint="Every submission and library change is recorded here."
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
