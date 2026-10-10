"use client";

/**
 * /timeline — submission / review / status-change events grouped by month,
 * plus an ageing table (days open) sorted worst-first. Items open > 30 days
 * are highlighted.
 */

import { useMemo } from "react";
import {
  History,
  UploadCloud,
  ClipboardCheck,
  RefreshCcw,
  Hourglass,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import {
  useApi,
  PageHeader,
  LoadingState,
  ErrorState,
} from "@/components/view-helpers";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ─── Types (defensive — Agent C owns the route) ─────────────────────────────

interface TimelineEvent {
  id: string | number;
  type?: string; // "submission" | "review" | "status_change" | ...
  at?: string;
  actor?: string;
  title?: string;
  detail?: string;
  projectName?: string;
}

interface AgeingRow {
  threatId?: string | number;
  ref?: string;
  title?: string;
  projectName?: string;
  status?: string;
  daysOpen?: number;
}

const EVENT_ICON: Record<string, typeof UploadCloud> = {
  submission: UploadCloud,
  review: ClipboardCheck,
  status_change: RefreshCcw,
};

const EVENT_LABEL: Record<string, string> = {
  submission: "Submission",
  review: "Review",
  status_change: "Status change",
};

function monthKey(iso: string | undefined): string {
  if (!iso) return "Unknown date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown date";
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function fmtDateTime(iso: string | undefined): string {
  if (!iso) return "Not provided";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Not provided" : d.toLocaleString();
}

export default function TimelinePage() {
  const { data, loading, error, reload } = useApi<{
    events?: TimelineEvent[];
    ageing?: AgeingRow[];
  }>("/api/timeline");

  const events = useMemo(
    () =>
      [...(data?.events ?? [])].sort(
        (a, b) =>
          new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime(),
      ),
    [data],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const e of events) {
      const key = monthKey(e.at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return [...map.entries()];
  }, [events]);

  const ageing = useMemo(
    () =>
      [...(data?.ageing ?? [])].sort(
        (a, b) => (b.daysOpen ?? 0) - (a.daysOpen ?? 0),
      ),
    [data],
  );

  return (
    <AppShell>
      <PageHeader
        eyebrow="Governance trail"
        title="Timeline"
        hint="Submission, review and status-change events across the portfolio — with an ageing view showing how long each threat has been open."
      />

      {loading && <LoadingState rows={6} />}
      {error && !loading && <ErrorState message={error} onRetry={reload} />}

      {!loading && !error && events.length === 0 && (
        <EmptyState
          icon={History}
          title="No timeline events yet"
          hint="Events are recorded automatically when submissions are processed and statuses change."
        />
      )}

      {!loading && !error && events.length > 0 && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* Event timeline */}
          <section>
            <h2 className="text-title mb-4">Events</h2>
            <div className="space-y-6">
              {grouped.map(([month, monthEvents]) => (
                <div key={month}>
                  <p className="text-eyebrow mb-3 text-muted-foreground">
                    {month}
                  </p>
                  <ol className="relative space-y-4 border-l border-border pl-6">
                    {monthEvents.map((e) => {
                      const Icon = EVENT_ICON[e.type ?? ""] ?? History;
                      return (
                        <li key={String(e.id)} className="relative">
                          <span className="absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full bg-muted">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                          </span>
                          <div className="apple-card p-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="text-[10px]">
                                {EVENT_LABEL[e.type ?? ""] ?? e.type ?? "Event"}
                              </Badge>
                              {e.projectName && (
                                <span className="text-xs text-muted-foreground">
                                  {e.projectName}
                                </span>
                              )}
                            </div>
                            <p className="mt-1.5 text-sm font-medium">
                              {e.title || "Not provided"}
                            </p>
                            {e.detail && (
                              <p className="mt-1 text-sm text-muted-foreground">
                                {e.detail}
                              </p>
                            )}
                            <p className="mt-2 text-xs text-muted-foreground">
                              {e.actor ? `${e.actor} · ` : ""}
                              {fmtDateTime(e.at)}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </div>
          </section>

          {/* Ageing */}
          <section>
            <h2 className="text-title mb-4 flex items-center gap-2">
              <Hourglass className="h-4 w-4 text-muted-foreground" />
              Ageing — days open
            </h2>
            {ageing.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing is currently open.
              </p>
            ) : (
              <div className="apple-card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Threat</th>
                      <th className="px-4 py-3 font-medium">Project</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Days open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ageing.map((row, i) => {
                      const stale = (row.daysOpen ?? 0) > 30;
                      return (
                        <tr
                          key={String(row.threatId ?? i)}
                          className={cn(
                            "border-b border-border last:border-0 hover:bg-muted/40",
                            stale && "bg-amber-50/60",
                          )}
                        >
                          <td className="px-4 py-3">
                            <span className="mr-2 font-mono text-xs text-muted-foreground">
                              {row.ref || "—"}
                            </span>
                            <span className="font-medium">
                              {row.title || "Not provided"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {row.projectName || "Not provided"}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={row.status} />
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={cn(
                                stale &&
                                  "font-semibold text-amber-700",
                              )}
                            >
                              {row.daysOpen ?? "—"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Rows open longer than 30 days are highlighted. Ageing counts days
              since the review, using stored dates only.
            </p>
          </section>
        </div>
      )}
    </AppShell>
  );
}
