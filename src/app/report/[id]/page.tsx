"use client";

/**
 * /report/[id] — print-optimized executive report for one submission.
 * Deliberately NOT wrapped in AppShell: minimal top bar with Back + Print.
 * Print CSS hides chrome via @media print.
 */

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Printer, FileText } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { useApi, LoadingState, ErrorState } from "@/components/view-helpers";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { riskBadgeClass } from "@/lib/risk";

// ─── Types (defensive — the audit-pack bundle is owned by Agent C) ───────────

interface PackThreat {
  id?: string | number;
  ref?: string;
  title?: string;
  stride?: string;
  component?: string;
  risk?: string;
  status?: string;
  excel_sheet?: string;
  excel_row?: number;
}

interface PackLink {
  threatRef?: string;
  threatTitle?: string;
  confidence?: string;
  decision?: string;
  rationale?: string;
  quote?: string;
}

interface PackReco {
  text?: string;
  reviewerName?: string;
  status?: string;
  links?: PackLink[];
}

interface AcceptedRisk {
  threatRef?: string;
  threatTitle?: string;
  justification?: string;
  approver?: string;
  expiryDate?: string;
}

interface AuditEntry {
  at?: string;
  actor?: string;
  action?: string;
  detail?: string;
}

interface AuditPack {
  submission?: {
    id?: string | number;
    projectName?: string;
    reviewerName?: string;
    reviewDate?: string;
    version?: number;
    createdAt?: string;
  };
  kpis?: Record<string, number | string>;
  threats?: PackThreat[];
  recommendations?: PackReco[];
  acceptedRisks?: AcceptedRisk[];
  auditTrail?: AuditEntry[];
  generatedAt?: string;
}

function fmt(iso: string | undefined): string {
  if (!iso) return "Not provided";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Not provided" : d.toLocaleDateString();
}

function fmtTime(iso: string | undefined): string {
  if (!iso) return "Not provided";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Not provided" : d.toLocaleString();
}

function ReportInner() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const { data, loading, error, reload } = useApi<AuditPack>(
    id ? `/api/export/audit-pack?submissionId=${encodeURIComponent(id)}` : null,
  );

  const pack = data;
  const kpis = useMemo(() => {
    const entries = Object.entries(pack?.kpis ?? {});
    return entries;
  }, [pack]);

  function handlePrint() {
    window.print();
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Print CSS — hide all chrome when printing */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .print-card { box-shadow: none !important; border: 1px solid #ddd !important; break-inside: avoid; }
          main { padding: 0 !important; }
        }
      `}</style>

      {/* Minimal top bar */}
      <header className="no-print navbar-solid sticky top-0 z-40">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-2 px-4">
          <Button asChild variant="ghost" size="sm" className="rounded-full">
            <Link href="/audit">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </Button>
          <div className="ml-auto">
            <Button size="sm" className="rounded-full" onClick={handlePrint}>
              <Printer className="h-4 w-4" />
              Print
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {loading && <LoadingState rows={8} />}
        {error && !loading && (
          <div className="no-print">
            <ErrorState message={error} onRetry={reload} />
          </div>
        )}

        {!loading && !error && !pack && (
          <div className="no-print">
            <EmptyState
              icon={FileText}
              title="Report not available"
              hint="The audit pack for this submission could not be loaded."
            />
          </div>
        )}

        {!loading && !error && pack && (
          <div className="space-y-8">
            {/* Header */}
            <section>
              <div className="flex items-center gap-3">
                <BrandMark className="h-10 w-10" />
                <div>
                  <p className="text-eyebrow text-muted-foreground">
                    Executive risk report
                  </p>
                  <h1 className="text-headline">
                    {pack.submission?.projectName || "Not provided"}
                  </h1>
                </div>
              </div>
              <dl className="apple-card print-card mt-4 grid grid-cols-2 gap-4 p-5 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-eyebrow text-muted-foreground">
                    Reviewer
                  </dt>
                  <dd className="mt-1 font-medium">
                    {pack.submission?.reviewerName || "Not provided"}
                  </dd>
                </div>
                <div>
                  <dt className="text-eyebrow text-muted-foreground">
                    Review date
                  </dt>
                  <dd className="mt-1 font-medium">
                    {fmt(pack.submission?.reviewDate)}
                  </dd>
                </div>
                <div>
                  <dt className="text-eyebrow text-muted-foreground">
                    Version
                  </dt>
                  <dd className="mt-1 font-medium">
                    {pack.submission?.version ?? "Not provided"}
                  </dd>
                </div>
                <div>
                  <dt className="text-eyebrow text-muted-foreground">
                    Generated
                  </dt>
                  <dd className="mt-1 font-medium">
                    {fmtTime(pack.generatedAt)}
                  </dd>
                </div>
              </dl>
            </section>

            {/* KPI row */}
            {kpis.length > 0 && (
              <section>
                <h2 className="text-title mb-3">Key figures</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {kpis.map(([label, value]) => (
                    <div key={label} className="apple-card print-card p-4">
                      <p className="text-eyebrow text-muted-foreground">
                        {label}
                      </p>
                      <p className="text-headline mt-1">{String(value)}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Risk table */}
            <section>
              <h2 className="text-title mb-3">Risk register</h2>
              {(pack.threats ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No threats in this submission.
                </p>
              ) : (
                <div className="apple-card print-card overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Risk ID</th>
                        <th className="px-4 py-3 font-medium">Threat</th>
                        <th className="px-4 py-3 font-medium">STRIDE</th>
                        <th className="px-4 py-3 font-medium">Severity</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Source row</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(pack.threats ?? []).map((t, i) => (
                        <tr
                          key={String(t.id ?? i)}
                          className="border-b border-border last:border-0"
                        >
                          <td className="px-4 py-3 font-mono text-xs">
                            {t.ref || "—"}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-medium">
                              {t.title || "Not provided"}
                            </span>
                            {t.component && (
                              <span className="block text-xs text-muted-foreground">
                                {t.component}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {t.stride || "Not provided"}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant="outline"
                              className={riskBadgeClass(t.risk)}
                            >
                              {t.risk || "Not provided"}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={t.status} />
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                            {t.excel_sheet
                              ? `${t.excel_sheet}!${t.excel_row ?? "?"}`
                              : "Not provided"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Recommendations with links */}
            <section>
              <h2 className="text-title mb-3">Reviewer recommendations</h2>
              {(pack.recommendations ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No recommendations recorded.
                </p>
              ) : (
                <div className="space-y-3">
                  {(pack.recommendations ?? []).map((r, i) => {
                    const links = r.links ?? [];
                    return (
                      <div key={i} className="apple-card print-card p-5">
                        <p className="text-sm leading-relaxed">{r.text}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <StatusBadge status={r.status} />
                          {r.reviewerName && (
                            <span>by {r.reviewerName}</span>
                          )}
                        </div>
                        {links.length > 0 ? (
                          <div className="mt-3 space-y-2 border-t border-border pt-3">
                            {links.map((l, j) => (
                              <div key={j} className="text-sm">
                                <p className="font-medium">
                                  → {l.threatRef ? `${l.threatRef}: ` : ""}
                                  {l.threatTitle || "Not provided"}
                                </p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {l.decision === "proposed"
                                    ? "AI-inferred link"
                                    : `Link ${l.decision || "recorded"}`}
                                  {l.confidence
                                    ? ` · confidence ${l.confidence}`
                                    : ""}
                                </p>
                                {l.rationale && (
                                  <p className="mt-0.5 text-xs text-muted-foreground">
                                    {l.rationale}
                                  </p>
                                )}
                                {l.quote && (
                                  <blockquote className="mt-1 border-l-2 border-border pl-3 text-xs italic text-muted-foreground">
                                    “{l.quote}”
                                  </blockquote>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-3 border-t border-border pt-3 text-xs font-medium text-amber-700">
                            Unmapped Recommendation — could not be tied to any
                            threat.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Accepted risks */}
            {(pack.acceptedRisks ?? []).length > 0 && (
              <section>
                <h2 className="text-title mb-3">Accepted risks</h2>
                <div className="space-y-3">
                  {(pack.acceptedRisks ?? []).map((a, i) => (
                    <div key={i} className="apple-card print-card p-5">
                      <p className="font-medium">
                        {a.threatRef ? `${a.threatRef}: ` : ""}
                        {a.threatTitle || "Not provided"}
                      </p>
                      <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            Justification
                          </dt>
                          <dd>{a.justification || "Not provided"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            Approver
                          </dt>
                          <dd>{a.approver || "Not provided"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            Expiry / review date
                          </dt>
                          <dd>{fmt(a.expiryDate)}</dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Audit trail */}
            <section>
              <h2 className="text-title mb-3">Audit trail</h2>
              {(pack.auditTrail ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No audit entries in this pack.
                </p>
              ) : (
                <div className="apple-card print-card overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Time</th>
                        <th className="px-4 py-3 font-medium">Actor</th>
                        <th className="px-4 py-3 font-medium">Action</th>
                        <th className="px-4 py-3 font-medium">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(pack.auditTrail ?? []).map((e, i) => (
                        <tr
                          key={i}
                          className="border-b border-border last:border-0"
                        >
                          <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                            {fmtTime(e.at)}
                          </td>
                          <td className="px-4 py-3">
                            {e.actor || "Not provided"}
                          </td>
                          <td className="px-4 py-3 font-medium">
                            {e.action || "Not provided"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {e.detail || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <p className="border-t border-border pt-4 text-center text-xs text-muted-foreground">
              Generated {fmtTime(pack.generatedAt)} · STRIDE Risk Register ·
              ISG Security Architecture. Every figure above is traceable to the
              stored submission data — nothing is inferred.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

export default function ReportPage() {
  return (
    <Suspense fallback={<LoadingState rows={8} />}>
      <ReportInner />
    </Suspense>
  );
}
