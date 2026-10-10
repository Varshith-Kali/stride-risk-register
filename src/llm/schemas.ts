/**
 * Runtime validators for LLM JSON outputs.
 *
 * The single AI call (condense) is shape-checked before its narrative leaves
 * the server: malformed array entries are dropped (never passed through), and a
 * wholly invalid payload raises LlmError("provider") so the route returns a
 * clean 502 instead of corrupt data. Deterministic numbers (posture, counts)
 * are never AI-derived, so they are not validated here.
 */

import { LlmError } from "@/llm/openai";

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function cleanString(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

// ─── Condensed review ─────────────────────────────────────────────────────────

export interface ValidatedCondense {
  headline: string;
  observations: string[];
  keyRecommendations: string[];
}

const MAX_HEADLINE_CHARS = 400;
const MAX_OBSERVATION_CHARS = 600;
const MAX_RECO_CHARS = 600;
const MAX_OBSERVATIONS = 12;
const MAX_KEY_RECOS = 12;

/**
 * Validate the `{ headline, observations[], keyRecommendations[] }` payload.
 * A non-record payload or a missing/empty headline is unusable → throw.
 * Bad array items are dropped individually (never passed through).
 */
export function validateCondense(raw: unknown): ValidatedCondense {
  if (!isRecord(raw)) {
    throw new LlmError(
      "provider",
      "The AI returned output in an unexpected format. Please try again."
    );
  }
  const headline = cleanString(raw.headline, MAX_HEADLINE_CHARS);
  if (headline === null) {
    throw new LlmError(
      "provider",
      "The AI returned output in an unexpected format. Please try again."
    );
  }

  const observations: string[] = [];
  if (Array.isArray(raw.observations)) {
    for (const o of raw.observations.slice(0, MAX_OBSERVATIONS)) {
      const s = cleanString(o, MAX_OBSERVATION_CHARS);
      if (s !== null) observations.push(s);
    }
  }

  const keyRecommendations: string[] = [];
  if (Array.isArray(raw.keyRecommendations)) {
    for (const r of raw.keyRecommendations.slice(0, MAX_KEY_RECOS)) {
      const s = cleanString(r, MAX_RECO_CHARS);
      if (s !== null) keyRecommendations.push(s);
    }
  }

  return { headline, observations, keyRecommendations };
}
