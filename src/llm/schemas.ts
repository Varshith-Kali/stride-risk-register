/**
 * Runtime validators for LLM JSON outputs.
 *
 * Every AI-derived value is shape-checked before it leaves the server:
 * malformed entries are dropped and counted (never passed through), and a
 * wholly invalid payload raises LlmError("provider") so the route returns a
 * clean 502 instead of corrupt data. This is the first half of the
 * no-hallucination guard — the second half is assertTraceable in
 * @/core/validate, which the /api/ai/map route runs after this.
 */

import { LlmError } from "@/llm/openai";
import type { ProposedLink, Confidence } from "@/core/types";

const CONFIDENCE_VALUES: ReadonlySet<string> = new Set(["High", "Medium", "Low"]);

const MAX_LINKS = 2000;
const MAX_RATIONALE_CHARS = 500;
const MAX_QUOTE_CHARS = 2000;

export interface ValidatedMapLinks {
  links: ProposedLink[];
  /** Entries dropped because they failed shape/enum/range checks. */
  dropped: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isConfidence(v: unknown): v is Confidence {
  return typeof v === "string" && CONFIDENCE_VALUES.has(v);
}

function cleanString(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/**
 * Validate the `{ links: [...] }` payload from the mapping call.
 * Drops invalid entries individually and reports how many were dropped.
 */
export function validateMapLinks(raw: unknown): ValidatedMapLinks {
  const links: ProposedLink[] = [];
  let dropped = 0;

  const arr = isRecord(raw) ? raw.links : undefined;
  if (!Array.isArray(arr)) {
    // Missing array entirely — the payload is unusable.
    throw new LlmError(
      "provider",
      "The AI returned output in an unexpected format. Please try again."
    );
  }

  for (const item of arr.slice(0, MAX_LINKS)) {
    if (!isRecord(item)) {
      dropped += 1;
      continue;
    }
    const threatRow = item.threatRow;
    const recoIndex = item.recoIndex;
    const confidence = item.confidence;
    const rationale = cleanString(item.rationale, MAX_RATIONALE_CHARS);
    const quote = cleanString(item.quote, MAX_QUOTE_CHARS);

    if (
      typeof threatRow !== "number" ||
      !Number.isInteger(threatRow) ||
      threatRow < 1 ||
      typeof recoIndex !== "number" ||
      !Number.isInteger(recoIndex) ||
      recoIndex < 0 ||
      !isConfidence(confidence) ||
      rationale === null ||
      quote === null
    ) {
      dropped += 1;
      continue;
    }

    links.push({ threatRow, recoIndex, confidence, rationale, quote });
  }

  return { links, dropped };
}

// ─── Executive summary ───────────────────────────────────────────────────────

export interface ValidatedSummary {
  summary: string;
  traceNotes: string[];
}

const MAX_SUMMARY_CHARS = 4000;
const MAX_TRACE_NOTES = 20;

export function validateSummary(raw: unknown): ValidatedSummary {
  if (!isRecord(raw)) {
    throw new LlmError(
      "provider",
      "The AI returned output in an unexpected format. Please try again."
    );
  }
  const summary = cleanString(raw.summary, MAX_SUMMARY_CHARS);
  if (summary === null) {
    throw new LlmError(
      "provider",
      "The AI returned output in an unexpected format. Please try again."
    );
  }
  const traceNotes: string[] = [];
  if (Array.isArray(raw.traceNotes)) {
    for (const n of raw.traceNotes.slice(0, MAX_TRACE_NOTES)) {
      const s = cleanString(n, 300);
      if (s !== null) traceNotes.push(s);
    }
  }
  return { summary, traceNotes };
}

// ─── Grounded Q&A ────────────────────────────────────────────────────────────

export interface ValidatedAsk {
  answer: string;
  citations: string[];
}

const MAX_ANSWER_CHARS = 6000;
const MAX_CITATIONS = 50;

export function validateAsk(raw: unknown): ValidatedAsk {
  if (!isRecord(raw)) {
    throw new LlmError(
      "provider",
      "The AI returned output in an unexpected format. Please try again."
    );
  }
  const answer = cleanString(raw.answer, MAX_ANSWER_CHARS);
  if (answer === null) {
    throw new LlmError(
      "provider",
      "The AI returned output in an unexpected format. Please try again."
    );
  }
  const citations: string[] = [];
  if (Array.isArray(raw.citations)) {
    for (const c of raw.citations.slice(0, MAX_CITATIONS)) {
      const s = cleanString(c, 20);
      if (s !== null) citations.push(s);
    }
  }
  return { answer, citations };
}
