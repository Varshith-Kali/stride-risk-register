/**
 * POST /api/ai/map — propose threat ⇄ recommendation links.
 *
 * Request:  { config, threats: [{row,title,description,stride,risk}],
 *             recos: [{index,text}] }
 * Response: { links: ProposedLink[], filtered: number, truncated: boolean }
 *
 * Pipeline: sanitize → chunk threats (40 per LLM call) → prompt → Responses
 * API → shape validation → traceability check (assertTraceable, per link) →
 * merge + dedupe. Links failing any check are dropped and counted in
 * `filtered`. Unmapped threats/recommendations are left unmapped — the
 * register labels them "No Reviewer Response" / "Unmapped Recommendation".
 */

import { NextRequest, NextResponse } from "next/server";
import {
  checkRateLimit,
  readJsonRequest,
  handleError,
  configRequiredError,
} from "@/lib/api-utils";
import { callJsonApi, sanitizeForPrompt } from "@/llm/openai";
import {
  MAP_SYSTEM,
  buildMapPrompt,
  type MapThreatInput,
  type MapRecoInput,
} from "@/llm/prompts";
import { validateMapLinks } from "@/llm/schemas";
import { assertTraceable } from "@/core/validate";
import type { ProposedLink } from "@/core/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Threats sent to the LLM per call — keeps prompts inside the budget. */
const THREATS_PER_CALL = 40;
const MAX_THREATS = 500;
const MAX_RECOS = 200;
const MAX_TOKENS_MAP = 8192; // mirrors STRIDE GPT's RECOMMENDATIONS budget

interface MapRequestBody {
  threats: unknown;
  recos: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function sanitizeThreat(raw: unknown): MapThreatInput | null {
  if (!isRecord(raw)) return null;
  const row = raw.row;
  if (typeof row !== "number" || !Number.isInteger(row) || row < 1) return null;
  return {
    row,
    title: sanitizeForPrompt(raw.title, 300),
    description: sanitizeForPrompt(raw.description, 2000),
    stride: sanitizeForPrompt(raw.stride, 40),
    risk: sanitizeForPrompt(raw.risk, 20),
  };
}

function sanitizeReco(raw: unknown, fallbackIndex: number): MapRecoInput | null {
  if (!isRecord(raw)) return null;
  const text = sanitizeForPrompt(raw.text, 5000);
  if (!text) return null;
  const idx = raw.index;
  const index =
    typeof idx === "number" && Number.isInteger(idx) && idx >= 0
      ? idx
      : fallbackIndex;
  return { index, text };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const limited = checkRateLimit(req);
  if (limited) return limited;

  try {
    const parsed = await readJsonRequest<MapRequestBody>(req);
    if (!parsed.ok) return parsed.error;
    const config = parsed.config;
    if (!config) return configRequiredError();
    const { threats: rawThreats, recos: rawRecos } = parsed.data;

    if (!Array.isArray(rawThreats) || rawThreats.length === 0) {
      return NextResponse.json(
        { error: "threats must be a non-empty array." },
        { status: 400 }
      );
    }
    if (!Array.isArray(rawRecos) || rawRecos.length === 0) {
      return NextResponse.json(
        { error: "recos must be a non-empty array." },
        { status: 400 }
      );
    }
    if (rawThreats.length > MAX_THREATS || rawRecos.length > MAX_RECOS) {
      return NextResponse.json(
        {
          error: `Too many items for one request (max ${MAX_THREATS} threats, ${MAX_RECOS} recommendations).`,
        },
        { status: 400 }
      );
    }

    const threats: MapThreatInput[] = [];
    for (const t of rawThreats) {
      const s = sanitizeThreat(t);
      if (s) threats.push(s);
    }
    const recos: MapRecoInput[] = [];
    rawRecos.forEach((r, i) => {
      const s = sanitizeReco(r, i);
      if (s) recos.push(s);
    });

    if (threats.length === 0 || recos.length === 0) {
      return NextResponse.json(
        { error: "No valid threats or recommendations after sanitization." },
        { status: 400 }
      );
    }

    // Chunk threats so every LLM call stays inside the prompt budget.
    // The builder's truncated flag (e.g. recos > 40/call) is surfaced so the
    // UI can warn that some input was not considered.
    let truncated = false;
    let shapeDropped = 0;
    const candidates: ProposedLink[] = [];

    for (let i = 0; i < threats.length; i += THREATS_PER_CALL) {
      const chunk = threats.slice(i, i + THREATS_PER_CALL);
      const { prompt, truncated: chunkTruncated } = buildMapPrompt(chunk, recos);
      truncated = truncated || chunkTruncated;

      const raw = await callJsonApi(config, {
        instructions: MAP_SYSTEM,
        input: prompt,
        maxTokens: MAX_TOKENS_MAP,
      });
      const { links, dropped } = validateMapLinks(raw);
      shapeDropped += dropped;
      candidates.push(...links);
    }

    // Dedupe identical (threatRow, recoIndex) pairs across chunks.
    const seen = new Set<string>();
    const deduped: ProposedLink[] = [];
    for (const l of candidates) {
      const key = `${l.threatRow}:${l.recoIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(l);
    }

    // Traceability guard: every link's quote must appear verbatim in the
    // source text. Failures are dropped and counted — never passed through.
    // Per-link invocation so one bad link cannot sink the whole batch.
    // (Cast to assertTraceable's parameter types: Agent A owns validate.ts,
    //  and the route holds the sanitized subset of threat/reco text.)
    type TraceThreats = Parameters<typeof assertTraceable>[1];
    type TraceRecos = Parameters<typeof assertTraceable>[2];
    const traceThreats = threats.map((t) => ({
      row: t.row,
      title: t.title,
      description: t.description,
    })) as unknown as TraceThreats;
    const traceRecos = recos.map((r) => ({
      index: r.index,
      text: r.text,
    })) as unknown as TraceRecos;

    const links: ProposedLink[] = [];
    let traceFiltered = 0;
    for (const link of deduped) {
      try {
        assertTraceable([link], traceThreats, traceRecos);
        links.push(link);
      } catch {
        traceFiltered += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        links,
        filtered: shapeDropped + traceFiltered,
        truncated,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
