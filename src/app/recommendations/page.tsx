"use client";

/**
 * /recommendations — all reviewer recommendations with linked threats,
 * confidence badges, status editing, manual re-linking, and library saving.
 * Unmapped recommendations are highlighted (amber left border + badge).
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  Link2,
  BookPlus,
  Check,
  X,
  Search,
  MessageSquareQuote,
  FileText,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import {
  useApi,
  PageHeader,
  LoadingState,
  ErrorState,
} from "@/components/view-helpers";
import { apiPatch, apiPost, apiGet } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ─── Types (defensive — Agent C owns the route) ────────────────────────────────

interface RecoLink {
  id: string | number;
  threatId: string | number;
  threatRef?: string;
  threatTitle?: string;
  confidence?: "High" | "Medium" | "Low";
  decision?: "proposed" | "accepted" | "rejected";
  rationale?: string;
  quote?: string;
}

interface Recommendation {
  id: string | number;
  text: string;
  projectName?: string;
  projectId?: string | number;
  submissionId?: string | number;
  reviewerName?: string;
  status?: string;
  links?: RecoLink[];
}

interface ThreatOption {
  id: string | number;
  ref?: string;
  title?: string;
}

const CONFIDENCE_STYLES: Record<string, string> = {
  High: "bg-[#16a34a] text-white border-transparent hover:bg-[#16a34a]/90",
  Medium: "bg-[#ca8a04] text-white border-transparent hover:bg-[#ca8a04]/90",
  Low: "bg-secondary text-secondary-foreground border-transparent",
};

const RECO_STATUSES = [
  "Pending",
  "In Progress",
  "Implemented",
  "Deferred",
  "Rejected",
];

function ConfidenceBadge({ level }: { level?: string }) {
  if (!level) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] uppercase tracking-wide",
        CONFIDENCE_STYLES[level] ??
          "bg-secondary text-secondary-foreground border-transparent",
      )}
    >
      {level}
    </Badge>
  );
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "Request failed";
}

function decidedBy(): string | null {
  const name = window.prompt(
    "Your name (recorded as the person making this decision):",
  );
  if (name === null) return null;
  const trimmed = name.trim();
  return trimmed || null;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function RecommendationsPage() {
  const { data, loading, error, reload } = useApi<{
    recos?: Recommendation[];
  }>("/api/recommendations");

  const [query, setQuery] = useState("");
  const [unmappedOnly, setUnmappedOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string | number>>(new Set());
  const [relinkFor, setRelinkFor] = useState<Recommendation | null>(null);
  const [mutating, setMutating] = useState(false);

  const recos = useMemo(() => data?.recos ?? [], [data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recos.filter((r) => {
      const isUnmapped = !r.links || r.links.length === 0;
      if (unmappedOnly && !isUnmapped) return false;
      if (!q) return true;
      const hay = [
        r.text,
        r.projectName,
        r.reviewerName,
        ...(r.links ?? []).map((l) => l.threatTitle ?? ""),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [recos, query, unmappedOnly]);

  const unmappedCount = useMemo(
    () => recos.filter((r) => !r.links || r.links.length === 0).length,
    [recos],
  );

  function toggleExpanded(id: string | number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function updateStatus(reco: Recommendation, status: string) {
    setMutating(true);
    try {
      await apiPatch(`/api/recommendations/${reco.id}`, { status });
      toast.success("Recommendation status updated");
      reload();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setMutating(false);
    }
  }

  async function saveToLibrary(reco: Recommendation) {
    setMutating(true);
    try {
      await apiPost("/api/library", {
        text: reco.text,
        category: "General",
        approvedBy: reco.reviewerName || "",
      });
      toast.success("Saved to the recommendation library");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setMutating(false);
    }
  }

  async function decideLink(link: RecoLink, decision: "accepted" | "rejected") {
    const by = decidedBy();
    if (by === null) return;
    setMutating(true);
    try {
      await apiPatch(`/api/links/${link.id}`, {
        decision,
        decidedBy: by,
      });
      toast.success(
        decision === "accepted" ? "Link accepted" : "Link rejected",
      );
      reload();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setMutating(false);
    }
  }

  async function createManualLink(reco: Recommendation, threat: ThreatOption) {
    const by = decidedBy();
    if (by === null) return;
    setMutating(true);
    try {
      await apiPost("/api/links", {
        threatId: threat.id,
        recommendationId: reco.id,
        decidedBy: by,
      });
      setRelinkFor(null);
      toast.success("Manual link created");
      reload();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setMutating(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Reviewer output"
        title="Recommendations"
        hint="Every recommendation is traceable to the reviewer who wrote it. Unmapped items never matched any threat — review them before they slip through."
        actions={
          unmappedCount > 0 ? (
            <Badge
              variant="outline"
              className="bg-amber-50 text-amber-800 border-amber-200"
            >
              {unmappedCount} unmapped
            </Badge>
          ) : undefined
        }
      />

      <div className="apple-card mb-5 flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search recommendations, threats, projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="unmapped-only"
            checked={unmappedOnly}
            onCheckedChange={setUnmappedOnly}
          />
          <Label htmlFor="unmapped-only" className="text-sm">
            Unmapped only
          </Label>
        </div>
      </div>

      {loading && <LoadingState rows={5} />}
      {error && !loading && <ErrorState message={error} onRetry={reload} />}

      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          icon={MessageSquareQuote}
          title={recos.length === 0 ? "No recommendations yet" : "No matches"}
          hint={
            recos.length === 0
              ? "Recommendations appear here once a submission with reviewer notes is processed."
              : "Try a different search term or clear the unmapped filter."
          }
        />
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-4">
          {filtered.map((reco) => {
            const links = reco.links ?? [];
            const isUnmapped = links.length === 0;
            const isOpen = expanded.has(reco.id);
            return (
              <article
                key={String(reco.id)}
                className={cn(
                  "apple-card p-5",
                  isUnmapped && "border-l-4 border-l-amber-500",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {isUnmapped && (
                        <Badge
                          variant="outline"
                          className="bg-amber-50 text-amber-800 border-amber-200"
                        >
                          Unmapped Recommendation
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {reco.projectName || "Not provided"}
                        {reco.reviewerName ? ` · ${reco.reviewerName}` : ""}
                      </span>
                    </div>
                    <p
                      className={cn(
                        "text-sm leading-relaxed",
                        !isOpen && "line-clamp-3",
                      )}
                    >
                      {reco.text}
                    </p>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(reco.id)}
                      className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      {isOpen ? (
                        <>
                          Show less <ChevronUp className="h-3.5 w-3.5" />
                        </>
                      ) : (
                        <>
                          Show more <ChevronDown className="h-3.5 w-3.5" />
                        </>
                      )}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={reco.status || "Pending"}
                      onValueChange={(v) => updateStatus(reco, v)}
                      disabled={mutating}
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[
                          ...new Set([
                            ...(reco.status ? [reco.status] : []),
                            ...RECO_STATUSES,
                          ]),
                        ].map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Linked threats */}
                <div className="mt-4 border-t border-border pt-4">
                  <p className="text-eyebrow mb-2 text-muted-foreground">
                    Linked threats
                  </p>
                  {isUnmapped ? (
                    <p className="text-sm text-muted-foreground">
                      No reviewer response mapping found — this recommendation
                      could not be tied to any threat.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {links.map((link) => (
                        <div
                          key={String(link.id)}
                          className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/60 px-3 py-2"
                        >
                          <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="font-mono text-xs text-muted-foreground">
                            {link.threatRef || "—"}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {link.threatTitle || "Not provided"}
                          </span>
                          <ConfidenceBadge level={link.confidence} />
                          <Badge variant="outline" className="text-[10px]">
                            {link.decision === "proposed"
                              ? "AI-inferred link"
                              : link.decision === "accepted"
                                ? "Accepted"
                                : "Rejected"}
                          </Badge>
                          {link.decision === "proposed" && (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-green-700 hover:text-green-800"
                                title="Accept link"
                                disabled={mutating}
                                onClick={() => decideLink(link, "accepted")}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive"
                                title="Reject link"
                                disabled={mutating}
                                onClick={() => decideLink(link, "rejected")}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    disabled={mutating}
                    onClick={() => saveToLibrary(reco)}
                  >
                    <BookPlus className="h-4 w-4" />
                    Save to library
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    disabled={mutating || !reco.submissionId}
                    onClick={() => setRelinkFor(reco)}
                    title={
                      reco.submissionId
                        ? "Manually link to a threat"
                        : "Submission context missing"
                    }
                  >
                    <Link2 className="h-4 w-4" />
                    Re-link manually
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <RelinkDialog
        reco={relinkFor}
        onClose={() => setRelinkFor(null)}
        onPick={(threat) => {
          if (relinkFor) void createManualLink(relinkFor, threat);
        }}
        busy={mutating}
      />
    </AppShell>
  );
}

// ─── Manual re-link dialog ───────────────────────────────────────────────────

function RelinkDialog({
  reco,
  onClose,
  onPick,
  busy,
}: {
  reco: Recommendation | null;
  onClose: () => void;
  onPick: (threat: ThreatOption) => void;
  busy: boolean;
}) {
  const [q, setQ] = useState("");
  const threatsUrl = reco?.submissionId
    ? `/api/threats?submissionId=${reco.submissionId}`
    : null;
  const { data, loading } = useApi<{ threats?: ThreatOption[] }>(threatsUrl);

  const threats = (data?.threats ?? []).filter((t) => {
    const hay = `${t.ref ?? ""} ${t.title ?? ""}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  return (
    <Dialog open={reco !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Link to a threat</DialogTitle>
          <DialogDescription>
            Pick the threat this recommendation addresses. Your name is recorded
            as the decider.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search threats…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && threats.length === 0 && (
            <div className="flex flex-col items-center py-8 text-center">
              <FileText className="mb-2 h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No threats found for this submission.
              </p>
            </div>
          )}
          {threats.map((t) => (
            <button
              key={String(t.id)}
              type="button"
              disabled={busy}
              onClick={() => onPick(t)}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {t.ref || "—"}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {t.title || "Not provided"}
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
