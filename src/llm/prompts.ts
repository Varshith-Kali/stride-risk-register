/**
 * LLM system prompts and prompt builders.
 *
 * Style mirrors STRIDE GPT's stride-engine.ts:
 *   - a professional system instruction (top-level `instructions` field),
 *   - compact line-based context blocks (not prose) to keep token costs low,
 *   - every user prompt ends with "Return ONLY a JSON object ..." plus an
 *     inline schema sketch using literal enum pipes,
 *   - the API root is always an object with a named key (json_object mode
 *     never returns a bare array).
 *
 * No-hallucination rule (product-critical): prompts forbid inventing
 * threats, recommendations, scores, owners or dates, and require every
 * mapping link to quote the exact source text span.
 */

import { sanitizeForPrompt } from "@/llm/openai";

// ─── Threat ⇄ Recommendation mapping ─────────────────────────────────────────

export const MAP_SYSTEM =
  "You are a security architecture analyst. Map reviewer recommendations to " +
  "threats using ONLY the provided input. Never invent threats, " +
  "recommendations, scores, owners or dates. Every link must quote the exact " +
  "source text span.";

export interface MapThreatInput {
  row: number; // 1-based Excel row (header = row 1)
  title: string;
  description: string;
  stride: string;
  risk: string;
}

export interface MapRecoInput {
  index: number; // 0-based recommendation index
  text: string;
}

/** Per-call input budgets for the mapping prompt. */
export const MAX_MAP_THREATS_PER_CALL = 60;
export const MAX_MAP_RECOS_PER_CALL = 40;

const MAP_RULES = [
  "Rules:",
  "- A recommendation may link to multiple threats, and a threat may link to multiple recommendations (many-to-many).",
  "- confidence must be exactly one of: High | Medium | Low.",
  "- rationale is ONE sentence explaining why the recommendation addresses the threat.",
  "- quote must be an EXACT substring of the recommendation text or the threat text shown below. Copy it verbatim — do not paraphrase, shorten, or clean it up.",
  "- If a recommendation cannot be tied to any threat, OMIT it entirely (do not force a link).",
  "- If a threat has no matching recommendation, OMIT it entirely (do not invent one).",
  "- Use ONLY the input below. Never invent threats, recommendations, scores, owners, dates, controls, or standards.",
].join("\n");

const MAP_SHAPE =
  'Return ONLY a JSON object (no prose, no markdown fences) with this exact shape:\n' +
  '{ "links": [{ "threatRow": 0, "recoIndex": 0, "confidence": "High | Medium | Low", "rationale": "...", "quote": "..." }] }';

/**
 * Build the mapping prompt. Returns the prompt text plus a flag indicating
 * whether the input exceeded the per-call budget (caller decides how to
 * chunk; see the /api/ai/map route).
 */
export function buildMapPrompt(
  threats: MapThreatInput[],
  recos: MapRecoInput[]
): { prompt: string; truncated: boolean } {
  const truncated =
    threats.length > MAX_MAP_THREATS_PER_CALL ||
    recos.length > MAX_MAP_RECOS_PER_CALL;

  const threatLines = threats
    .slice(0, MAX_MAP_THREATS_PER_CALL)
    .map((t) => {
      const row = Number.isInteger(t.row) ? t.row : 0;
      const title = sanitizeForPrompt(t.title, 300);
      const desc = sanitizeForPrompt(t.description, 300);
      const stride = sanitizeForPrompt(t.stride, 40) || "Not provided";
      const risk = sanitizeForPrompt(t.risk, 20) || "Not provided";
      return `- T${row} [${stride} | ${risk}] ${title}${desc ? " — " + desc : ""}`;
    })
    .join("\n");

  const recoLines = recos
    .slice(0, MAX_MAP_RECOS_PER_CALL)
    .map((r) => `- R${r.index}: ${sanitizeForPrompt(r.text, 500)}`)
    .join("\n");

  const prompt = [
    "Map each reviewer recommendation to the threat(s) it addresses.",
    "",
    "THREATS (from the STRIDE threat-model Excel export):",
    threatLines || "(none)",
    "",
    "RECOMMENDATIONS (from the architecture reviewer):",
    recoLines || "(none)",
    "",
    MAP_RULES,
    "",
    MAP_SHAPE,
  ].join("\n");

  return { prompt, truncated };
}

// ─── Executive summary ───────────────────────────────────────────────────────

export const SUMMARY_SYSTEM =
  "You are a security architecture analyst writing for executives. " +
  "Summarize ONLY what the numbers below state. Never invent threats, dates, " +
  "owners, controls, or trends that are not in the input.";

export interface SummaryKpis {
  totalThreats: number | null;
  criticalHighCount: number | null;
  withReviewerResponse: number | null;
  unmappedThreats: number | null;
  unmappedRecommendations: number | null;
  coveragePct: number | null;
}

export interface SummaryThreat {
  ref: string;
  title: string;
  risk: string;
}

const MAX_SUMMARY_THREATS = 15;

const SUMMARY_RULES = [
  "Rules:",
  "- Write a 5–8 sentence executive summary grounded STRICTLY in the numbers below.",
  "- Every sentence must be traceable to a number below. If a number is missing, write 'Not provided' for that fact.",
  "- Do not offer recommendations, mitigations, or next steps beyond what the data states.",
  "- traceNotes: one short note per summary sentence naming the number it relies on, e.g. 'Sentence 1 uses TOTAL_THREATS=24 and CRITICAL_HIGH=7'.",
].join("\n");

const SUMMARY_SHAPE =
  'Return ONLY a JSON object (no prose, no markdown fences) with this exact shape:\n' +
  '{ "summary": "...", "traceNotes": ["..."] }';

function fmtNum(v: number | null): string {
  return v === null || v === undefined || Number.isNaN(v) ? "Not provided" : String(v);
}

export function buildSummaryPrompt(
  kpis: SummaryKpis,
  topThreats: SummaryThreat[]
): string {
  const kpiLines = [
    `TOTAL_THREATS=${fmtNum(kpis.totalThreats)}`,
    `CRITICAL_HIGH=${fmtNum(kpis.criticalHighCount)}`,
    `WITH_REVIEWER_RESPONSE=${fmtNum(kpis.withReviewerResponse)}`,
    `UNMAPPED_THREATS=${fmtNum(kpis.unmappedThreats)}`,
    `UNMAPPED_RECOMMENDATIONS=${fmtNum(kpis.unmappedRecommendations)}`,
    `COVERAGE_PCT=${fmtNum(kpis.coveragePct)}`,
  ].join("\n");

  const threatLines = topThreats
    .slice(0, MAX_SUMMARY_THREATS)
    .map((t) => {
      const ref = sanitizeForPrompt(t.ref, 20) || "Not provided";
      const title = sanitizeForPrompt(t.title, 120);
      const risk = sanitizeForPrompt(t.risk, 20) || "Not provided";
      return `- ${ref} [${risk}] ${title}`;
    })
    .join("\n");

  return [
    "Write an executive summary of this risk register snapshot.",
    "",
    "REGISTER NUMBERS:",
    kpiLines,
    "",
    "TOP-RANKED THREATS (by rank):",
    threatLines || "(none provided)",
    "",
    SUMMARY_RULES,
    "",
    SUMMARY_SHAPE,
  ].join("\n");
}

// ─── Grounded Q&A over the register ──────────────────────────────────────────

export const ASK_SYSTEM =
  "You are a security architecture analyst answering questions about a risk " +
  "register. Answer ONLY from the register context provided. Cite threat refs " +
  "like [T-003] for every factual claim. If the answer is not in the context, " +
  "say so plainly — never invent data.";

const ASK_RULES = [
  "Rules:",
  "- Answer ONLY from the REGISTER CONTEXT below. If the answer is not in the context, say 'Not in the provided context.'",
  "- Cite the threat ref (e.g. [T-003]) for every factual claim about a threat.",
  "- Never invent threats, recommendations, scores, owners, dates, or statuses.",
  "- citations: list every threat ref cited in the answer (e.g. [\"T-003\"]). Empty array if none.",
].join("\n");

const ASK_SHAPE =
  'Return ONLY a JSON object (no prose, no markdown fences) with this exact shape:\n' +
  '{ "answer": "...", "citations": ["T-003"] }';

/**
 * Build the Q&A prompt. The context JSON is capped server-side by the route;
 * the builder sanitizes the question and assembles the final prompt.
 */
export function buildAskPrompt(question: string, contextJson: string): string {
  const q = sanitizeForPrompt(question, 2000);
  return [
    `QUESTION: ${q}`,
    "",
    "REGISTER CONTEXT (threats, recommendations, and their links):",
    contextJson,
    "",
    ASK_RULES,
    "",
    ASK_SHAPE,
  ].join("\n");
}
