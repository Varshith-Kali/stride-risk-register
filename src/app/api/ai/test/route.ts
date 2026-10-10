/**
 * POST /api/ai/test — connectivity probe for the configured LLM.
 *
 * Request:  { config }
 * Response: { ok: true }  (or { ok:false } via handleError on failure)
 *
 * Mirrors STRIDE GPT's test-connection route: a minimal request that verifies
 * key validity, model access, and reachability by checking the HTTP status
 * only — it never requires parseable JSON output. Requiring a parsed
 * `{ ok: true }` from a 16-token reasoning-model response (the previous bug)
 * failed every valid key with a misleading "empty response" error, because
 * reasoning models spend that budget before emitting any visible text.
 *
 * The API key is used only for this request and never logged or stored.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  readJsonRequest,
  handleError,
  configRequiredError,
} from "@/lib/api-utils";
import { pingConnection } from "@/llm/openai";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const limited = checkRateLimit(req);
  if (limited) return limited;

  try {
    const parsed = await readJsonRequest(req);
    if (!parsed.ok) return parsed.error;
    const config = parsed.config;
    if (!config) return configRequiredError();

    await pingConnection(config);

    return NextResponse.json({ ok: true, data: { ok: true } });
  } catch (e) {
    return handleError(e);
  }
}
