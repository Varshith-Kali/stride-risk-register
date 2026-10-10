/**
 * The single AI call this platform makes: condense one review's threats +
 * recommendations into a short grounded narrative. Deterministic numbers are
 * computed in @/core/condense and never pass through here.
 */
import { callJsonApi } from "@/llm/openai";
import type { LlmConfig } from "@/lib/llm-config";
import {
  CONDENSE_SYSTEM,
  buildCondensePrompt,
  type CondenseThreatInput,
  type CondenseRecoInput,
} from "@/llm/prompts";
import { validateCondense, type ValidatedCondense } from "@/llm/schemas";

// Reasoning models (gpt-5.5) spend output tokens on hidden reasoning before
// emitting the visible JSON. Budget well above the narrative size so reasoning
// plus the condensed summary both fit; a small budget returns an incomplete,
// empty response.
const MAX_TOKENS_CONDENSE = 12288;

export async function condenseReview(
  config: LlmConfig,
  threats: CondenseThreatInput[],
  recos: CondenseRecoInput[]
): Promise<ValidatedCondense> {
  const input = buildCondensePrompt(threats, recos);
  const raw = await callJsonApi(config, {
    instructions: CONDENSE_SYSTEM,
    input,
    maxTokens: MAX_TOKENS_CONDENSE,
  });
  return validateCondense(raw);
}
