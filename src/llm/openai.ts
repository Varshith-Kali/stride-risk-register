/**
 * OpenAI Responses API transport — JSON-only calls.
 *
 * Mirrors the transport conventions of STRIDE GPT's stride-engine.ts:
 *   - POST https://api.openai.com/v1/responses, server-side only
 *   - system instruction in the top-level `instructions` field
 *     (never a role:"system" item inside `input`)
 *   - text.format json_object, store:false, no temperature parameter
 *     (reasoning model; determinism via JSON mode + prompt rules)
 *   - 120 s AbortController timeout
 *
 * The API key is never logged, persisted, or returned to the client.
 */

import type { LlmConfig } from "@/lib/llm-config";

export type LlmErrorKind =
  | "invalid-key"
  | "rate-limit"
  | "timeout"
  | "provider"
  | "network";

export class LlmError extends Error {
  kind: LlmErrorKind;
  status?: number;

  constructor(kind: LlmErrorKind, message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    this.status = status;
  }
}

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const LLM_TIMEOUT_MS = 120_000;
const MAX_LOG_CHARS = 2000;

export interface CallJsonApiOpts {
  instructions: string;
  input: string;
  maxTokens: number;
}

/**
 * Strip control characters and normalize whitespace for safe prompt
 * insertion, then cap the length. Mirrors the spirit of STRIDE GPT's
 * validation.ts (sanitizeText): keep \n and \t, drop the rest.
 */
export function sanitizeForPrompt(s: unknown, maxLen: number): string {
  if (typeof s !== "string") return "";
  // Strip control characters except \n and \t (mirrors STRIDE GPT validation.ts).
  let out = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  out = out.replace(/[^\S\n]+/g, " "); // collapse horizontal runs, keep newlines
  out = out.replace(/\n{3,}/g, "\n\n");
  out = out.trim();
  return out.length > maxLen ? out.slice(0, maxLen) : out;
}

/**
 * Call the Responses API and return the parsed JSON body.
 * One retry only, on timeout/network failures — never on 4xx or parse errors.
 */
export async function callJsonApi(
  config: LlmConfig,
  opts: CallJsonApiOpts
): Promise<unknown> {
  let attempt = 0;
  for (;;) {
    try {
      return await callOnce(config, opts);
    } catch (e) {
      const retryable =
        e instanceof LlmError &&
        (e.kind === "timeout" || e.kind === "network");
      if (retryable && attempt === 0) {
        attempt += 1;
        continue;
      }
      throw e;
    }
  }
}

async function callOnce(
  config: LlmConfig,
  opts: CallJsonApiOpts
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        instructions: opts.instructions,
        // Mirror STRIDE GPT's proven request shape: the user turn travels as a
        // messages array inside `input`, never as a bare string or a
        // role:"system" item (the Responses API rejects system items in input).
        input: [{ role: "user", content: opts.input }],
        text: { format: { type: "json_object" } },
        store: false,
        max_output_tokens: opts.maxTokens,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof Error && e.name === "AbortError") {
      throw new LlmError(
        "timeout",
        "The AI request timed out after 120 seconds. Please try again."
      );
    }
    throw new LlmError(
      "network",
      "Could not reach the AI provider. Check your network connection and try again."
    );
  }
  clearTimeout(timer);

  if (!res.ok) {
    throw await classifyHttpError(res);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new LlmError(
      "provider",
      "The AI provider returned an unreadable response. Please try again."
    );
  }

  assertComplete(data);

  const text = extractText(data);
  return parseJsonStrict(text);
}

/**
 * Reasoning models (e.g. gpt-5.5) spend output tokens on hidden reasoning
 * before emitting any visible text. If `max_output_tokens` is exhausted during
 * that phase the Responses API returns HTTP 200 with status "incomplete" and
 * no message content — which would otherwise surface as a misleading "empty
 * response". Detect it explicitly and tell the caller the real cause.
 */
function assertComplete(data: unknown): void {
  const root = data as
    | { status?: unknown; incomplete_details?: { reason?: unknown } }
    | null;
  if (root?.status !== "incomplete") return;
  const reason = root.incomplete_details?.reason;
  if (reason === "max_output_tokens") {
    throw new LlmError(
      "provider",
      "The AI used its entire output budget on reasoning before returning an answer. Please try again."
    );
  }
  throw new LlmError(
    "provider",
    "The AI did not finish generating a response. Please try again."
  );
}

/**
 * Lightweight connectivity probe used by POST /api/ai/test.
 *
 * Verifies three things with a single minimal request:
 *   (a) the API key is valid and authorized,
 *   (b) the selected model is accessible to this key,
 *   (c) the provider is reachable within the timeout.
 *
 * Crucially it does NOT request json_object output and does NOT parse the
 * model's text — exactly like STRIDE GPT's test-connection route, which only
 * checks `res.ok`. A reasoning model that spends its tiny token budget on
 * reasoning still returns HTTP 200, so the probe passes as long as auth and
 * model access are valid. Requiring parseable JSON here (the previous bug)
 * made the probe fail with "empty response" for every valid key.
 *
 * Resolves on success; throws a typed LlmError on any failure.
 */
export async function pingConnection(config: LlmConfig): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  let res: Response;
  try {
    res = await fetch(RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        input: [{ role: "user", content: "ping" }],
        max_output_tokens: 16,
        store: false,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof Error && e.name === "AbortError") {
      throw new LlmError(
        "timeout",
        "The connection test timed out. Please try again."
      );
    }
    throw new LlmError(
      "network",
      "Could not reach the AI provider. Check your network connection and try again."
    );
  }
  clearTimeout(timer);

  // Only connectivity + auth + model access matter here. A 200 with an
  // incomplete/empty body (reasoning consumed the token budget) is a PASS.
  if (!res.ok) {
    throw await classifyHttpError(res);
  }
}

/** Classify a non-2xx Responses API response into an LlmError kind. */
async function classifyHttpError(res: Response): Promise<LlmError> {
  const status = res.status;
  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch {
    bodyText = "";
  }

  if (status === 401) {
    return new LlmError(
      "invalid-key",
      "The API key was rejected by the provider (invalid or revoked). Check the key and try again.",
      status
    );
  }
  if (status === 403) {
    return new LlmError(
      "invalid-key",
      "Access denied (403). This API key is not authorized for the selected model. Check your OpenAI organization/project settings.",
      status
    );
  }
  if (status === 404) {
    return new LlmError(
      "provider",
      "The selected model was not found (404). Ensure the model is provisioned for this API key.",
      status
    );
  }
  if (status === 429) {
    return new LlmError(
      "rate-limit",
      "The AI provider rate-limited this request. Wait a moment and try again.",
      status
    );
  }
  if (status === 400 && /content_filter/i.test(bodyText)) {
    return new LlmError(
      "provider",
      "The provider declined to process this content. Adjust the input and try again.",
      status
    );
  }
  if (status >= 500) {
    return new LlmError(
      "provider",
      "The AI provider is experiencing problems. Please try again shortly.",
      status
    );
  }
  return new LlmError(
    "provider",
    "The AI provider returned an error. Please try again.",
    status
  );
}

/**
 * Walk the Responses API `output` array and extract the model's text,
 * skipping reasoning items. Accepts content[].text / .transcript,
 * item.text, and plain-string content — the four shapes seen in the wild.
 */
function extractText(data: unknown): string {
  const root = data as { output?: unknown } | null;
  const output = root?.output;
  if (!Array.isArray(output)) {
    throw new LlmError(
      "provider",
      "The AI provider returned an unexpected response shape. Please try again."
    );
  }

  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const it = item as {
      type?: string;
      text?: unknown;
      content?: unknown;
      refusal?: unknown;
    };
    if (it.type === "reasoning") continue;
    if (typeof it.refusal === "string" && it.refusal) {
      throw new LlmError(
        "provider",
        "The AI provider refused to answer this request."
      );
    }
    if (typeof it.text === "string" && it.text) {
      parts.push(it.text);
      continue;
    }
    const content = it.content;
    if (Array.isArray(content)) {
      for (const c of content) {
        if (typeof c === "string") {
          if (c) parts.push(c);
          continue;
        }
        if (c && typeof c === "object") {
          const part = c as { text?: unknown; transcript?: unknown; refusal?: unknown };
          if (typeof part.refusal === "string" && part.refusal) {
            throw new LlmError(
              "provider",
              "The AI provider refused to answer this request."
            );
          }
          if (typeof part.text === "string" && part.text) parts.push(part.text);
          else if (typeof part.transcript === "string" && part.transcript)
            parts.push(part.transcript);
        }
      }
    } else if (typeof content === "string" && content) {
      parts.push(content);
    }
  }

  const text = parts.join("").trim();
  if (!text) {
    throw new LlmError(
      "provider",
      "The AI provider returned an empty response. Please try again."
    );
  }
  return text;
}

/**
 * Parse the model's JSON text. One fence-strip attempt, then fail loudly:
 * log the raw response server-side (sliced) for diagnosis — never to client.
 */
function parseJsonStrict(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Single lenient attempt: strip markdown fences if the model added them.
    const stripped = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    if (stripped !== text) {
      try {
        return JSON.parse(stripped);
      } catch {
        // fall through to the logged failure below
      }
    }
    console.error(
      "[llm] JSON parse failure; raw response (sliced):",
      text.slice(0, MAX_LOG_CHARS)
    );
    throw new LlmError(
      "provider",
      "The AI returned output in an unexpected format. Please try again."
    );
  }
}
