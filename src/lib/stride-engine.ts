/**
 * Compatibility shim: the scaffolded `lib/api-utils.ts` imports LlmError from
 * "@/lib/stride-engine" (carried over from STRIDE GPT's layout). In this
 * codebase the LLM transport lives in `llm/openai.ts`, so this module simply
 * re-exports it — guaranteeing that `instanceof LlmError` checks in
 * handleError() see the exact same class the AI routes throw.
 *
 * Do not add STRIDE GPT's full stride-engine here; it is intentionally out of
 * scope for the risk register platform.
 */

export { LlmError } from "@/llm/openai";
export type { LlmErrorKind } from "@/llm/openai";
