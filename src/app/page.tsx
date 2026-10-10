"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Sparkles,
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
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiPostForm } from "@/lib/api-client";
import { aiConfig, useApiKey } from "@/hooks/use-api-key";
import type { Reviewer, SubmissionResult } from "@/lib/dto";

/**
 * Intake wizard ("/").
 *
 * Step 1: upload the STRIDE GPT .xlsx export, enter submission metadata
 * (project, mandatory reviewer, review date, notes) and paste the reviewer's
 * recommendations. Columns are auto-detected — no mapping step.
 * Step 2: processing — one AI call condenses the review, then we redirect to
 * /dashboard?review=<id>.
 */

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function localToday(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function StepHeader({ step }: { step: number }) {
  const steps = ["Upload & metadata", "Processing"];
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

// APPEND_MARKER

function IntakeWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(1);

  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [reviewDate, setReviewDate] = useState(localToday());
  const [notes, setNotes] = useState("");
  const [recommendations, setRecommendations] = useState(
    () => searchParams.get("reco") ?? "",
  );
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [reviewersLoading, setReviewersLoading] = useState(true);
  const [reviewersError, setReviewersError] = useState<string | null>(null);
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

  async function submit() {
    if (!file) {
      toast.error("Upload the STRIDE GPT .xlsx export first.");
      return;
    }
    if (!reviewerName) {
      toast.error("Reviewer selection is mandatory.");
      return;
    }
    setSubmitting(true);
    setStep(2);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("projectName", projectName.trim());
      fd.append("reviewerName", reviewerName);
      fd.append("reviewDate", reviewDate);
      fd.append("notes", notes);
      fd.append("recommendationsText", recommendations);
      // AI config travels only in this request body — never persisted. Omitted
      // when no session key is set → the review is condensed deterministically.
      if (apiKey) {
        fd.append("config", JSON.stringify(aiConfig(apiKey, model)));
      }
      const data = await apiPostForm<SubmissionResult>("/api/submissions", fd);
      setSubmission(data);
      data.warnings.forEach((w) => toast.warning(w, { duration: 6000 }));
      toast.success(
        `Review condensed: ${data.threatCount} threats, ${data.recoCount} recommendations.`,
      );
      if (!apiKey) {
        toast.info(
          "Tip: set your OpenAI API key (top bar) to generate AI observations for each review.",
          { duration: 8000 },
        );
      }
      router.push(`/dashboard?review=${data.submissionId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submission failed");
      setStep(1);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <p className="text-eyebrow text-muted-foreground">New submission</p>
        <h1 className="text-headline tracking-tight">
          From threat model to a condensed review
        </h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Upload a STRIDE GPT Excel export, choose the reviewer, paste their
          post-review recommendations — the platform auto-detects the columns
          and condenses everything into one high-level, reviewer-tagged review
          on the dashboard.
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
                .xlsx only · max 10 MB · columns are auto-detected
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
            <Label htmlFor="recommendations">Reviewer recommendations</Label>
            <Textarea
              id="recommendations"
              rows={8}
              placeholder={"Paste the post-architecture-review recommendations here — numbered, bulleted or paragraphs.\n\nThey are clubbed into a few high-level key recommendations. Nothing is invented."}
              value={recommendations}
              onChange={(e) => setRecommendations(e.target.value)}
              className="font-mono text-sm"
            />
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              {apiKey
                ? "One AI call condenses this review into grounded observations and key recommendations."
                : "No API key set — the review will be stored with its risk posture only (no AI observations)."}
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={submit}
              disabled={submitting || !file || !reviewerName}
              size="lg"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Condense &amp; save review
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="apple-card flex flex-col items-center gap-4 p-12 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
          <h2 className="text-title">Condensing review…</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Parsing the workbook, computing the risk posture, and condensing the
            threats and recommendations into one high-level review. You&apos;ll
            land on the dashboard when it&apos;s done.
          </p>
          {submission && (
            <p className="text-sm text-muted-foreground">
              Review #{submission.submissionId} saved.
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
