"use client";

/**
 * /portfolio — every project side by side and, underneath, the full repository
 * of reviews for each one. A card shows the latest risk posture, review count,
 * last review date, and a sparkline of severe (critical + high) threats across
 * versions. Clicking a card opens a drawer listing every condensed review for
 * that project; selecting one shows its full condensed detail. All derived
 * from stored condensed reviews — no raw per-threat/per-reco rows.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ChevronLeft,
  ClipboardList,
  FileSpreadsheet,
  Layers,
  Loader2,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import {
  useApi,
  PageHeader,
  LoadingState,
  ErrorState,
} from "@/components/view-helpers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { apiGet } from "@/lib/api-client";
import { RISK_COLORS, riskColor } from "@/lib/risk";
import type {
  PortfolioProject,
  PortfolioReview,
  ReviewDetail,
  RiskPosture,
} from "@/lib/dto";

function fmtDate(iso: string | undefined): string {
  if (!iso) return "Not provided";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Not provided" : d.toLocaleDateString();
}

/** Compact Critical/High/Medium/Low chips for one review's posture. */
function PostureChips({ posture }: { posture: RiskPosture }) {
  const parts = [
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
/* ── Full condensed review detail (shown inside the project drawer) ───────── */
function CondensedDetail({ reviewId }: { reviewId: number }) {
  const [state, setState] = useState<{
    id: number | null;
    detail: ReviewDetail | null;
    error: string | null;
  }>({ id: null, detail: null, error: null });

  useEffect(() => {
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
  const loading = !loaded;
  const review = detail?.review;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />
        <span>{error}</span>
      </div>
    );
  }
  if (!review || !detail) return null;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-muted-foreground">
        {detail.reviewer} · {detail.reviewDate} · v{detail.version}
      </p>

      {review.headline && (
        <p className="text-base font-medium leading-relaxed">
          {review.headline}
        </p>
      )}

      {!review.aiGenerated && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/50 p-3 text-sm">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">
            No AI observations for this review. Add an API key and re-submit to
            generate AI observations.
          </span>
        </div>
      )}

      <div>
        <h4 className="text-eyebrow text-muted-foreground">Risk posture</h4>
        <div className="mt-2">
          <PostureChips posture={review.riskPosture} />
        </div>
      </div>

      {review.observations.length > 0 && (
        <div>
          <h4 className="text-eyebrow text-muted-foreground">Observations</h4>
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

      {review.topRisks.length > 0 && (
        <div>
          <h4 className="text-eyebrow text-muted-foreground">Top risks</h4>
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

      {(detail.notes || detail.excelFilename) && (
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
    </div>
  );
}

/* ── One review row inside the project drawer's list ──────────────────────── */
function ReviewListRow({
  review,
  onOpen,
}: {
  review: PortfolioReview;
  onOpen: (id: number) => void;
}) {
  return (
    <button
      onClick={() => onOpen(review.id)}
      className="w-full rounded-xl border border-border p-3 text-left transition-colors hover:bg-accent/50"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="py-0 font-normal">
              {review.reviewer}
            </Badge>
            {review.version > 1 && (
              <span className="text-xs text-muted-foreground">
                v{review.version}
              </span>
            )}
            {!review.aiGenerated && (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                No AI
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {fmtDate(review.reviewDate)} · {review.threatCount} threats ·{" "}
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

/* ── Project drawer: review list ⇄ one review's condensed detail ──────────── */
function ProjectDrawer({
  project,
  openReviewId,
  onOpenReview,
  onBack,
  onClose,
}: {
  project: PortfolioProject | null;
  openReviewId: number | null;
  onOpenReview: (id: number) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const open = project != null;
  const reviews = project?.reviews ?? [];

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          {openReviewId != null ? (
            <>
              <button
                onClick={onBack}
                className="flex w-fit items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                All reviews for {project?.name}
              </button>
              <SheetTitle className="mt-1">{project?.name}</SheetTitle>
              <SheetDescription>Condensed review detail</SheetDescription>
            </>
          ) : (
            <>
              <SheetTitle>{project?.name}</SheetTitle>
              <SheetDescription>
                {reviews.length} review{reviews.length === 1 ? "" : "s"} ·
                newest first
              </SheetDescription>
            </>
          )}
        </SheetHeader>

        <div className="p-4 pt-0">
          {openReviewId != null ? (
            <CondensedDetail reviewId={openReviewId} />
          ) : reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No reviews for this project yet.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {reviews.map((r) => (
                <ReviewListRow key={r.id} review={r} onOpen={onOpenReview} />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
// CHUNK_PLACEHOLDER

export default function PortfolioPage() {
  const { data, loading, error, reload } = useApi<{
    projects?: PortfolioProject[];
  }>("/api/portfolio");

  const projects = data?.projects ?? [];
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [openReviewId, setOpenReviewId] = useState<number | null>(null);
  const selected = projects.find((p) => p.id === selectedId) ?? null;

  const openProject = useCallback((id: number) => {
    setSelectedId(id);
    setOpenReviewId(null);
  }, []);
  const closeDrawer = useCallback(() => {
    setSelectedId(null);
    setOpenReviewId(null);
  }, []);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Portfolio visibility"
        title="Portfolio"
        hint="Every project side by side — latest risk posture, how many reviews it has had, and how its severe-threat count has moved across versions. Select a project to open all of its condensed reviews."
      />

      {loading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <LoadingState key={i} rows={3} />
          ))}
        </div>
      )}
      {error && !loading && <ErrorState message={error} onRetry={reload} />}

      {!loading && !error && projects.length === 0 && (
        <EmptyState
          icon={Layers}
          title="No projects yet"
          hint="Projects appear here once reviews are submitted from the intake page."
          action={
            <Link
              href="/"
              className="apple-button apple-button-primary text-sm"
            >
              New submission
            </Link>
          }
        />
      )}

      {!loading && !error && projects.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const trend = (p.trend ?? []).map((t, i) => ({
              i,
              severe: t.severe ?? 0,
            }));
            return (
              <Card
                key={String(p.id)}
                role="button"
                tabIndex={0}
                onClick={() => openProject(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openProject(p.id);
                  }
                }}
                className="apple-card h-full cursor-pointer transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-title truncate">
                    {p.name || "Not provided"}
                  </CardTitle>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" />
                    Last review: {fmtDate(p.lastReviewDate)}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Risk posture */}
                  <div className="flex flex-wrap gap-2">
                    <Badge
                      variant="outline"
                      className="border-transparent text-white"
                      style={{ backgroundColor: RISK_COLORS.Critical }}
                    >
                      {p.criticalCount ?? 0} critical
                    </Badge>
                    <Badge
                      variant="outline"
                      className="border-transparent text-white"
                      style={{ backgroundColor: RISK_COLORS.High }}
                    >
                      {p.highCount ?? 0} high
                    </Badge>
                    <Badge
                      variant="outline"
                      className="border-transparent text-white"
                      style={{ backgroundColor: RISK_COLORS.Medium }}
                    >
                      {p.mediumCount ?? 0} medium
                    </Badge>
                    <Badge
                      variant="outline"
                      className="border-transparent text-white"
                      style={{ backgroundColor: RISK_COLORS.Low }}
                    >
                      {p.lowCount ?? 0} low
                    </Badge>
                  </div>

                  {/* Severe-threat trend sparkline */}
                  <div>
                    <p className="text-eyebrow mb-1 text-muted-foreground">
                      Severe threats (critical + high) trend
                    </p>
                    {trend.length > 1 ? (
                      <div className="h-16">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={trend}>
                            <Area
                              type="monotone"
                              dataKey="severe"
                              stroke="#ea580c"
                              fill="#ea580c"
                              fillOpacity={0.18}
                              strokeWidth={2}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Not enough history for a trend yet.
                      </p>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <ClipboardList className="h-3.5 w-3.5" />
                      {p.reviewCount ?? 0} review
                      {(p.reviewCount ?? 0) === 1 ? "" : "s"}
                    </span>
                    <span className="text-primary">View reviews →</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ProjectDrawer
        project={selected}
        openReviewId={openReviewId}
        onOpenReview={setOpenReviewId}
        onBack={() => setOpenReviewId(null)}
        onClose={closeDrawer}
      />
    </AppShell>
  );
}


