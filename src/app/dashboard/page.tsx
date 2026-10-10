"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ClipboardList,
  FileSpreadsheet,
  Loader2,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { apiGet } from "@/lib/api-client";
import { CHART_COLORS, RISK_COLORS, riskColor } from "@/lib/risk";
import type {
  DashboardData,
  ReviewDetail,
  ReviewListItem,
  RiskPosture,
} from "@/lib/dto";

/**
 * Dashboard — the shared visibility hub ("/dashboard").
 *
 * One call to GET /api/dashboard returns totals, deterministic aggregates and
 * the newest-first feed of every reviewer's condensed reviews. No AI call runs
 * here — each review's headline/observations are already stored. A review row
 * (or ?review=<id> from intake) opens the full condensed review in a drawer,
 * fed by GET /api/submissions/<id>.
 */

const EMPTY_DATA: DashboardData = {
  totals: { reviews: 0, threatsReviewed: 0, recommendations: 0, reviewers: 0 },
  riskPosture: { critical: 0, high: 0, medium: 0, low: 0 },
  stride: [],
  reviewsByReviewer: [],
  reviews: [],
};

function normalize(raw: Partial<DashboardData> | null): DashboardData {
  return {
    totals: {
      reviews: raw?.totals?.reviews ?? 0,
      threatsReviewed: raw?.totals?.threatsReviewed ?? 0,
      recommendations: raw?.totals?.recommendations ?? 0,
      reviewers: raw?.totals?.reviewers ?? 0,
    },
    riskPosture: {
      critical: raw?.riskPosture?.critical ?? 0,
      high: raw?.riskPosture?.high ?? 0,
      medium: raw?.riskPosture?.medium ?? 0,
      low: raw?.riskPosture?.low ?? 0,
    },
    stride: Array.isArray(raw?.stride) ? raw.stride : [],
    reviewsByReviewer: Array.isArray(raw?.reviewsByReviewer)
      ? raw.reviewsByReviewer
      : [],
    reviews: Array.isArray(raw?.reviews) ? raw.reviews : [],
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
  children: ReactNode;
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

function ChartEmpty() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      No data for this chart yet.
    </div>
  );
}

/** Compact Critical/High/Medium/Low chips for a single review's posture. */
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

/** One review in the newest-first feed. Opens the detail drawer on click. */
function ReviewRow({
  review,
  onOpen,
}: {
  review: ReviewListItem;
  onOpen: (id: number) => void;
}) {
  return (
    <button
      onClick={() => onOpen(review.id)}
      className="apple-card group w-full p-4 text-left transition-colors hover:bg-accent/50"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{review.project}</span>
            {!review.aiGenerated && (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                No AI
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <Badge variant="secondary" className="mr-1.5 py-0 font-normal">
              {review.reviewer}
            </Badge>
            {review.reviewDate} · {review.threatCount} threats ·{" "}
            {review.recoCount} recommendations
          </p>
        </div>
        <PostureChips posture={review.riskPosture} />
      </div>
      {review.headline && (
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
          {review.headline}
        </p>
      )}
    </button>
  );
}

/* ── Review detail drawer ─────────────────────────────────────────────────── */
function ReviewDrawer({
  reviewId,
  onClose,
}: {
  reviewId: number | null;
  onClose: () => void;
}) {
  // Track the fetched id alongside its result so loading/error derive from
  // props without any synchronous setState in the effect body.
  const [state, setState] = useState<{
    id: number | null;
    detail: ReviewDetail | null;
    error: string | null;
  }>({ id: null, detail: null, error: null });

  useEffect(() => {
    if (reviewId == null) return;
    let cancelled = false;
    apiGet<ReviewDetail>(`/api/submissions/${reviewId}`).then(
      (d) => {
        if (!cancelled) setState({ id: reviewId, detail: d, error: null });
      },
      (err) => {
        if (cancelled) return;
        setState({
          id: reviewId,
          detail: null,
          error: err instanceof Error ? err.message : "Could not load review",
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [reviewId]);

  const loaded = state.id === reviewId;
  const detail = loaded ? state.detail : null;
  const error = loaded ? state.error : null;
  const loading = reviewId != null && !loaded;

  const review = detail?.review;

  return (
    <Sheet open={reviewId != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {detail ? detail.project : loading ? "Loading review…" : "Review"}
          </SheetTitle>
          <SheetDescription>
            {detail
              ? `${detail.reviewer} · ${detail.reviewDate} · v${detail.version}`
              : "Condensed review detail"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 p-4 pt-0">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />
              <span>{error}</span>
            </div>
          )}

          {review && (
            <>
              {review.headline && (
                <p className="text-base font-medium leading-relaxed">
                  {review.headline}
                </p>
              )}

              {!review.aiGenerated && (
                <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/50 p-3 text-sm">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    No AI observations for this review. Add an API key and
                    re-submit to generate AI observations.
                  </span>
                </div>
              )}

              {/* Risk posture */}
              <div>
                <h4 className="text-eyebrow text-muted-foreground">
                  Risk posture
                </h4>
                <div className="mt-2">
                  <PostureChips posture={review.riskPosture} />
                </div>
              </div>

              {/* Observations */}
              {review.observations.length > 0 && (
                <div>
                  <h4 className="text-eyebrow text-muted-foreground">
                    Observations
                  </h4>
                  <ul className="mt-2 space-y-1.5">
                    {review.observations.map((o, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-foreground/60" />
                        <span>{o}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Key recommendations */}
              {review.keyRecommendations.length > 0 && (
                <div>
                  <h4 className="text-eyebrow text-muted-foreground">
                    Key recommendations
                  </h4>
                  <ul className="mt-2 space-y-1.5">
                    {review.keyRecommendations.map((r, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <span className="mt-0.5 shrink-0 font-mono text-xs text-muted-foreground">
                          {i + 1}.
                        </span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Top risks */}
              {review.topRisks.length > 0 && (
                <div>
                  <h4 className="text-eyebrow text-muted-foreground">
                    Top risks
                  </h4>
                  <ul className="mt-2 space-y-1.5">
                    {review.topRisks.map((t, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="min-w-0 truncate">{t.title}</span>
                        <span
                          className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium"
                          style={{
                            backgroundColor: `${riskColor(t.risk)}1a`,
                            color: riskColor(t.risk),
                          }}
                        >
                          {t.risk || "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {detail && (detail.notes || detail.excelFilename) && (
                <div className="border-t border-border pt-3 text-xs text-muted-foreground">
                  {detail.excelFilename && (
                    <p className="flex items-center gap-1.5">
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      {detail.excelFilename}
                    </p>
                  )}
                  {detail.notes && <p className="mt-1">{detail.notes}</p>}
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Review drawer is driven by ?review=<id> so intake can deep-link straight
  // to the just-created review and the back button closes it.
  const reviewParam = searchParams.get("review");
  const reviewId =
    reviewParam && /^\d+$/.test(reviewParam) ? Number(reviewParam) : null;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiGet<Partial<DashboardData>>("/api/dashboard").then(
      (raw) => {
        setData(normalize(raw));
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err instanceof Error ? err.message : "Could not load dashboard");
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiGet<Partial<DashboardData>>("/api/dashboard").then(
      (raw) => {
        if (cancelled) return;
        setData(normalize(raw));
        setError(null);
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load dashboard");
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const openReview = useCallback(
    (id: number) => router.push(`/dashboard?review=${id}`),
    [router],
  );
  const closeReview = useCallback(() => router.push("/dashboard"), [router]);

  const { totals, riskPosture } = data;

  const riskPostureData = [
    { name: "Critical", value: riskPosture.critical },
    { name: "High", value: riskPosture.high },
    { name: "Medium", value: riskPosture.medium },
    { name: "Low", value: riskPosture.low },
  ];

  const kpiCards: { label: string; value: number; icon: ReactNode }[] = [
    {
      label: "Reviews",
      value: totals.reviews,
      icon: <ClipboardList className="h-4 w-4" />,
    },
    {
      label: "Threats reviewed",
      value: totals.threatsReviewed,
      icon: <ShieldAlert className="h-4 w-4" />,
    },
    {
      label: "Recommendations",
      value: totals.recommendations,
      icon: <FileSpreadsheet className="h-4 w-4" />,
    },
    {
      label: "Reviewers",
      value: totals.reviewers,
      icon: <Users className="h-4 w-4" />,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-eyebrow text-muted-foreground">
            Shared visibility hub
          </p>
          <h1 className="text-headline tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every reviewer&apos;s condensed reviews, in one place.
          </p>
        </div>
        <Button onClick={() => router.push("/")}>New submission</Button>
      </div>

      {loading ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-2xl" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-72 w-full rounded-2xl" />
            ))}
          </div>
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
      ) : totals.reviews === 0 ? (
        <div className="apple-card flex flex-col items-center gap-4 p-12 text-center">
          <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
          <div>
            <h2 className="text-title">No reviews yet</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Upload a STRIDE GPT export and paste the reviewer&apos;s
              recommendations — the platform condenses it into one high-level,
              reviewer-tagged review and it appears here.
            </p>
          </div>
          <Button onClick={() => router.push("/")}>Start a submission</Button>
        </div>
      ) : (
        <>
          {/* Totals */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {kpiCards.map((c) => (
              <div key={c.label} className="apple-card p-4">
                <span className="text-muted-foreground">{c.icon}</span>
                <p className="mt-3 text-2xl font-semibold tracking-tight">
                  {c.value}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{c.label}</p>
              </div>
            ))}
          </div>

          {/* Charts */}
          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard
              title="Risk posture across reviews"
              subtitle="Total threats by risk level, summed over every review"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={riskPostureData}
                  layout="vertical"
                  margin={{ left: 8, right: 24 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={70}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                    {riskPostureData.map((r) => (
                      <Cell key={r.name} fill={RISK_COLORS[r.name]} />
                    ))}
                    <LabelList
                      dataKey="value"
                      position="right"
                      className="fill-foreground"
                      style={{ fontSize: 12, fontWeight: 600 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="STRIDE distribution"
              subtitle="Threats per STRIDE category, across all reviews"
            >
              {data.stride.some((s) => s.value > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.stride}
                    layout="vertical"
                    margin={{ left: 8, right: 24 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={130}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                      {data.stride.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                      <LabelList
                        dataKey="value"
                        position="right"
                        className="fill-foreground"
                        style={{ fontSize: 12, fontWeight: 600 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ChartEmpty />
              )}
            </ChartCard>

            <ChartCard
              title="Reviews by reviewer"
              subtitle="Condensed reviews submitted per architect"
            >
              {data.reviewsByReviewer.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.reviewsByReviewer}
                    layout="vertical"
                    margin={{ left: 8, right: 24 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={130}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Bar
                      dataKey="value"
                      name="Reviews"
                      fill={CHART_COLORS[0]}
                      radius={[0, 6, 6, 0]}
                    >
                      <LabelList
                        dataKey="value"
                        position="right"
                        className="fill-foreground"
                        style={{ fontSize: 12, fontWeight: 600 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ChartEmpty />
              )}
            </ChartCard>
          </div>

          {/* Reviews feed */}
          <div className="space-y-3">
            <h2 className="text-title">Recent reviews</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {data.reviews.map((r) => (
                <ReviewRow key={r.id} review={r} onOpen={openReview} />
              ))}
            </div>
          </div>
        </>
      )}

      <ReviewDrawer reviewId={reviewId} onClose={closeReview} />
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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
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

