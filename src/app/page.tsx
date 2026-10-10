"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Info,
  Loader2,
  TriangleAlert,
  Upload,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiPost, apiPostForm } from "@/lib/api-client";
import { aiConfig, useApiKey } from "@/hooks/use-api-key";
import type {
  ColumnMapping,
  IngestPreview,
  Reviewer,
  SubmissionResult,
} from "@/lib/dto";

/**
 * Agent D — intake wizard ("/").
 *
 * Step 1: upload the STRIDE GPT .xlsx export, enter submission metadata
 * (project name, mandatory reviewer, review date, notes) and paste the
 * reviewer's recommendations.
 * Step 2: column-mapping preview — confirm/correct how Excel headers map to
 * platform fields (values are exact Excel header names). The mapping is
 * remembered per header fingerprint.
 * Step 3: processing → redirects to /dashboard?submission=<id>.
 */

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const PLATFORM_FIELDS: {
  key: keyof ColumnMapping;
  label: string;
  required: boolean;
}[] = [
  { key: "ref", label: "Threat ID / S.No", required: false },
  { key: "title", label: "Threat title", required: true },
  { key: "description", label: "Description", required: false },
  { key: "stride", label: "STRIDE category", required: true },
  { key: "component", label: "Component / Asset", required: false },
  { key: "mitre", label: "MITRE ATT&CK", required: false },
  { key: "risk", label: "Risk level", required: true },
  { key: "existingControls", label: "Existing controls", required: false },
  { key: "safetyMetrics", label: "Safety metrics", required: false },
  { key: "severity", label: "Severity / DREAD score", required: false },
  { key: "owner", label: "Owner", required: false },
  { key: "dueDate", label: "Due date", required: false },
  { key: "likelihood", label: "Likelihood", required: false },
  { key: "impact", label: "Impact", required: false },
];

function localToday(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function StepHeader({ step }: { step: number }) {
  const steps = ["Upload & metadata", "Column mapping", "Processing"];
  return (
    <ol className="flex items-center gap-2" aria-label="Submission steps">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const current = n === step;
        return (
          <li key={label} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-6 bg-border sm:w-10" aria-hidden />}
            <span
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
                current
                  ? "border-primary bg-primary text-primary-foreground"
                  : done
                    ? "border-border bg-secondary text-foreground"
                    : "border-border text-muted-foreground"
              }`}
            >
              {done ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <span className="font-mono">{n}</span>
              )}
              <span className="hidden sm:inline">{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function IntakeWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(1);

  // ── Step 1 state ──
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [reviewDate, setReviewDate] = useState(localToday());
  const [notes, setNotes] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [reviewersLoading, setReviewersLoading] = useState(true);
  const [reviewersError, setReviewersError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  // ── Step 2 state ──
  const [preview, setPreview] = useState<IngestPreview | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submission, setSubmission] = useState<SubmissionResult | null>(null);
  const { apiKey, model } = useApiKey();

  // Reviewer list (mandatory for every submission).
  useEffect(() => {
    let cancelled = false;
    apiGet<{ reviewers: Reviewer[] }>("/api/reviewers")
      .then((data) => {
        if (!cancelled) setReviewers(data.reviewers ?? []);
      })
      .catch((err: Error) => {
        if (!cancelled)
          setReviewersError(
            err.message || "Could not load reviewers. Is the API running?",
          );
      })
      .finally(() => {
        if (!cancelled) setReviewersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Library "reuse" → pre-fill recommendations (Agent E passes ?reco=...).
  useEffect(() => {
    const reco = searchParams.get("reco");
    if (reco) {
      setRecommendations((prev) =>
        prev ? `${prev}\n\n${reco}` : reco,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickFile = useCallback((f: File | null) => {
    if (!f) return;
    const isXlsx =
      f.name.toLowerCase().endsWith(".xlsx") ||
      f.type ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (!isXlsx) {
      toast.error("Please choose a .xlsx file (STRIDE GPT export).");
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      toast.error("File is larger than 10 MB — please use a smaller export.");
      return;
    }
    setFile(f);
  }, []);

  const headers =
    preview?.sheets.find((s) => s.name === sheetName)?.headers ??
    preview?.sheets[0]?.headers ??
    [];

  async function startPreview() {
    if (!file) {
      toast.error("Upload the STRIDE GPT .xlsx export first.");
      return;
    }
    if (!reviewerName) {
      toast.error("Reviewer selection is mandatory.");
      return;
    }
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const data = await apiPostForm<IngestPreview>(
        "/api/ingest/preview",
        fd,
      );
      setPreview(data);
      setSheetName(data.sheets[0]?.name ?? "");
      setMapping(data.savedMapping?.mapping ?? data.suggestedMapping.mapping);
      setStep(2);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setParsing(false);
    }
  }

  function setMappingField(key: keyof ColumnMapping, value: string) {
    setMapping((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      if (!value) delete next[key];
      else (next as Record<string, string>)[key] = value;
      return next;
    });
  }

  const mappingValid =
    !!mapping?.title?.trim() && !!mapping?.stride?.trim() && !!mapping?.risk?.trim();

  async function confirmAndSubmit() {
    if (!file || !mapping) return;
    if (!mappingValid) {
      toast.error(
        "Map the required fields: Threat title, STRIDE category, Risk level.",
      );
      return;
    }
    setSubmitting(true);
    setStep(3);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("projectName", projectName.trim());
      fd.append("reviewerName", reviewerName);
      fd.append("reviewDate", reviewDate);
      fd.append("notes", notes);
      fd.append("recommendationsText", recommendations);
      fd.append("mappingJson", JSON.stringify(mapping));
      const data = await apiPostForm<SubmissionResult>("/api/submissions", fd);
      setSubmission(data);
      data.warnings.forEach((w) => toast.warning(w, { duration: 6000 }));
      toast.success(
        `Submission saved: ${data.threatCount} threats, ${data.recoCount} recommendations.`,
      );
      // ── AI threat↔recommendation mapping (human-in-the-loop: links are
      // stored as `proposed`; the reviewer accepts/rejects them in the
      // register). Runs only when a session API key is present.
      if (apiKey && data.threatCount > 0 && data.recoCount > 0) {
        try {
          const linked = await runAiMapping(data.submissionId);
          if (linked > 0) {
            toast.success(
              `AI proposed ${linked} threat↔recommendation link${linked === 1 ? "" : "s"} — review them in the register.`,
              { duration: 8000 },
            );
          } else {
            toast.info(
              "AI found no confident threat↔recommendation links — link them manually in the register.",
              { duration: 8000 },
            );
          }
        } catch (err) {
          toast.warning(
            `AI mapping skipped (${err instanceof Error ? err.message : "mapping failed"}) — you can link manually.`,
            { duration: 8000 },
          );
        }
      } else if (!apiKey && data.recoCount > 0) {
        toast.info(
          "Tip: set your OpenAI API key (top bar) to auto-map threats ↔ recommendations with AI.",
          { duration: 8000 },
        );
      }
      router.push(`/dashboard?submission=${data.submissionId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submission failed");
      setStep(2);
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Fetch the stored submission, ask the AI to propose threat↔recommendation
   * links (with quotes + confidence), and persist them as `proposed`.
   * Returns the number of links stored.
   */
  async function runAiMapping(submissionId: number): Promise<number> {
    const detail = await apiGet<{
      threats: {
        excel_row: number;
        title: string;
        description: string;
        stride_category: string;
        risk_level: string;
      }[];
      recommendations: { reco_index: number; text: string }[];
    }>(`/api/submissions/${submissionId}`);
    const threats = (detail.threats ?? []).map((t) => ({
      row: t.excel_row,
      title: t.title,
      description: t.description,
      stride: t.stride_category,
      risk: t.risk_level,
    }));
    const recos = (detail.recommendations ?? []).map((r) => ({
      index: r.reco_index,
      text: r.text,
    }));
    if (threats.length === 0 || recos.length === 0) return 0;
    const mapRes = await apiPost<{
      links: {
        threatRow: number;
        recoIndex: number;
        confidence: string;
        rationale: string;
        quote: string;
      }[];
    }>("/api/ai/map", {
      config: aiConfig(apiKey, model),
      threats,
      recos,
    });
    const links = mapRes.links ?? [];
    if (links.length === 0) return 0;
    const bulkRes = await apiPost<{ created: number; skipped: number }>(
      "/api/links/bulk",
      { submissionId, links },
    );
    return bulkRes.created;
  }

  const suggested = preview?.suggestedMapping;
  const saved = preview?.savedMapping;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <p className="text-eyebrow text-muted-foreground">New submission</p>
        <h1 className="text-headline tracking-tight">
          From threat model to governed register
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Upload a STRIDE GPT Excel export, choose the reviewer, paste their
          post-review recommendations — the platform ranks, links and
          visualises everything with full traceability.
        </p>
      </div>

      <StepHeader step={step} />

      {step === 1 && (
        <div className="apple-card space-y-6 p-6 sm:p-8">
          {/* File dropzone */}
          <div className="space-y-2">
            <Label>Threat model Excel (.xlsx)</Label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                pickFile(e.dataTransfer.files?.[0] ?? null);
              }}
              className={`flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
                dragOver
                  ? "border-primary bg-accent"
                  : "border-border hover:border-ring hover:bg-accent/50"
              }`}
            >
              <Upload className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm font-medium">
                {file ? file.name : "Drop the STRIDE GPT export here, or click to browse"}
              </span>
              <span className="text-xs text-muted-foreground">
                .xlsx only · max 10 MB · all sheets are parsed, rows keep their
                original numbers
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {/* Metadata */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="project-name">Project / application name</Label>
              <Input
                id="project-name"
                placeholder="e.g. Payments Gateway v2"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reviewer">
                Reviewer <span className="text-destructive">*</span>
              </Label>
              {reviewersLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : reviewersError ? (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />
                  <span>{reviewersError}</span>
                </div>
              ) : (
                <Select value={reviewerName} onValueChange={setReviewerName}>
                  <SelectTrigger id="reviewer">
                    <SelectValue placeholder="Select the reviewing architect" />
                  </SelectTrigger>
                  <SelectContent>
                    {reviewers.map((r) => (
                      <SelectItem key={r.id} value={r.name}>
                        {r.name}
                        {r.role ? ` — ${r.role}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="review-date">Review date</Label>
              <Input
                id="review-date"
                type="date"
                value={reviewDate}
                onChange={(e) => setReviewDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                placeholder="Any context for this submission"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* Recommendations */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="recommendations">Reviewer recommendations</Label>
              <Link
                href="/library?pick=1"
                className="text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
              >
                Insert from library
              </Link>
            </div>
            <Textarea
              id="recommendations"
              rows={8}
              placeholder={"Paste the post-architecture-review recommendations here — numbered, bulleted or paragraphs.\n\nOnly what is written will be used. Nothing is inferred or invented."}
              value={recommendations}
              onChange={(e) => setRecommendations(e.target.value)}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Each recommendation is kept atomic with its original wording, then
              linked to threats with a quoted evidence span and a confidence
              level.
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={startPreview}
              disabled={parsing || !file || !reviewerName}
              size="lg"
            >
              {parsing && <Loader2 className="h-4 w-4 animate-spin" />}
              Continue to column mapping
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {step === 2 && preview && mapping && (
        <div className="space-y-6">
          {saved && (
            <div className="apple-card flex flex-wrap items-center gap-3 p-4">
              <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="flex-1 text-sm">
                A mapping was saved for this exact file layout — it has been
                applied. Adjust anything below before confirming.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMapping(suggested?.mapping ?? mapping)}
              >
                Use suggested instead
              </Button>
            </div>
          )}

          <div className="apple-card p-6 sm:p-8">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <h2 className="text-title">Column mapping</h2>
              <Badge variant="secondary">
                <FileSpreadsheet className="h-3 w-3" />
                {file?.name}
              </Badge>
              {preview.sheets.length > 1 && (
                <Select value={sheetName} onValueChange={setSheetName}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Sheet" />
                  </SelectTrigger>
                  <SelectContent>
                    {preview.sheets.map((s) => (
                      <SelectItem key={s.name} value={s.name}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {suggested && (
                <Badge variant="outline" className="ml-auto">
                  auto-detect confidence: {suggested.confidence}
                </Badge>
              )}
            </div>

            {suggested?.notes?.length ? (
              <ul className="mb-4 space-y-1 rounded-xl bg-muted p-3 text-xs text-muted-foreground">
                {suggested.notes.map((n, i) => (
                  <li key={i}>· {n}</li>
                ))}
              </ul>
            ) : null}

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/60 text-left">
                    <th className="px-4 py-2.5 font-medium">Platform field</th>
                    <th className="px-4 py-2.5 font-medium">Excel column</th>
                  </tr>
                </thead>
                <tbody>
                  {PLATFORM_FIELDS.map((f) => (
                    <tr
                      key={f.key}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-2.5">
                        <span className="font-medium">{f.label}</span>{" "}
                        {f.required && (
                          <Badge variant="destructive" className="ml-1">
                            required
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <Select
                          value={mapping[f.key] ?? ""}
                          onValueChange={(v) =>
                            setMappingField(f.key, v === "__none__" ? "" : v)
                          }
                        >
                          <SelectTrigger className="w-full sm:w-72">
                            <SelectValue placeholder="— Not mapped —" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">
                              — Not mapped —
                            </SelectItem>
                            {headers.map((h) => (
                              <SelectItem key={h} value={h}>
                                {h}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Column values must be the Excel header names exactly as they
              appear. Fields left unmapped show as “Not provided” in the
              register — nothing is invented.
            </p>

            <div className="mt-6 flex items-center justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button
                onClick={confirmAndSubmit}
                disabled={submitting || !mappingValid}
                size="lg"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirm &amp; process
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="apple-card flex flex-col items-center gap-4 p-12 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
          <h2 className="text-title">Processing submission…</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Parsing the workbook, splitting recommendations, mapping
            threats ↔ recommendations with quoted evidence, and ranking
            everything transparently. You&apos;ll land on the executive
            overview when it&apos;s done.
          </p>
          {submission && (
            <p className="text-sm text-muted-foreground">
              Submission #{submission.submissionId} saved.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function IntakePage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="mx-auto max-w-4xl space-y-6">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-64 w-full" />
          </div>
        }
      >
        <IntakeWizard />
      </Suspense>
    </AppShell>
  );
}
