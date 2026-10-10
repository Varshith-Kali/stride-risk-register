"use client";

/**
 * /timeline — a chronological view of how the platform is being used.
 *
 * One call to GET /api/timeline returns three complementary slices:
 *  - a KPI band (totals + activity span),
 *  - a cumulative "growth" area chart (running totals over time), and
 *  - a dated activity feed: every review as an entry on a vertical timeline,
 *    newest first — the part that stays legible whether there are 2 reviews
 *    or 2,000.
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Activity, CalendarRange, TrendingUp, Users } from "lucide-react";
import {
  Area,
  AreaChart,
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
import { RISK_COLORS } from "@/lib/risk";
import type { TimelineData, RiskPosture } from "@/lib/dto";

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

function fmtFull(iso: string | null | undefined): string {
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

function normalize(raw: Partial<TimelineData> | null): TimelineData {
  return {
    points: Array.isArray(raw?.points) ? raw.points : [],
    events: Array.isArray(raw?.events) ? raw.events : [],
    reviewers: Array.isArray(raw?.reviewers) ? raw.reviewers : [],
    totals: {
      reviews: raw?.totals?.reviews ?? 0,
      recommendations: raw?.totals?.recommendations ?? 0,
      reviewers: raw?.totals?.reviewers ?? 0,
      firstActivity: raw?.totals?.firstActivity ?? null,
      lastActivity: raw?.totals?.lastActivity ?? null,
    },
  };
}

/** Compact Critical/High/Medium/Low chips for one review's posture. */
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

export default function TimelinePage() {
  const router = useRouter();
  const { data, loading, error, reload } =
    useApi<Partial<TimelineData>>("/api/timeline");

  const td = useMemo(() => normalize(data ?? null), [data]);

  const avgRecos =
    td.totals.reviews > 0
      ? Math.round((td.totals.recommendations / td.totals.reviews) * 10) / 10
      : 0;

  const statCards = [
    {
      label: "Total reviews",
      value: String(td.totals.reviews),
      icon: <Activity className="h-4 w-4" />,
    },
    {
      label: "Recommendations",
      value: String(td.totals.recommendations),
      icon: <TrendingUp className="h-4 w-4" />,
    },
    {
      label: "Avg per review",
      value: String(avgRecos),
      icon: <TrendingUp className="h-4 w-4" />,
    },
    {
      label: "Active reviewers",
      value: String(td.totals.reviewers),
      icon: <Users className="h-4 w-4" />,
    },
  ];

  return (
    <AppShell>
      <PageHeader
        eyebrow="Platform activity"
        title="Timeline"
        hint="A running, chronological view of every condensed review submitted across the platform — how fast the register is growing and what landed when."
      />

      {loading && <LoadingState rows={6} />}
      {error && !loading && <ErrorState message={error} onRetry={reload} />}

      {!loading && !error && td.events.length === 0 && (
        <EmptyState
          icon={Activity}
          title="No activity yet"
          hint="The timeline fills in as reviewers submit condensed reviews on the platform."
        />
      )}

      {!loading && !error && td.events.length > 0 && (
        <div className="space-y-6">
          {/* KPI band */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

          {/* Activity span */}
          <div className="apple-card flex flex-wrap items-center gap-2 p-4 text-sm">
            <CalendarRange className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Active from</span>
            <span className="font-medium">
              {fmtFull(td.totals.firstActivity)}
            </span>
            <span className="text-muted-foreground">to</span>
            <span className="font-medium">
              {fmtFull(td.totals.lastActivity)}
            </span>
          </div>

          {/* Cumulative growth ("stock chart") */}
          <div className="apple-card p-5">
            <h3 className="text-title">Platform growth</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Running total of reviews and recommendations as the register
              builds up over time.
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

          {/* Activity feed — the chronological timeline */}
          <div className="apple-card p-5">
            <h3 className="text-title">Activity feed</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Every review in order, most recent first. Select one to open its
              condensed detail.
            </p>
            <ol className="mt-5 space-y-0">
              {td.events.map((e, i) => (
                <li key={e.id} className="relative flex gap-4 pb-6 last:pb-0">
                  {/* Connector line + node */}
                  <div className="relative flex flex-col items-center">
                    <span className="z-10 mt-1 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-background bg-foreground" />
                    {i < td.events.length - 1 && (
                      <span className="absolute top-1 h-full w-px bg-border" />
                    )}
                  </div>

                  {/* Entry */}
                  <button
                    onClick={() => router.push(`/dashboard?review=${e.id}`)}
                    className="min-w-0 flex-1 rounded-xl px-3 py-2 text-left transition-colors hover:bg-accent/50"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="truncate font-medium">
                          {e.project}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {e.reviewer}
                        </span>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {fmtFull(e.createdAt)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <PostureChips posture={e.riskPosture} />
                      <span className="text-xs text-muted-foreground">
                        {e.threatCount} threats · {e.recoCount} recommendations
                      </span>
                    </div>
                    {e.headline && (
                      <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
                        {e.headline}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </AppShell>
  );
}
