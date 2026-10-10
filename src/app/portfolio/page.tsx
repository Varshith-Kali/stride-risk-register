"use client";

/**
 * /portfolio — every project side by side: latest risk posture, review count,
 * last review date, and a sparkline of severe (critical + high) threats across
 * versions. Derived entirely from stored condensed reviews.
 */

import Link from "next/link";
import { Layers, CalendarDays, ClipboardList } from "lucide-react";
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
import { RISK_COLORS } from "@/lib/risk";
import type { PortfolioProject } from "@/lib/dto";

function fmtDate(iso: string | undefined): string {
  if (!iso) return "Not provided";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Not provided" : d.toLocaleDateString();
}

export default function PortfolioPage() {
  const { data, loading, error, reload } = useApi<{
    projects?: PortfolioProject[];
  }>("/api/portfolio");

  const projects = data?.projects ?? [];

  return (
    <AppShell>
      <PageHeader
        eyebrow="Portfolio visibility"
        title="Portfolio"
        hint="Every project side by side — latest risk posture, how many reviews it has had, and how its severe-threat count has moved across versions."
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
              <Card key={String(p.id)} className="apple-card h-full">
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
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
