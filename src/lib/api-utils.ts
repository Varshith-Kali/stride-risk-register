import { NextRequest, NextResponse } from "next/server";
import { validateConfig, LlmConfig } from "@/lib/llm-config";
import { LlmError } from "@/lib/stride-engine";

/** Max request body size — raised to 20 MB to allow base64-encoded image payloads.
 *  Image validation (count, size, MIME) happens inside the route handler. */
const MAX_BODY_BYTES = 20_971_520; // 20 MB

// ─── In-memory sliding-window rate limiter ────────────────────────────────────
// 20 API calls per minute per IP. Simple and dependency-free for a single-
// instance Next.js app. Does not persist across restarts (acceptable — the
// goal is abuse prevention, not forensics).
const RATE_LIMIT_WINDOW_MS   = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 20;    // per window per IP

interface RateWindow { timestamps: number[] }
const rateStore = new Map<string, RateWindow>();

// Periodic cleanup — remove windows that haven't been touched in > 10 min.
// Prevents unbounded memory growth in long-running deployments.
setInterval(() => {
  const now = Date.now();
  for (const [ip, w] of rateStore) {
    if (now - (w.timestamps.at(-1) ?? 0) > RATE_LIMIT_WINDOW_MS * 10) {
      rateStore.delete(ip);
    }
  }
}, 10 * 60_000);

/**
 * Check rate limit for the given IP.
 * Returns a 429 NextResponse if the limit is exceeded, or null if OK.
 */
export function checkRateLimit(req: NextRequest): NextResponse | null {
  // Best-effort IP extraction — works for direct clients and behind most
  // standard reverse proxies. Falls back to "unknown" (still counted).
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  const now = Date.now();
  const window = rateStore.get(ip) ?? { timestamps: [] };

  // Evict timestamps outside the current window
  window.timestamps = window.timestamps.filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );

  if (window.timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateStore.set(ip, window);
    return NextResponse.json(
      {
        error: `Rate limit exceeded. Maximum ${RATE_LIMIT_MAX_REQUESTS} requests per minute.`,
        retryAfter: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)),
          "X-RateLimit-Limit": String(RATE_LIMIT_MAX_REQUESTS),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  window.timestamps.push(now);
  rateStore.set(ip, window);
  return null; // OK — not rate limited
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely parse a JSON request body with size and content-type guards.
 * Returns `{ ok: false, error }` on any failure, or `{ ok: true, data, config }`
 * where `config` is the validated LlmConfig (null if not present).
 *
 * Usage:
 *   const parsed = await readJsonRequest(req);
 *   if (!parsed.ok) return parsed.error;
 *   const { data, config } = parsed;
 */
export async function readJsonRequest<T = unknown>(
  req: NextRequest
): Promise<
  | { ok: true; data: T; config: LlmConfig | null }
  | { ok: false; error: NextResponse }
> {
  // Content-Type check — reject non-JSON to prevent content sniffing.
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: "Content-Type must be application/json." },
        { status: 415 }
      ),
    };
  }

  // Read body as text and enforce size limit.
  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return {
      ok: false,
      error: NextResponse.json(
        { error: "Failed to read request body." },
        { status: 400 }
      ),
    };
  }

  if (bodyText.length > MAX_BODY_BYTES) {
    return {
      ok: false,
      error: NextResponse.json(
        { error: "Request body too large (max 20 MB)." },
        { status: 413 }
      ),
    };
  }

  // Parse JSON.
  let data: unknown;
  try {
    data = JSON.parse(bodyText);
  } catch {
    return {
      ok: false,
      error: NextResponse.json(
        { error: "Invalid JSON in request body." },
        { status: 400 }
      ),
    };
  }

  // Validate the LLM config if present.
  const config = validateConfig(
    data !== null && typeof data === "object" ? (data as Record<string, unknown>).config : undefined
  );
  // Note: config may legitimately be null if not provided; routes that need
  // a config should check `if (!config) return error`.

  return { ok: true, data: data as T, config };
}

/**
 * Standard error response for a missing or invalid LLM config.
 * 401 — the request lacks valid credentials/configuration.
 */
export function configRequiredError(): NextResponse {
  return NextResponse.json(
    {
      error:
        "LLM provider not configured. Open Settings and enter your OpenAI API key.",
    },
    { status: 401 }
  );
}


/**
 * Wrap a handler with structured error handling.
 *
 * SECURITY: Never expose raw exception messages or stack traces to the client.
 *
 * - LlmError: deliberately user-facing (geo-block, invalid-key, rate-limit,
 *   timeout, provider). These are safe to surface because they contain only
 *   provider guidance, not server internals.
 * - All other errors: return a generic "Internal server error" message.
 *   The full error is logged server-side for debugging.
 * - requestId: a random UUID per error response. Lets users report issues
 *   precisely without exposing stack traces or file paths.
 */
export function handleError(e: unknown): NextResponse {
  const requestId = crypto.randomUUID();
  console.error(`[api] error [${requestId}]:`, e);

  if (e instanceof LlmError) {
    // LlmError messages are intentionally user-facing.
    return NextResponse.json(
      { error: e.message, requestId },
      { status: 502 }
    );
  }

  // Never leak internal error messages, file paths, or stack traces.
  return NextResponse.json(
    { error: "Internal server error. Please try again.", requestId },
    { status: 500 }
  );
}
