/**
 * POST /api/ai/ask — grounded Q&A over the risk register.
 *
 * Request:  { config, question, context }
 *   - context: compact JSON of threats / recommendations / links
 *     (capped at 30k chars before it reaches the prompt).
 * Response: { answer, citations }
 *
 * The prompt restricts the model to the supplied context and requires
 * threat-ref citations ([T-003] style) for factual claims.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  readJsonRequest,
  handleError,
  configRequiredError,
} from "@/lib/api-utils";
import { callJsonApi, sanitizeForPrompt } from "@/llm/openai";
import { ASK_SYSTEM, buildAskPrompt } from "@/llm/prompts";
import { validateAsk } from "@/llm/schemas";

export const runtime = "nodejs";
export const maxDuration = 120;

// Reasoning models (gpt-5.5) spend output tokens on hidden reasoning before
// emitting visible JSON; too small a budget is exhausted mid-reasoning and
// returns an incomplete, empty response. This platform answers free-form
// questions over a large register context, so budget well above STRIDE GPT's
// base to leave room for reasoning plus a full answer.
const MAX_TOKENS_ASK = 16384;
const MAX_CONTEXT_CHARS = 30_000;
const MAX_QUESTION_CHARS = 2000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const limited = checkRateLimit(req);
  if (limited) return limited;

  try {
    const parsed = await readJsonRequest<{
      question: unknown;
      context: unknown;
    }>(req);
    if (!parsed.ok) return parsed.error;
    const config = parsed.config;
    if (!config) return configRequiredError();

    const question = sanitizeForPrompt(parsed.data.question, MAX_QUESTION_CHARS);
    if (!question) {
      return NextResponse.json(
        { error: "question must be a non-empty string." },
        { status: 400 }
      );
    }

    // Compact the register context and hard-cap it so the prompt budget holds.
    let contextJson: string;
    try {
      contextJson = JSON.stringify(parsed.data.context ?? {});
    } catch {
      contextJson = "{}";
    }
    if (contextJson.length > MAX_CONTEXT_CHARS) {
      contextJson = contextJson.slice(0, MAX_CONTEXT_CHARS);
    }

    const prompt = buildAskPrompt(question, contextJson);
    const raw = await callJsonApi(config, {
      instructions: ASK_SYSTEM,
      input: prompt,
      maxTokens: MAX_TOKENS_ASK,
    });
    const { answer, citations } = validateAsk(raw);

    return NextResponse.json({ ok: true, data: { answer, citations } });
  } catch (e) {
    return handleError(e);
  }
}
