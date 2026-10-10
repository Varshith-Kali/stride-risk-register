/**
 * Agent D — typed fetch helpers over the `{ ok, data, error }` API envelope.
 *
 * All server routes return `{ ok: true, data }` on success and
 * `{ ok: false, error, requestId }` on failure (BUILD_SPEC.md §3).
 * These helpers unwrap the envelope and throw a plain `Error` on failure so
 * callers can rely on try/catch + sonner toasts. This is the canonical
 * Agent D version (throw-on-error); it replaces the non-throwing shim.
 */

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
  requestId?: string;
}

async function unwrap<T>(res: Response): Promise<T> {
  let json: ApiEnvelope<T>;
  try {
    json = (await res.json()) as ApiEnvelope<T>;
  } catch {
    throw new Error(`Request failed (HTTP ${res.status})`);
  }
  if (!json.ok) {
    const detail = json.requestId ? ` [${json.requestId}]` : "";
    throw new Error(
      `${json.error ?? `Request failed (HTTP ${res.status})`}${detail}`,
    );
  }
  return json.data as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "GET" });
  return unwrap<T>(res);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap<T>(res);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap<T>(res);
}

export async function apiPostForm<T>(
  path: string,
  formData: FormData,
): Promise<T> {
  const res = await fetch(path, { method: "POST", body: formData });
  return unwrap<T>(res);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "DELETE" });
  return unwrap<T>(res);
}

/** GET with query params built from a plain object (skips empty values). */
export async function apiGetQuery<T>(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "" || v === null) continue;
    qs.set(k, String(v));
  }
  const url = qs.toString() ? `${path}?${qs}` : path;
  return apiGet<T>(url);
}
