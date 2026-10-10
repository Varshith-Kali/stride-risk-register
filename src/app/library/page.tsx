"use client";

/**
 * /library — reusable recommendation library: search, add, delete, reuse.
 * With `?pick=1`, the "Use" button redirects to intake with `?reco=<encoded>`;
 * otherwise it copies the text to the clipboard.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { BookOpen, Copy, Plus, Search, Trash2, ArrowRight } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import {
  useApi,
  PageHeader,
  LoadingState,
  ErrorState,
} from "@/components/view-helpers";
import { apiPost } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface LibraryItem {
  id: string | number;
  text: string;
  category?: string;
  approvedBy?: string;
  usageCount?: number;
  createdAt?: string;
}

// api-client shim exposes only get/post/patch/postForm; extend locally.
async function apiDeleteReq(
  url: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, { method: "DELETE" });
    const json = (await res.json().catch(() => null)) as {
      ok: boolean;
      error?: string;
    } | null;
    if (json && typeof json.ok === "boolean")
      return { ok: json.ok, error: json.error };
    return res.ok
      ? { ok: true }
      : { ok: false, error: `Delete failed (${res.status})` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

function LibraryPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pickMode = searchParams.get("pick") === "1";

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [newText, setNewText] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newApprovedBy, setNewApprovedBy] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  const url = useMemo(
    () =>
      debounced
        ? `/api/library?q=${encodeURIComponent(debounced)}`
        : "/api/library",
    [debounced],
  );
  const { data, loading, error, reload } = useApi<{
    items?: LibraryItem[];
  }>(url);

  const items = useMemo(() => data?.items ?? [], [data]);

  async function addItem() {
    if (!newText.trim()) {
      toast.error("Recommendation text is required");
      return;
    }
    setBusy(true);
    try {
      await apiPost("/api/library", {
        text: newText.trim(),
        category: newCategory.trim() || "General",
        approvedBy: newApprovedBy.trim(),
      });
      toast.success("Added to library");
      setNewText("");
      setNewCategory("");
      setNewApprovedBy("");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add item");
    } finally {
      setBusy(false);
    }
  }

  async function deleteItem(item: LibraryItem) {
    if (!window.confirm("Delete this library item?")) return;
    setBusy(true);
    const res = await apiDeleteReq(`/api/library?id=${item.id}`);
    setBusy(false);
    if (res.ok) {
      toast.success("Deleted");
      reload();
    } else {
      toast.error(res.error || "Could not delete item");
    }
  }

  function useItem(item: LibraryItem) {
    if (pickMode) {
      // Intake-page contract: the intake page reads ?reco= and pre-fills the
      // recommendations box.
      router.push(`/?reco=${encodeURIComponent(item.text)}`);
      return;
    }
    navigator.clipboard
      .writeText(item.text)
      .then(() => toast.success("Copied to clipboard"))
      .catch(() => toast.error("Could not copy to clipboard"));
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Consistency"
        title="Recommendation library"
        hint={
          pickMode
            ? "Pick a recommendation to insert into the new submission."
            : "Reviewer-approved recommendations, saved for consistency and faster future reviews."
        }
      />

      {/* Add form */}
      <div className="apple-card mb-6 p-5">
        <p className="text-eyebrow mb-4 text-muted-foreground">
          Add to library
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="md:col-span-3">
            <Label htmlFor="lib-text">Recommendation text</Label>
            <Textarea
              id="lib-text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="Paste the reviewer-approved recommendation…"
              rows={3}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="lib-category">Category</Label>
            <Input
              id="lib-category"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="General"
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="lib-approved">Approved by</Label>
            <Input
              id="lib-approved"
              value={newApprovedBy}
              onChange={(e) => setNewApprovedBy(e.target.value)}
              placeholder="Reviewer name"
              className="mt-1.5"
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={addItem}
              disabled={busy}
              className="rounded-full"
            >
              <Plus className="h-4 w-4" />
              Add item
            </Button>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="apple-card mb-5 flex items-center gap-3 p-4">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search the library…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {loading && <LoadingState rows={4} />}
      {error && !loading && <ErrorState message={error} onRetry={reload} />}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          icon={BookOpen}
          title={query ? "No matches" : "Library is empty"}
          hint={
            query
              ? "Try a different search term."
              : "Save reviewer-approved recommendations here — from the Recommendations view or the form above."
          }
        />
      )}

      {!loading && !error && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={String(item.id)} className="apple-card p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{item.category || "General"}</Badge>
                {item.approvedBy && (
                  <span className="text-xs text-muted-foreground">
                    Approved by {item.approvedBy}
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  Used {item.usageCount ?? 0}{" "}
                  {(item.usageCount ?? 0) === 1 ? "time" : "times"}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed">{item.text}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => useItem(item)}
                >
                  {pickMode ? (
                    <>
                      <ArrowRight className="h-4 w-4" />
                      Use in submission
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      Copy
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full text-destructive hover:text-destructive"
                  disabled={busy}
                  onClick={() => deleteItem(item)}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

export default function LibraryPage() {
  return (
    <Suspense fallback={<LoadingState rows={4} />}>
      <LibraryPageInner />
    </Suspense>
  );
}
