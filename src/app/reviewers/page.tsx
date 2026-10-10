"use client";

/**
 * /reviewers — the reviewer scorecard across the whole platform.
 *
 * One call to GET /api/scorecard returns every active reviewer with their
 * number of reviews, total threats reviewed, recommendations, summed risk
 * posture and last activity. Framed as visibility, not performance policing.
 */

import { useMemo } from "react";
import { Users } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import {
  useApi,
  PageHeader,
  LoadingState,
  ErrorState,
} from "@/components/view-helpers";
import { RISK_COLORS } from "@/lib/risk";
import type { ReviewerScore, RiskPosture } from "@/lib/dto";

function fmtDate(iso: string | undefined): string {
  if (!iso) return "No activity yet";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "No activity yet" : d.toLocaleDateString();
}

function PostureChips({ posture }: { posture: RiskPosture }) {
  const parts: { label: string; value: number; level: string }[] = [
    { label: "C", value: posture.critical, level: "Critical" },
    { label: "H", value: posture.high, level: "High" },
    { label: "M", value: posture.medium, level: "Medium" },
    { label: "L", value: posture.low, level: "Low" },
  ];
  return (
    <div className="flex items-center gap-1.5">
      {parts.map((p) => (
        <span
          key={p.label}
          title={`${p.level}: ${p.value}`}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium"
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

export default function ReviewersPage() {
  const { data, loading, error, reload } = useApi<{
    scorecards?: ReviewerScore[];
  }>("/api/scorecard");

  const scorecards = useMemo(
    () =>
      [...(data?.scorecards ?? [])].sort((a, b) => b.reviews - a.reviews),
    [data],
  );

  return (
    <AppShell>
      <PageHeader
        eyebrow="Reviewer visibility"
        title="Reviewers"
        hint="Every reviewer and what they've contributed across the platform — reviews, threats reviewed, recommendations and the risk posture they've surfaced. For visibility across the portfolio, not performance policing."
      />

      {loading && <LoadingState rows={4} />}
      {error && !loading && <ErrorState message={error} onRetry={reload} />}

      {!loading && !error && scorecards.length === 0 && (
        <EmptyState
          icon={Users}
          title="No reviewers yet"
          hint="Reviewers appear here once they are on the roster and start submitting reviews."
        />
      )}

      {!loading && !error && scorecards.length > 0 && (
        <div className="apple-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Reviewer</th>
                <th className="px-4 py-3 font-medium">Reviews</th>
                <th className="px-4 py-3 font-medium">Threats reviewed</th>
                <th className="px-4 py-3 font-medium">Recommendations</th>
                <th className="px-4 py-3 font-medium">Risk posture</th>
                <th className="px-4 py-3 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {scorecards.map((s) => (
                <tr
                  key={String(s.id)}
                  className="border-b border-border last:border-0 hover:bg-muted/40"
                >
                  <td className="px-4 py-3">
                    <span className="font-medium">{s.name}</span>
                    {s.role && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {s.role}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium">{s.reviews}</td>
                  <td className="px-4 py-3">{s.threatsReviewed}</td>
                  <td className="px-4 py-3">{s.recommendations}</td>
                  <td className="px-4 py-3">
                    <PostureChips posture={s.riskPosture} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {fmtDate(s.lastActivity)}
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
