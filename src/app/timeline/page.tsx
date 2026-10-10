"use client";

/**
 * /timeline — stock-market-style time series of platform activity.
 *
 * One call to GET /api/timeline returns per-day review/recommendation counts
 * with a running cumulative total across every reviewer. The main chart is the
 * cumulative "stock chart"; a secondary chart shows per-day submissions, and a
 * breakdown lists reviews per reviewer.
 */

import { useMemo } from "react";
import { Activity, TrendingUp, Users } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import {
  useApi,
  PageHeader,
  LoadingState,
  ErrorState,
} from "@/components/view-helpers";
import { CHART_COLORS } from "@/lib/risk";
import type { TimelineData } from "@/lib/dto";

const REVIEWS_COLOR = "#2b2b2b";
const RECOS_COLOR = "#808080";

const chartTooltipStyle = {
  backgroundColor: "#fff",
  border: "1px solid oklch(0.92 0 0)",
  borderRadius: "12px",
  fontSize: "12px",
};

function fmtDay(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function normalize(raw: Partial<TimelineData> | null): TimelineData {
  return {
    points: Array.isArray(raw?.points) ? raw.points : [],
    reviewers: Array.isArray(raw?.reviewers) ? raw.reviewers : [],
    totals: {
      reviews: raw?.totals?.reviews ?? 0,
      recommendations: raw?.totals?.recommendations ?? 0,
    },
  };
}

// PAGE_MARKER

export default function TimelinePage() {
  const { data, loading, error, reload } =
    useApi<Partial<TimelineData>>("/api/timeline");

  const td = useMemo(() => normalize(data ?? null), [data]);
  const maxReviewer = Math.max(1, ...td.reviewers.map((r) => r.reviews));

  const statCards = [
    {
      label: "Total reviews",
      value: td.totals.reviews,
      icon: <Activity className="h-4 w-4" />,
    },
    {
      label: "Total recommendations",
      value: td.totals.recommendations,
      icon: <TrendingUp className="h-4 w-4" />,
    },
    {
      label: "Reviewers",
      value: td.reviewers.length,
      icon: <Users className="h-4 w-4" />,
    },
  ];

  return (
    <AppShell>
      <PageHeader
        eyebrow="Platform activity"
        title="Timeline"
        hint="Reviews and recommendations submitted across all reviewers over time — a running view of how the platform is being used."
      />

      {loading && <LoadingState rows={6} />}
      {error && !loading && <ErrorState message={error} onRetry={reload} />}

      {!loading && !error && td.points.length === 0 && (
        <EmptyState
          icon={Activity}
          title="No activity yet"
          hint="The timeline fills in as reviewers submit condensed reviews on the platform."
        />
      )}

      {!loading && !error && td.points.length > 0 && (
        <div className="space-y-6">
          {/* Totals */}
          <div className="grid gap-4 sm:grid-cols-3">
            {statCards.map((c) => (
              <div key={c.label} className="apple-card p-4">
                <span className="text-muted-foreground">{c.icon}</span>
                <p className="mt-3 text-2xl font-semibold tracking-tight">
                  {c.value}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{c.label}</p>
              </div>
            ))}
          </div>

          {/* Cumulative "stock chart" */}
          <div className="apple-card p-5">
            <h3 className="text-title">Cumulative activity</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Running total of reviews and recommendations submitted over time.
            </p>
            <div className="mt-4 h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={td.points}
                  margin={{ left: 4, right: 12, top: 8 }}
                >
                  <defs>
                    <linearGradient id="gReviews" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={REVIEWS_COLOR} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={REVIEWS_COLOR} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gRecos" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={RECOS_COLOR} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={RECOS_COLOR} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtDay}
                    tick={{ fontSize: 11 }}
                    minTickGap={24}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    labelFormatter={(l) => fmtDay(l as string)}
                  />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="cumulativeReviews"
                    name="Reviews"
                    stroke={REVIEWS_COLOR}
                    fill="url(#gReviews)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: REVIEWS_COLOR }}
                    activeDot={{ r: 5 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="cumulativeRecommendations"
                    name="Recommendations"
                    stroke={RECOS_COLOR}
                    fill="url(#gRecos)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: RECOS_COLOR }}
                    activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Per-day submissions + reviewer breakdown */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="apple-card p-5 lg:col-span-2">
              <h3 className="text-title">Per-day submissions</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Reviews and recommendations submitted each day.
              </p>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={td.points}
                    margin={{ left: 4, right: 12, top: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={fmtDay}
                      tick={{ fontSize: 11 }}
                      minTickGap={24}
                    />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      labelFormatter={(l) => fmtDay(l as string)}
                    />
                    <Legend />
                    <Bar
                      dataKey="reviews"
                      name="Reviews"
                      fill={REVIEWS_COLOR}
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="recommendations"
                      name="Recommendations"
                      fill={RECOS_COLOR}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="apple-card p-5">
              <h3 className="text-title">Reviews by reviewer</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                All reviewers active on the platform.
              </p>
              <ul className="mt-4 space-y-3">
                {td.reviewers.map((r, i) => (
                  <li key={r.name}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="truncate">{r.name}</span>
                      <span className="font-medium">{r.reviews}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(r.reviews / maxReviewer) * 100}%`,
                          backgroundColor:
                            CHART_COLORS[i % CHART_COLORS.length],
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

