/**
 * POST /api/ai/summary — AI executive summary over the register KPIs.
 *
 * Request:  { config, kpis: {totalThreats, criticalHighCount,
 *             withReviewerResponse, unmappedThreats, unmappedRecommendations,
 *             coveragePct}, topThreats: [{ref,title,risk}] }
 * Response: { summary, traceNotes }
 *
 * The prompt forces every sentence to be traceable to a supplied number;
 * traceNotes records which number each sentence relies on.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  readJsonRequest,
  handleError,
  configRequiredError,
} from "@/lib/api-utils";
import { callJsonApi } from "@/llm/openai";
import {
  SUMMARY_SYSTEM,
  buildSummaryPrompt,
  type SummaryKpis,
  type SummaryThreat,
} from "@/llm/prompts";
import { validateSummary } from "@/llm/schemas";

export const runtime = "nodejs";
export const maxDuration = 120;

// Reasoning models (gpt-5.5) spend output tokens on hidden reasoning before
// emitting visible JSON. A small budget is exhausted mid-reasoning and the
// Responses API returns status "incomplete" with no content. Budget well above
// STRIDE GPT's base so reasoning plus the executive summary both fit.
const MAX_TOKENS_SUMMARY = 12288;
const MAX_TOP_THREATS = 50;

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function sanitizeKpis(raw: unknown): SummaryKpis {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    totalThreats: numOrNull(r.totalThreats),
    criticalHighCount: numOrNull(r.criticalHighCount),
    withReviewerResponse: numOrNull(r.withReviewerResponse),
    unmappedThreats: numOrNull(r.unmappedThreats),
    unmappedRecommendations: numOrNull(r.unmappedRecommendations),
    coveragePct: numOrNull(r.coveragePct),
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const limited = checkRateLimit(req);
  if (limited) return limited;

  try {
    const parsed = await readJsonRequest<{
      kpis: unknown;
      topThreats: unknown;
    }>(req);
    if (!parsed.ok) return parsed.error;
    const config = parsed.config;
    if (!config) return configRequiredError();

    const kpis = sanitizeKpis(parsed.data.kpis);

    let topThreats: SummaryThreat[] = [];
    if (Array.isArray(parsed.data.topThreats)) {
      topThreats = parsed.data.topThreats
        .slice(0, MAX_TOP_THREATS)
        .filter(
          (t): t is SummaryThreat =>
            !!t &&
            typeof t === "object" &&
            typeof (t as SummaryThreat).title === "string"
        );
    }

    const prompt = buildSummaryPrompt(kpis, topThreats);
    const raw = await callJsonApi(config, {
      instructions: SUMMARY_SYSTEM,
      input: prompt,
      maxTokens: MAX_TOKENS_SUMMARY,
    });
    const { summary, traceNotes } = validateSummary(raw);

    return NextResponse.json({ ok: true, data: { summary, traceNotes } });
  } catch (e) {
    return handleError(e);
  }
}
