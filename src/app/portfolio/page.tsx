"use client";

/**
 * /portfolio — all projects side by side: risk posture, open items,
 * accepted-risk count, last review date, and an open-count trend sparkline.
 */

import Link from "next/link";
import { Layers, CalendarDays, ShieldCheck } from "lucide-react";
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

interface TrendPoint {
  date?: string;
  openCount?: number;
}

interface PortfolioProject {
  id: string | number;
  name?: string;
  criticalCount?: number;
  highCount?: number;
  openCount?: number;
  acceptedRiskCount?: number;
  lastReviewDate?: string;
  trend?: TrendPoint[];
}

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
        hint="Every project side by side — risk posture, open items, accepted risks and how the open count has moved over time."
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
          hint="Projects appear here once submissions are processed from the intake page."
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
              openCount: t.openCount ?? 0,
            }));
            return (
              <Link
                key={String(p.id)}
                href={`/register?project=${encodeURIComponent(p.name ?? "")}`}
                className="block"
              >
                <Card className="apple-card h-full cursor-pointer">
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
                        className="bg-secondary text-secondary-foreground border-transparent"
                      >
                        {p.openCount ?? 0} open
                      </Badge>
                    </div>

                    {/* Trend sparkline */}
                    <div>
                      <p className="text-eyebrow mb-1 text-muted-foreground">
                        Open items trend
                      </p>
                      {trend.length > 1 ? (
                        <div className="h-16">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={trend}>
                              <Area
                                type="monotone"
                                dataKey="openCount"
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
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {p.acceptedRiskCount ?? 0} accepted risk
                        {(p.acceptedRiskCount ?? 0) === 1 ? "" : "s"}
                      </span>
                      <span className="font-medium text-foreground">
                        Open register →
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
