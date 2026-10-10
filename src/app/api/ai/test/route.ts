/**
 * POST /api/ai/test — connectivity probe for the configured LLM.
 *
 * Request:  { config }
 * Response: { ok: true }  (or { ok:false } via handleError on failure)
 *
 * Mirrors STRIDE GPT's test-connection route: a tiny maxTokens: 16 JSON call.
 * The API key is used only for this request and never logged or stored.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  readJsonRequest,
  handleError,
  configRequiredError,
} from "@/lib/api-utils";
import { callJsonApi, LlmError } from "@/llm/openai";

export const runtime = "nodejs";
export const maxDuration = 120;

const TEST_SYSTEM =
  "You are a connectivity probe. Reply with exactly the JSON object requested.";
const TEST_INPUT =
  'Return ONLY a JSON object (no prose, no markdown fences) with this exact shape:\n{ "ok": true }';

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const limited = checkRateLimit(req);
  if (limited) return limited;

  try {
    const parsed = await readJsonRequest(req);
    if (!parsed.ok) return parsed.error;
    const config = parsed.config;
    if (!config) return configRequiredError();

    const raw = await callJsonApi(config, {
      instructions: TEST_SYSTEM,
      input: TEST_INPUT,
      maxTokens: 16,
    });

    if (!isRecord(raw) || raw.ok !== true) {
      throw new LlmError(
        "provider",
        "The AI provider returned an unexpected response. Please try again."
      );
    }

    return NextResponse.json({ ok: true, data: { ok: true } });
  } catch (e) {
    return handleError(e);
  }
}
