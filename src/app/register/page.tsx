"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Columns3,
  Download,
  FileDown,
  Loader2,
  Quote,
  Search,
  ShieldAlert,
  TriangleAlert,
  X,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { apiGet, apiGetQuery, apiPatch } from "@/lib/api-client";
import {
  riskBadgeClass,
  riskLabel,
  STRIDE_ORDER,
} from "@/lib/risk";
import {
  csvCell,
  displayOrNA,
  downloadBlob,
  NOT_PROVIDED,
} from "@/lib/format";
import type {
  AuditEntry,
  Threat,
  ThreatLink,
  ThreatsResponse,
} from "@/lib/dto";
import { THREAT_STATUSES as STATUSES } from "@/lib/dto";

/**
 * Agent D — risk register ("/register").
 *
 * Filterable / sortable / searchable table of every threat, with column
 * chooser, CSV + Excel export, and a drill-down drawer: threat detail,
 * rank explanation, linked recommendations (accept/reject with evidence),
 * status workflow, priority override, and an audit-trail snippet.
 */

const ALL = "__all__";

/** Pure fetch (no setState): safe to call from effects and event handlers. */
async function fetchThreats(params: {
  status?: string;
  risk?: string;
  stride?: string;
  q?: string;
}): Promise<Threat[]> {
  const data = await apiGetQuery<ThreatsResponse>("/api/threats", params);
  return Array.isArray(data.threats) ? data.threats : [];
}

const COLUMNS = [
  { key: "ref", label: "Risk ID" },
  { key: "projectName", label: "Project" },
  { key: "title", label: "Threat" },
  { key: "stride", label: "STRIDE" },
  { key: "component", label: "Component" },
  { key: "risk", label: "Severity" },
  { key: "reviewerName", label: "Reviewer" },
  { key: "links", label: "Linked Recs" },
  { key: "status", label: "Status" },
  { key: "source", label: "Source" },
] as const;

type ColumnKey = (typeof COLUMNS)[number]["key"];
type SortKey = "ref" | "title" | "stride" | "component" | "risk" | "reviewerName" | "status";

const RISK_RANK: Record<string, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

function statusBadgeClass(status: string): string {
  switch (status) {
    case "Open":
      return "border-[#dc2626]/40 bg-[#dc2626]/10 text-[#dc2626]";
    case "In Progress":
      return "border-[#ea580c]/40 bg-[#ea580c]/10 text-[#ea580c]";
    case "Mitigated":
      return "border-[#16a34a]/40 bg-[#16a34a]/10 text-[#16a34a]";
    case "Accepted Risk":
      return "border-[#ca8a04]/40 bg-[#ca8a04]/10 text-[#ca8a04]";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function confidenceBadgeClass(c: string): string {
  switch (c) {
    case "High":
      return "border-[#16a34a]/40 bg-[#16a34a]/10 text-[#16a34a]";
    case "Medium":
      return "border-[#ca8a04]/40 bg-[#ca8a04]/10 text-[#ca8a04]";
    default:
      return "border-[#808080]/40 bg-[#808080]/10 text-[#595959]";
  }
}

function RegisterInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [threats, setThreats] = useState<Threat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters (seeded from URL so dashboard KPI cards drill in).
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? ALL);
  const [risk, setRisk] = useState(searchParams.get("risk") ?? ALL);
  const [stride, setStride] = useState(searchParams.get("stride") ?? ALL);
  const [project, setProject] = useState(searchParams.get("project") ?? ALL);
  const [coverage, setCoverage] = useState(
    searchParams.get("coverage") ?? ALL,
  );
  const [debouncedQ, setDebouncedQ] = useState(q);

  const [sortKey, setSortKey] = useState<SortKey>("risk");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [visibleCols, setVisibleCols] = useState<ColumnKey[]>(
    COLUMNS.map((c) => c.key),
  );

  const [selected, setSelected] = useState<Threat | null>(null);
  // Reviewer attribution for drawer actions — lives in the parent so it
  // survives switching between threats (the drawer itself resets per threat).
  const [changedBy, setChangedBy] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  const riskValues = risk === ALL ? [] : risk.split(",");
  const apiRisk = riskValues.length === 1 ? riskValues[0] : undefined;

  // Threat list fetch on filter change. State updates happen only in promise
  // continuations (never synchronously in the effect body), per
  // react-hooks/set-state-in-effect.
  useEffect(() => {
    let cancelled = false;
    fetchThreats({
      status: status === ALL ? undefined : status,
      risk: apiRisk,
      stride: stride === ALL ? undefined : stride,
      q: debouncedQ || undefined,
    }).then(
      (list) => {
        if (cancelled) return;
        setThreats(list);
        setError(null);
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load threats");
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, status, apiRisk, stride]);

  // Retry button (event handler — synchronous setState is fine here).
  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchThreats({
      status: status === ALL ? undefined : status,
      risk: apiRisk,
      stride: stride === ALL ? undefined : stride,
      q: debouncedQ || undefined,
    }).then(
      (list) => {
        setThreats(list);
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err instanceof Error ? err.message : "Could not load threats");
        setLoading(false);
      },
    );
  }, [debouncedQ, status, apiRisk, stride]);

  const projects = useMemo(
    () => Array.from(new Set(threats.map((t) => t.projectName).filter(Boolean))),
    [threats],
  );

  const filtered = useMemo(() => {
    let rows = threats;
    if (riskValues.length > 1)
      rows = rows.filter((t) => riskValues.includes(t.risk));
    if (project !== ALL) rows = rows.filter((t) => t.projectName === project);
    if (coverage === "with-response")
      rows = rows.filter((t) => (t.linkedCount ?? t.links?.length ?? 0) > 0);
    if (coverage === "no-response")
      rows = rows.filter((t) => (t.linkedCount ?? t.links?.length ?? 0) === 0);
    const sorted = [...rows].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "risk") {
        return (
          dir *
          ((RISK_RANK[b.risk] ?? 0) - (RISK_RANK[a.risk] ?? 0) ||
            (b.rankScore ?? 0) - (a.rankScore ?? 0))
        );
      }
      const av = String(a[sortKey] ?? "");
      const bv = String(b[sortKey] ?? "");
      return dir * av.localeCompare(bv);
    });
    return sorted;
  }, [threats, project, coverage, riskValues, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "risk" ? "desc" : "asc");
    }
  }

  function clearFilters() {
    setQ("");
    setStatus(ALL);
    setRisk(ALL);
    setStride(ALL);
    setProject(ALL);
    setCoverage(ALL);
  }

  const hasActiveFilters =
    q || status !== ALL || risk !== ALL || stride !== ALL || project !== ALL || coverage !== ALL;

  function exportCsv() {
    const header = [
      "Risk ID",
      "Project",
      "Threat",
      "STRIDE",
      "Component",
      "Risk level",
      "Severity score",
      "Reviewer",
      "Linked recommendations",
      "Status",
      "Source sheet",
      "Source row",
    ];
    const lines = filtered.map((t) =>
      [
        t.ref,
        t.projectName,
        t.title,
        t.stride,
        t.component,
        t.risk || NOT_PROVIDED,
        t.severityScore ?? "",
        t.reviewerName,
        t.linkedCount ?? t.links?.length ?? 0,
        t.status,
        t.excelSheet,
        t.excelRow,
      ]
        .map(csvCell)
        .join(","),
    );
    downloadBlob(
      `risk-register-${new Date().toISOString().slice(0, 10)}.csv`,
      [header.map(csvCell).join(","), ...lines].join("\n"),
      "text/csv",
    );
    toast.success(`Exported ${filtered.length} rows to CSV.`);
  }

  function exportExcel() {
    const qs = new URLSearchParams();
    if (status !== ALL) qs.set("status", status);
    if (risk !== ALL) qs.set("risk", risk);
    if (stride !== ALL) qs.set("stride", stride);
    if (debouncedQ) qs.set("q", debouncedQ);
    const url = qs.toString()
      ? `/api/export/register?${qs}`
      : "/api/export/register";
    window.location.href = url;
  }

  function renderSortHeader(k: SortKey, label: string) {
    const active = sortKey === k;
    return (
      <button
        onClick={() => toggleSort(k)}
        className="inline-flex items-center gap-1 font-medium hover:text-foreground"
      >
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-eyebrow text-muted-foreground">Governed register</p>
          <h1 className="text-headline tracking-tight">Risk Register</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4" />
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel}>
            <FileDown className="h-4 w-4" />
            Export Excel
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 className="h-4 w-4" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {COLUMNS.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.key}
                  checked={visibleCols.includes(c.key)}
                  onCheckedChange={(checked) =>
                    setVisibleCols((prev) =>
                      checked
                        ? [...prev, c.key]
                        : prev.filter((k) => k !== c.key),
                    )
                  }
                >
                  {c.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Filter bar */}
      <div className="apple-card flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search threats, components, IDs…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={risk} onValueChange={setRisk}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Risk" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All risks</SelectItem>
            {["Critical", "High", "Medium", "Low"].map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={stride} onValueChange={setStride}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="STRIDE" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {STRIDE_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={project} onValueChange={setProject}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={coverage} onValueChange={setCoverage}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Coverage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All coverage</SelectItem>
            <SelectItem value="with-response">With response</SelectItem>
            <SelectItem value="no-response">No reviewer response</SelectItem>
          </SelectContent>
        </Select>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4" />
            Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="apple-card overflow-hidden">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <TriangleAlert className="h-8 w-8 text-destructive" />
            <p className="text-sm font-medium">Couldn&apos;t load the register</p>
            <p className="text-xs text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={retry}>
              Retry
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-12 text-center">
            <ShieldAlert className="h-10 w-10 text-muted-foreground" />
            <div>
              <h2 className="text-title">No threats match</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {threats.length === 0
                  ? "No submissions yet — start one from the intake page."
                  : "Try widening the filters."}
              </p>
            </div>
            {threats.length === 0 ? (
              <Button onClick={() => router.push("/")}>
                Start a submission
              </Button>
            ) : (
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-left text-xs text-muted-foreground">
                  {visibleCols.includes("ref") && (
                    <th className="px-4 py-3">
                      {renderSortHeader("ref", "Risk ID")}
                    </th>
                  )}
                  {visibleCols.includes("projectName") && (
                    <th className="px-4 py-3">Project</th>
                  )}
                  {visibleCols.includes("title") && (
                    <th className="px-4 py-3">
                      {renderSortHeader("title", "Threat")}
                    </th>
                  )}
                  {visibleCols.includes("stride") && (
                    <th className="px-4 py-3">
                      {renderSortHeader("stride", "STRIDE")}
                    </th>
                  )}
                  {visibleCols.includes("component") && (
                    <th className="px-4 py-3">
                      {renderSortHeader("component", "Component")}
                    </th>
                  )}
                  {visibleCols.includes("risk") && (
                    <th className="px-4 py-3">
                      {renderSortHeader("risk", "Severity")}
                    </th>
                  )}
                  {visibleCols.includes("reviewerName") && (
                    <th className="px-4 py-3">
                      {renderSortHeader("reviewerName", "Reviewer")}
                    </th>
                  )}
                  {visibleCols.includes("links") && (
                    <th className="px-4 py-3">Linked Recs</th>
                  )}
                  {visibleCols.includes("status") && (
                    <th className="px-4 py-3">
                      {renderSortHeader("status", "Status")}
                    </th>
                  )}
                  {visibleCols.includes("source") && (
                    <th className="px-4 py-3">Source</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const linked = t.linkedCount ?? t.links?.length ?? 0;
                  return (
                    <tr
                      key={t.id}
                      onClick={() => setSelected(t)}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/40"
                    >
                      {visibleCols.includes("ref") && (
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                          {displayOrNA(t.ref)}
                        </td>
                      )}
                      {visibleCols.includes("projectName") && (
                        <td className="px-4 py-3">{displayOrNA(t.projectName)}</td>
                      )}
                      {visibleCols.includes("title") && (
                        <td className="max-w-xs px-4 py-3">
                          <span className="line-clamp-2 font-medium">
                            {displayOrNA(t.title)}
                          </span>
                        </td>
                      )}
                      {visibleCols.includes("stride") && (
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                          {displayOrNA(t.stride)}
                        </td>
                      )}
                      {visibleCols.includes("component") && (
                        <td className="px-4 py-3">{displayOrNA(t.component)}</td>
                      )}
                      {visibleCols.includes("risk") && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <Badge className={riskBadgeClass(t.risk)}>
                            {riskLabel(t.risk)}
                          </Badge>
                          {t.severityScore != null && (
                            <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                              {t.severityScore}
                            </span>
                          )}
                        </td>
                      )}
                      {visibleCols.includes("reviewerName") && (
                        <td className="whitespace-nowrap px-4 py-3">
                          {displayOrNA(t.reviewerName)}
                        </td>
                      )}
                      {visibleCols.includes("links") && (
                        <td className="px-4 py-3">
                          {linked > 0 ? (
                            <Badge variant="secondary">{linked}</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[#ea580c]">
                              No response
                            </Badge>
                          )}
                        </td>
                      )}
                      {visibleCols.includes("status") && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <Badge className={statusBadgeClass(t.status)}>
                            {t.status}
                          </Badge>
                        </td>
                      )}
                      {visibleCols.includes("source") && (
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                          {displayOrNA(t.excelSheet)}:{t.excelRow || "–"}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            {filtered.length} of {threats.length} threats · click a row for the
            drill-down
          </div>
        )}
      </div>

      <ThreatDrawer
        key={selected?.id ?? "none"}
        threat={selected}
        changedBy={changedBy}
        onChangedBy={setChangedBy}
        onClose={() => setSelected(null)}
        onUpdated={(updated) => {
          setThreats((prev) =>
            prev.map((t) => (t.id === updated.id ? updated : t)),
          );
          setSelected(updated);
        }}
      />
    </div>
  );
}

/* ── Drill-down drawer ─────────────────────────────────────────────────────── */

function ThreatDrawer({
  threat,
  changedBy,
  onChangedBy,
  onClose,
  onUpdated,
}: {
  threat: Threat | null;
  changedBy: string;
  onChangedBy: (v: string) => void;
  onClose: () => void;
  onUpdated: (t: Threat) => void;
}) {
  const [busy, setBusy] = useState(false);
  // Per-threat form state re-initializes via key={threat.id} at the usage
  // site — no sync-on-prop-change effect (react-hooks/set-state-in-effect).
  const [newStatus, setNewStatus] = useState(() => threat?.status ?? "");
  const [statusReason, setStatusReason] = useState("");
  const [priorityValue, setPriorityValue] = useState(
    () => threat?.priorityOverride ?? "",
  );
  const [priorityReason, setPriorityReason] = useState("");
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);

  const threatId = threat?.id ?? null;
  useEffect(() => {
    if (threatId == null) return;
    apiGet<{ entries?: AuditEntry[]; audit?: AuditEntry[] }>(
      `/api/audit?entity=threat&limit=20`,
    )
      .then((data) => {
        const entries = data.entries ?? data.audit ?? [];
        setAudit(
          entries.filter(
            (e) => e.entityId === threatId || e.entityId == null,
          ),
        );
      })
      .catch(() => setAudit(null));
  }, [threatId]);

  if (!threat) return null;

  const links = threat.links ?? [];
  const hasLinks = links.length > 0;

  async function patchThreat(body: Record<string, unknown>) {
    if (!changedBy.trim()) {
      toast.error("Enter your name so the change is attributed.");
      return;
    }
    setBusy(true);
    try {
      const updated = await apiPatch<Threat>(`/api/threats/${threat!.id}`, {
        ...body,
        changedBy: changedBy.trim(),
      });
      onUpdated(updated);
      toast.success("Threat updated — audit entry recorded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function decideLink(link: ThreatLink, decision: "accepted" | "rejected") {
    if (!changedBy.trim()) {
      toast.error("Enter your name so the decision is attributed.");
      return;
    }
    setBusy(true);
    try {
      await apiPatch(`/api/links/${link.id}`, {
        decision,
        decidedBy: changedBy.trim(),
      });
      const updated = {
        ...threat!,
        links: threat!.links.map((l) =>
          l.id === link.id ? { ...l, decision, decidedBy: changedBy.trim() } : l,
        ),
      };
      onUpdated(updated);
      toast.success(`Link ${decision}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  }

  function submitStatus() {
    if (!threat) {
      toast.error("No threat selected.");
      return;
    }
    if (newStatus === threat.status && !statusReason.trim()) {
      toast.error("Nothing to change — pick a new status or add a reason.");
      return;
    }
    patchThreat({ status: newStatus, statusReason: statusReason.trim() || undefined });
  }

  function submitPriority() {
    if (!priorityValue.trim()) {
      toast.error("Enter the override priority.");
      return;
    }
    if (!priorityReason.trim()) {
      toast.error("A reason is mandatory for priority overrides.");
      return;
    }
    patchThreat({
      priorityOverride: priorityValue.trim(),
      priorityOverrideReason: priorityReason.trim(),
    });
  }

  return (
    <Sheet open={!!threat} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <Badge className={riskBadgeClass(threat.risk)}>
              {riskLabel(threat.risk)}
            </Badge>
            <Badge variant="outline" className="font-mono">
              {displayOrNA(threat.ref)}
            </Badge>
            <Badge className={statusBadgeClass(threat.status)}>
              {threat.status}
            </Badge>
          </div>
          <SheetTitle className="mt-2 text-left leading-snug">
            {displayOrNA(threat.title)}
          </SheetTitle>
          <SheetDescription className="text-left">
            {displayOrNA(threat.projectName)} · reviewed by{" "}
            {displayOrNA(threat.reviewerName)} · source {displayOrNA(threat.excelSheet)}:
            row {threat.excelRow || "–"}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 py-6">
          {/* Detail */}
          <section className="space-y-3">
            <DetailRow label="STRIDE category" value={threat.stride} />
            <DetailRow label="Component" value={threat.component} />
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Description
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">
                {displayOrNA(threat.description)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                MITRE ATT&CK
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {threat.mitre?.length ? (
                  threat.mitre.map((m) => (
                    <Badge key={m} variant="secondary" className="font-mono">
                      {m}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {NOT_PROVIDED}
                  </span>
                )}
              </div>
            </div>
            <DetailRow label="Existing controls" value={threat.existingControls} />
            <DetailRow label="Safety metrics" value={threat.safetyMetrics} />
            {threat.priorityOverride && (
              <DetailRow
                label="Priority override"
                value={`${threat.priorityOverride}${
                  threat.priorityOverrideReason
                    ? ` — ${threat.priorityOverrideReason}`
                    : ""
                }`}
              />
            )}
          </section>

          {/* Rank explanation */}
          {threat.rankExplanation && (
            <section className="rounded-xl bg-muted p-4">
              <p className="text-xs font-medium text-muted-foreground">
                Why is this ranked here?
              </p>
              <p className="mt-1 text-sm">{threat.rankExplanation}</p>
            </section>
          )}

          <Separator />

          {/* Linked recommendations */}
          <section className="space-y-3">
            <h3 className="text-title">Linked recommendations</h3>
            {!hasLinks ? (
              <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                <span className="font-medium text-[#ea580c]">
                  No Reviewer Response
                </span>{" "}
                — no recommendation has been linked to this threat yet.
              </div>
            ) : (
              links.map((l) => (
                <LinkCard
                  key={l.id}
                  link={l}
                  busy={busy}
                  onDecide={(d) => decideLink(l, d)}
                />
              ))
            )}
          </section>

          <Separator />

          {/* Governance actions */}
          <section className="space-y-4">
            <h3 className="text-title">Governance</h3>
            <div className="space-y-2">
              <Label htmlFor="changed-by">Your name (attribution)</Label>
              <Input
                id="changed-by"
                placeholder="e.g. Varshith Puli"
                value={changedBy}
                onChange={(e) => onChangedBy(e.target.value)}
              />
            </div>

            <div className="space-y-2 rounded-xl border border-border p-4">
              <Label>Change status</Label>
              <div className="flex flex-wrap gap-2">
                <Select value={newStatus} onValueChange={setNewStatus}>
                  <SelectTrigger className="w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={submitStatus} disabled={busy} size="sm">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Apply
                </Button>
              </div>
              <Textarea
                rows={2}
                placeholder="Reason for the change (recorded in the audit log)"
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
              />
            </div>

            <div className="space-y-2 rounded-xl border border-border p-4">
              <Label>Priority override</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  placeholder="e.g. P0 — fix this sprint"
                  value={priorityValue}
                  onChange={(e) => setPriorityValue(e.target.value)}
                  className="w-52"
                />
                <Button onClick={submitPriority} disabled={busy} size="sm">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Override
                </Button>
              </div>
              <Textarea
                rows={2}
                placeholder="Reason (mandatory — recorded in the audit log)"
                value={priorityReason}
                onChange={(e) => setPriorityReason(e.target.value)}
              />
            </div>
          </section>

          {/* Audit snippet */}
          {audit && audit.length > 0 && (
            <>
              <Separator />
              <section className="space-y-2">
                <h3 className="text-title">Audit trail</h3>
                <ol className="space-y-2">
                  {audit.slice(0, 8).map((a) => (
                    <li
                      key={a.id}
                      className="rounded-lg bg-muted/60 p-3 text-xs"
                    >
                      <p className="font-medium">
                        {displayOrNA(a.action)}
                        <span className="ml-2 font-normal text-muted-foreground">
                          by {displayOrNA(a.actor)}
                        </span>
                      </p>
                      {a.detail && (
                        <p className="mt-0.5 text-muted-foreground">
                          {a.detail}
                        </p>
                      )}
                      <p className="mt-0.5 font-mono text-muted-foreground">
                        {a.createdAt}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm">{displayOrNA(value)}</p>
    </div>
  );
}

function LinkCard({
  link,
  busy,
  onDecide,
}: {
  link: ThreatLink;
  busy: boolean;
  onDecide: (d: "accepted" | "rejected") => void;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        link.decision === "rejected" ? "border-border opacity-60" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{link.sourceLabel}</Badge>
        <Badge className={confidenceBadgeClass(link.confidence)}>
          {link.confidence} confidence
        </Badge>
        <Badge
          variant={link.decision === "accepted" ? "default" : "secondary"}
        >
          {link.decision}
        </Badge>
      </div>
      <p className="mt-2 text-sm font-medium">
        {displayOrNA(link.recommendationText)}
      </p>
      {link.rationale && (
        <p className="mt-1 text-sm text-muted-foreground">{link.rationale}</p>
      )}
      {link.quote && (
        <blockquote className="mt-2 flex gap-2 rounded-lg bg-muted p-3 text-xs">
          <Quote className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="italic">“{link.quote}”</span>
        </blockquote>
      )}
      {link.decision === "proposed" && (
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onDecide("accepted")}
          >
            Accept link
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onDecide("rejected")}
          >
            Reject
          </Button>
        </div>
      )}
      {link.decidedBy && (
        <p className="mt-2 text-xs text-muted-foreground">
          Decided by {link.decidedBy}
        </p>
      )}
    </div>
  );
}

export default function RegisterPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="space-y-4">
            <Skeleton className="h-12 w-1/3" />
            <Skeleton className="h-96 w-full" />
          </div>
        }
      >
        <RegisterInner />
      </Suspense>
    </AppShell>
  );
}
