/**
 * LLM system prompts and prompt builders.
 *
 * This platform makes EXACTLY ONE AI call per upload: the "condense" call,
 * which clubs a review's raw threat rows + recommendations into a short,
 * grounded, high-level review record. Everything else (risk posture, STRIDE
 * counts, totals) is computed deterministically in code — never asked of the
 * model.
 *
 * Style mirrors STRIDE GPT's stride-engine.ts:
 *   - a professional system instruction (top-level `instructions` field),
 *   - compact line-based context blocks (not prose) to keep token costs low,
 *   - the prompt ends with "Return ONLY a JSON object ..." plus an inline
 *     schema sketch (json_object mode never returns a bare array).
 *
 * No-hallucination rule (product-critical): the prompt forbids inventing
 * threats, recommendations, scores, owners, dates or counts. Observations must
 * derive from the supplied threats; key recommendations must come from the
 * supplied recommendations.
 */

import { sanitizeForPrompt } from "@/llm/openai";

// ─── Condensed review (the single AI call) ───────────────────────────────────

export const CONDENSE_SYSTEM =
  "You are a security architecture analyst condensing one threat-model review " +
  "for a shared observability dashboard. Produce a short, high-level summary " +
  "grounded STRICTLY in the threats and recommendations provided. Never invent " +
  "threats, recommendations, controls, standards, owners, dates or numbers. Do " +
  "not output counts or scores — those are computed separately.";

export interface CondenseThreatInput {
  title: string;
  description: string;
  stride: string;
  risk: string;
  component: string;
}

export interface CondenseRecoInput {
  index: number; // 1-based recommendation index
  text: string;
}

/** Input budgets for the single condense call (keeps the prompt in budget). */
export const MAX_CONDENSE_THREATS = 50;
export const MAX_CONDENSE_RECOS = 60;

const CONDENSE_RULES = [
  "Rules:",
  "- headline: ONE sentence (max ~160 chars) describing the overall security posture of THIS review, grounded in the threats below.",
  "- observations: 3–6 short bullets capturing the most important high-level findings across the threats. Group/club related threats rather than listing them one by one. Each bullet derives from the threats shown below.",
  "- keyRecommendations: club the reviewer recommendations below into 3–6 high-level action items. Preserve their meaning; do not invent new recommendations. If no recommendations are provided, return an empty array.",
  "- Use ONLY the input below. Never invent threats, recommendations, scores, owners, dates, controls, or standards.",
  "- Do NOT include any counts, totals, percentages or numeric scores — those are computed separately.",
].join("\n");

const CONDENSE_SHAPE =
  "Return ONLY a JSON object (no prose, no markdown fences) with this exact shape:\n" +
  '{ "headline": "...", "observations": ["..."], "keyRecommendations": ["..."] }';

/**
 * Build the condense prompt from the (already capped by the caller) top
 * threats and recommendations. The caller feeds the top ~50 threats by rank
 * score; deterministic counts are computed over the FULL set, not here.
 */
export function buildCondensePrompt(
  threats: CondenseThreatInput[],
  recos: CondenseRecoInput[]
): string {
  const threatLines = threats
    .slice(0, MAX_CONDENSE_THREATS)
    .map((t) => {
      const title = sanitizeForPrompt(t.title, 200);
      const desc = sanitizeForPrompt(t.description, 300);
      const stride = sanitizeForPrompt(t.stride, 40) || "Not provided";
      const risk = sanitizeForPrompt(t.risk, 20) || "Not provided";
      const component = sanitizeForPrompt(t.component, 120);
      const head = `- [${stride} | ${risk}]${component ? " (" + component + ")" : ""} ${title}`;
      return desc ? `${head} — ${desc}` : head;
    })
    .join("\n");

  const recoLines = recos
    .slice(0, MAX_CONDENSE_RECOS)
    .map((r) => `- R${r.index}: ${sanitizeForPrompt(r.text, 500)}`)
    .join("\n");

  return [
    "Condense this threat-model review into a short, high-level summary.",
    "",
    "THREATS (from the STRIDE threat-model Excel export, highest-risk first):",
    threatLines || "(none provided)",
    "",
    "REVIEWER RECOMMENDATIONS:",
    recoLines || "(none provided)",
    "",
    CONDENSE_RULES,
    "",
    CONDENSE_SHAPE,
  ].join("\n");
}
