"use client";

/**
 * /reviewers — reviewer picker → scorecard (coverage %, unmapped ratio,
 * submission→review time, ageing), submissions list, open items table.
 * Framed as visibility, not performance policing.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Users, CalendarClock, FileStack, ShieldAlert } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import {
  useApi,
  PageHeader,
  LoadingState,
  ErrorState,
} from "@/components/view-helpers";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { riskColor } from "@/lib/risk";

// ─── Types (defensive — Agent C owns the routes) ─────────────────────────────

interface Reviewer {
  id: string | number;
  name: string;
  role?: string;
}

interface ScorecardSubmission {
  id: string | number;
  projectName?: string;
  reviewDate?: string;
  submittedAt?: string;
  threatCount?: number;
  recoCount?: number;
}

interface OpenItem {
  id: string | number;
  ref?: string;
  title?: string;
  projectName?: string;
  status?: string;
  risk?: string;
  daysOpen?: number;
}

interface Scorecard {
  reviewer?: string;
  coveragePct?: number;
  unmappedRatio?: number;
  avgDaysSubmissionToReview?: number;
  avgOpenAgeingDays?: number;
  submissions?: ScorecardSubmission[];
  openItems?: OpenItem[];
}

function pct(v: number | undefined): string {
  return typeof v === "number" ? `${Math.round(v)}%` : "Not provided";
}

function days(v: number | undefined): string {
  return typeof v === "number" ? `${v.toFixed(1)} days` : "Not provided";
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return "Not provided";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Not provided" : d.toLocaleDateString();
}

export default function ReviewersPage() {
  const reviewersRes = useApi<{ reviewers?: Reviewer[] }>("/api/reviewers");
  const reviewers = useMemo(
    () => reviewersRes.data?.reviewers ?? [],
    [reviewersRes.data],
  );
  const [selected, setSelected] = useState<string>("");

  const scorecardRes = useApi<Scorecard>(
    selected ? `/api/scorecard?reviewer=${encodeURIComponent(selected)}` : null,
  );
  const sc = scorecardRes.data;

  const openItems = useMemo(
    () =>
      [...(sc?.openItems ?? [])].sort(
        (a, b) => (b.daysOpen ?? 0) - (a.daysOpen ?? 0),
      ),
    [sc],
  );

  const statCards = sc
    ? [
        {
          label: "Coverage",
          value: pct(sc.coveragePct),
          hint: "threats with a reviewer response",
        },
        {
          label: "Unmapped ratio",
          value: pct(sc.unmappedRatio),
          hint: "recommendations matching no threat",
        },
        {
          label: "Submission → review",
          value: days(sc.avgDaysSubmissionToReview),
          hint: "average turnaround",
        },
        {
          label: "Open-item ageing",
          value: days(sc.avgOpenAgeingDays),
          hint: "average days open",
        },
      ]
    : [];

  return (
    <AppShell>
      <PageHeader
        eyebrow="Reviewer visibility"
        title="Reviewers"
        hint="Pick a reviewer to see their submissions, open items, ageing and coverage. These numbers exist for visibility across the portfolio — not for performance policing."
      />

      {reviewersRes.loading && <LoadingState rows={3} />}
      {reviewersRes.error && !reviewersRes.loading && (
        <ErrorState
          message={reviewersRes.error}
          onRetry={reviewersRes.reload}
        />
      )}

      {!reviewersRes.loading && !reviewersRes.error && (
        <>
          <div className="apple-card mb-6 flex flex-wrap items-center gap-3 p-4">
            <Users className="h-4 w-4 text-muted-foreground" />
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select a reviewer…" />
              </SelectTrigger>
              <SelectContent>
                {reviewers.map((r) => (
                  <SelectItem key={String(r.id)} value={r.name}>
                    {r.name}
                    {r.role ? ` · ${r.role}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!selected && (
            <EmptyState
              icon={Users}
              title="Select a reviewer"
              hint="Choose a reviewer above to load their scorecard, submissions and open items."
            />
          )}

          {selected && scorecardRes.loading && <LoadingState rows={4} />}
          {selected && scorecardRes.error && !scorecardRes.loading && (
            <ErrorState
              message={scorecardRes.error}
              onRetry={scorecardRes.reload}
            />
          )}

          {selected && !scorecardRes.loading && !scorecardRes.error && sc && (
            <div className="fade-in space-y-6">
              {/* Scorecard */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {statCards.map((s) => (
                  <Card key={s.label} className="apple-card">
                    <CardContent className="p-5">
                      <p className="text-eyebrow text-muted-foreground">
                        {s.label}
                      </p>
                      <p className="text-headline mt-1">{s.value}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {s.hint}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Submissions */}
              <section>
                <h2 className="text-title mb-3 flex items-center gap-2">
                  <FileStack className="h-4 w-4 text-muted-foreground" />
                  Submissions ({sc.submissions?.length ?? 0})
                </h2>
                {(sc.submissions ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No submissions recorded for this reviewer.
                  </p>
                ) : (
                  <div className="apple-card overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="px-4 py-3 font-medium">Project</th>
                          <th className="px-4 py-3 font-medium">Submitted</th>
                          <th className="px-4 py-3 font-medium">Reviewed</th>
                          <th className="px-4 py-3 font-medium">Threats</th>
                          <th className="px-4 py-3 font-medium">
                            Recommendations
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(sc.submissions ?? []).map((s) => (
                          <tr
                            key={String(s.id)}
                            className="border-b border-border last:border-0 hover:bg-muted/40"
                          >
                            <td className="px-4 py-3 font-medium">
                              {s.projectName || "Not provided"}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {fmtDate(s.submittedAt)}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {fmtDate(s.reviewDate)}
                            </td>
                            <td className="px-4 py-3">{s.threatCount ?? "—"}</td>
                            <td className="px-4 py-3">{s.recoCount ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Open items */}
              <section>
                <h2 className="text-title mb-3 flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                  Open items ({openItems.length})
                </h2>
                {openItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No open items — everything is resolved or closed.
                  </p>
                ) : (
                  <div className="apple-card overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="px-4 py-3 font-medium">Risk ID</th>
                          <th className="px-4 py-3 font-medium">Threat</th>
                          <th className="px-4 py-3 font-medium">Project</th>
                          <th className="px-4 py-3 font-medium">Severity</th>
                          <th className="px-4 py-3 font-medium">Status</th>
                          <th className="px-4 py-3 font-medium">Days open</th>
                        </tr>
                      </thead>
                      <tbody>
                        {openItems.map((item) => (
                          <tr
                            key={String(item.id)}
                            className="border-b border-border last:border-0 hover:bg-muted/40"
                          >
                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                              {item.ref || "—"}
                            </td>
                            <td className="max-w-72 truncate px-4 py-3">
                              {item.title || "Not provided"}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {item.projectName || "Not provided"}
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{
                                    backgroundColor: riskColor(item.risk),
                                  }}
                                />
                                {item.risk || "Not provided"}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge status={item.status} />
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={
                                  (item.daysOpen ?? 0) > 30
                                    ? "font-semibold text-amber-700"
                                    : ""
                                }
                              >
                                {item.daysOpen ?? "—"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5" />
                Scorecard metrics are computed from stored data only — nothing is
                inferred. See the{" "}
                <Link
                  href="/timeline"
                  className="underline hover:text-foreground"
                >
                  Timeline
                </Link>{" "}
                for the underlying events.
              </p>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
