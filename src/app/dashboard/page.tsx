"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowUpRight,
  FileSpreadsheet,
  Loader2,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from "recharts";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ApiKeyDialog } from "@/components/api-key-dialog";
import { apiGet, apiPost } from "@/lib/api-client";
import { aiConfig, useApiKey } from "@/hooks/use-api-key";
import { CHART_COLORS, riskColor } from "@/lib/risk";
import type { DashboardData, DashboardKpis, NameValue } from "@/lib/dto";

/**
 * Agent D — executive dashboard ("/dashboard").
 *
 * One call to GET /api/dashboard returns KPIs + every chart aggregate.
 * Every KPI card drills into /register with a filter applied; every chart
 * lives in an `.apple-card` with a `.text-title` heading. The AI executive
 * summary is generated on demand via POST /api/ai/summary (session key only)
 * and is always labelled as AI-generated and unverified.
 */

const EMPTY_KPIS: DashboardKpis = {
  totalThreats: 0,
  criticalHigh: 0,
  withResponse: 0,
  noResponse: 0,
  unmappedRecos: 0,
  coveragePct: 0,
};

function normalize(raw: Partial<DashboardData> | null): DashboardData {
  return {
    kpis: { ...EMPTY_KPIS, ...(raw?.kpis ?? {}) },
    stride: Array.isArray(raw?.stride) ? raw.stride : [],
    risk: Array.isArray(raw?.risk) ? raw.risk : [],
    topThreats: Array.isArray(raw?.topThreats) ? raw.topThreats : [],
    components: Array.isArray(raw?.components) ? raw.components : [],
    coverage: {
      withResponse: raw?.coverage?.withResponse ?? 0,
      noResponse: raw?.coverage?.noResponse ?? 0,
    },
    reviewers: Array.isArray(raw?.reviewers) ? raw.reviewers : [],
  };
}

const chartTooltipStyle = {
  backgroundColor: "#fff",
  border: "1px solid oklch(0.92 0 0)",
  borderRadius: "12px",
  fontSize: "12px",
};

function ChartCard({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`apple-card p-5 ${className}`}>
      <h3 className="text-title">{title}</h3>
      {subtitle && (
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      )}
      <div className="mt-4 h-64">{children}</div>
    </div>
  );
}

function DashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const submissionId = searchParams.get("submission");

  const { apiKey, model, hasKey } = useApiKey();
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const load = useMemo(
    () => async () => {
      setLoading(true);
      setError(null);
      try {
        const url = submissionId
          ? `/api/dashboard?submissionId=${encodeURIComponent(submissionId)}`
          : "/api/dashboard";
        const raw = await apiGet<Partial<DashboardData>>(url);
        setData(normalize(raw));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not load dashboard",
        );
      } finally {
        setLoading(false);
      }
    },
    [submissionId],
  );

  useEffect(() => {
    load();
  }, [load]);

  async function generateSummary() {
    if (!hasKey) {
      setKeyDialogOpen(true);
      return;
    }
    if (!data) return;
    setSummaryLoading(true);
    setSummary(null);
    try {
      const res = await apiPost<{ summary: string }>("/api/ai/summary", {
        config: aiConfig(apiKey, model),
        kpis: data.kpis,
        topThreats: data.topThreats,
        ...(submissionId ? { submissionId } : {}),
      });
      setSummary(res.summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Summary failed";
      if (/404|not found/i.test(msg)) {
        toast.error(
          "AI summary service is not deployed yet. The key is still saved for this session.",
        );
      } else {
        toast.error(msg);
      }
    } finally {
      setSummaryLoading(false);
    }
  }

  const kpis = data?.kpis ?? EMPTY_KPIS;

  const kpiCards: {
    label: string;
    value: string | number;
    icon: React.ReactNode;
    href: string;
    tone?: string;
  }[] = [
    {
      label: "Total threats",
      value: kpis.totalThreats,
      icon: <FileSpreadsheet className="h-4 w-4" />,
      href: "/register",
    },
    {
      label: "Critical / High",
      value: kpis.criticalHigh,
      icon: <TriangleAlert className="h-4 w-4" />,
      href: "/register?risk=Critical,High",
      tone: "text-[#dc2626]",
    },
    {
      label: "With reviewer response",
      value: kpis.withResponse,
      icon: <ShieldCheck className="h-4 w-4" />,
      href: "/register?coverage=with-response",
      tone: "text-[#16a34a]",
    },
    {
      label: "No reviewer response",
      value: kpis.noResponse,
      icon: <AlertTriangle className="h-4 w-4" />,
      href: "/register?coverage=no-response",
      tone: "text-[#ea580c]",
    },
    {
      label: "Unmapped recommendations",
      value: kpis.unmappedRecos,
      icon: <AlertTriangle className="h-4 w-4" />,
      href: "/recommendations?unmapped=1",
    },
    {
      label: "Reviewer coverage",
      value: `${kpis.coveragePct}%`,
      icon: <ShieldCheck className="h-4 w-4" />,
      href: "/reviewers",
    },
  ];

  const coverageData = [
    { name: "Coverage", with: data?.coverage.withResponse ?? 0, without: data?.coverage.noResponse ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-eyebrow text-muted-foreground">
            Executive overview
          </p>
          <h1 className="text-headline tracking-tight">Dashboard</h1>
        </div>
        {submissionId && (
          <Badge variant="secondary" className="gap-2 py-1.5">
            Showing submission #{submissionId}
            <button
              onClick={() => router.push("/dashboard")}
              aria-label="Clear submission filter"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        )}
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <div className="apple-card flex flex-col items-center gap-3 p-10 text-center">
          <TriangleAlert className="h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">Couldn&apos;t load the dashboard</p>
          <p className="text-xs text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={load}>
            Retry
          </Button>
        </div>
      ) : kpis.totalThreats === 0 ? (
        <div className="apple-card flex flex-col items-center gap-4 p-12 text-center">
          <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
          <div>
            <h2 className="text-title">No submissions yet</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Upload a STRIDE GPT export and paste the reviewer&apos;s
              recommendations to populate the executive overview, risk register
              and charts.
            </p>
          </div>
          <Button onClick={() => router.push("/")}>Start a submission</Button>
        </div>
      ) : (
        <>
          {/* KPI cards — every number drills into the register */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {kpiCards.map((c) => (
              <button
                key={c.label}
                onClick={() => router.push(c.href)}
                className="apple-card group p-4 text-left"
              >
                <div className="flex items-center justify-between">
                  <span className={`text-muted-foreground ${c.tone ?? ""}`}>
                    {c.icon}
                  </span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
                <p className="mt-3 text-2xl font-semibold tracking-tight">
                  {c.value}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{c.label}</p>
              </button>
            ))}
          </div>

          {/* AI executive summary */}
          <div className="apple-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-title">Executive summary</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Grounded strictly in the numbers above — every statement is
                  traceable.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={generateSummary}
                disabled={summaryLoading}
              >
                {summaryLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {summaryLoading ? "Generating…" : "Generate"}
              </Button>
            </div>
            {summary ? (
              <div className="mt-4 space-y-2">
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {summary}
                </p>
                <p className="text-xs text-muted-foreground">
                  <Badge variant="outline">AI Suggestion, Unverified</Badge>{" "}
                  Generated from the dashboard aggregates only — verify against
                  the register before sharing.
                </p>
              </div>
            ) : (
              !summaryLoading && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {hasKey
                    ? "Click Generate to produce a traceable one-paragraph summary."
                    : "Add your OpenAI API key (session only) to generate the summary."}
                </p>
              )
            )}
          </div>

          {/* Charts */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="STRIDE category distribution"
              subtitle="Threats per STRIDE category"
            >
              {data!.stride.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data!.stride}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="55%"
                      outerRadius="85%"
                      paddingAngle={2}
                    >
                      {data!.stride.map((_, i) => (
                        <Cell
                          key={i}
                          fill={CHART_COLORS[i % CHART_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={chartTooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <ChartEmpty />
              )}
            </ChartCard>

            <ChartCard
              title="Risk level distribution"
              subtitle="Threats per risk level"
            >
              {data!.risk.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data!.risk} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 12 }} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={110}
                      tick={{ fontSize: 12 }}
                    />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                      {data!.risk.map((r: NameValue, i: number) => (
                        <Cell key={i} fill={riskColor(r.name)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ChartEmpty />
              )}
            </ChartCard>

            <ChartCard
              title="Top ranked threats"
              subtitle="Highest-ranked open threats"
              className="lg:col-span-2"
            >
              {data!.topThreats.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[...data!.topThreats]
                      .slice(0, 10)
                      .map((t, i) => ({
                        ...t,
                        bar: t.score ?? 10 - i,
                      }))}
                    layout="vertical"
                    margin={{ left: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 12 }} />
                    <YAxis
                      type="category"
                      dataKey="title"
                      width={220}
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v: string) =>
                        v.length > 42 ? `${v.slice(0, 42)}…` : v
                      }
                    />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Bar dataKey="bar" name="Rank score" radius={[0, 6, 6, 0]}>
                      {data!.topThreats.slice(0, 10).map((t, i) => (
                        <Cell key={i} fill={riskColor(t.risk)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ChartEmpty />
              )}
            </ChartCard>

            <ChartCard
              title="Threats by component"
              subtitle="Largest components first"
            >
              {data!.components.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <Treemap
                    data={data!.components.slice(0, 12).map((c, i) => ({
                      name: c.name || "Not provided",
                      size: c.value,
                      fill: CHART_COLORS[i % CHART_COLORS.length],
                    }))}
                    dataKey="size"
                    nameKey="name"
                    stroke="#fff"
                  >
                    <Tooltip contentStyle={chartTooltipStyle} />
                  </Treemap>
                </ResponsiveContainer>
              ) : (
                <ChartEmpty />
              )}
            </ChartCard>

            <ChartCard
              title="Reviewer coverage"
              subtitle="Threats with vs without a reviewer response"
            >
              {data!.coverage.withResponse + data!.coverage.noResponse > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={coverageData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 12 }} />
                    <YAxis type="category" dataKey="name" hide />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Bar
                      dataKey="with"
                      name="With response"
                      stackId="cov"
                      fill="#16a34a"
                      radius={[6, 0, 0, 6]}
                    />
                    <Bar
                      dataKey="without"
                      name="No response"
                      stackId="cov"
                      fill="#ea580c"
                      radius={[0, 6, 6, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ChartEmpty />
              )}
            </ChartCard>

            <ChartCard
              title="Reviewer workload"
              subtitle="Threats reviewed per architect"
              className="lg:col-span-2"
            >
              {data!.reviewers.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data!.reviewers} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 12 }} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={160}
                      tick={{ fontSize: 12 }}
                    />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Bar
                      dataKey="threats"
                      name="Threats"
                      fill={CHART_COLORS[0]}
                      radius={[0, 6, 6, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ChartEmpty />
              )}
            </ChartCard>
          </div>

          {/* STRIDE legend */}
          {data!.stride.length > 0 && (
            <div className="apple-card flex flex-wrap gap-x-5 gap-y-2 p-4">
              {data!.stride.map((s, i) => (
                <span
                  key={s.name}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{
                      backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                    }}
                  />
                  {s.name} ({s.value})
                </span>
              ))}
            </div>
          )}
        </>
      )}

      <ApiKeyDialog open={keyDialogOpen} onOpenChange={setKeyDialogOpen} />
    </div>
  );
}

function ChartEmpty() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      No data for this chart yet.
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="space-y-6">
            <Skeleton className="h-12 w-1/3" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full rounded-2xl" />
              ))}
            </div>
          </div>
        }
      >
        <DashboardInner />
      </Suspense>
    </AppShell>
  );
}
