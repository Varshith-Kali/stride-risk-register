"use client";

/**
 * Shared data-fetching + page chrome helpers for Agent E views.
 */

import { useCallback, useEffect, useRef, useState } from "react";
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
  const [loading, setLoading] = useState<boolean>(!!url);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;

  const reload = useCallback(() => {
    const u = urlRef.current;
    if (!u) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGet<T>(u).then(
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
  }, []);

  useEffect(() => {
    const cleanup = reload();
    return cleanup;
  }, [reload, url]);

  return { data, loading, error, reload };
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
  actions?: React.ReactNode;
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
