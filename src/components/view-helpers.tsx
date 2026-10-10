"use client";

/**
 * Shared data-fetching + page chrome helpers for Agent E views.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Fetch-on-mount hook over the api-client envelope. */
export function useApi<T>(url: string | null): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(url !== null);
  const [error, setError] = useState<string | null>(null);

  // Mount / URL-change fetch. State updates happen only in promise
  // continuations (never synchronously in the effect body), per
  // react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    apiGet<T>(url).then(
      (payload) => {
        if (cancelled) return;
        setData(payload ?? null);
        setError(null);
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Request failed");
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Manual refresh for event handlers (buttons): spinner first, then refetch.
  const refresh = useCallback(() => {
    if (!url) return;
    setLoading(true);
    setError(null);
    apiGet<T>(url).then(
      (payload) => {
        setData(payload ?? null);
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err instanceof Error ? err.message : "Request failed");
        setLoading(false);
      },
    );
  }, [url]);

  return { data, loading, error, reload: refresh };
}

/** Standard page header: eyebrow + title + optional actions. */
export function PageHeader({
  eyebrow,
  title,
  hint,
  actions,
}: {
  eyebrow: string;
  title: string;
  hint?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-eyebrow text-muted-foreground">{eyebrow}</p>
        <h1 className="text-headline mt-1">{title}</h1>
        {hint && (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{hint}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Loading skeleton block for cards/tables. */
export function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div className="apple-card space-y-3 p-6">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-xl" />
      ))}
    </div>
  );
}

/** Error block with retry. */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="apple-card flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10">
        <AlertTriangle className="h-6 w-6 text-destructive" />
      </div>
      <p className="text-title">Couldn&apos;t load this view</p>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{message}</p>
      <Button onClick={onRetry} variant="outline" className="mt-5 rounded-full">
        Try again
      </Button>
    </div>
  );
}
