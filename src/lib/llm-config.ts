/**
 * LLM provider configuration — OpenAI only.
 *
 * This application calls the OpenAI Responses API directly from server-side
 * API routes using the user-provided API key. The key is held in session
 * memory only (never persisted) and travels exclusively within the encrypted
 * HTTPS request body.
 *
 * Endpoint: POST https://api.openai.com/v1/responses
 * Auth:     Authorization: Bearer <key>
 */

export type Provider = "openai";

export interface LlmConfig {
  provider: Provider;
  apiKey: string;
  model: string;
}

export interface ProviderModel {
  id: string;
  label: string;
  note: string;
}

export const PROVIDER_MODELS: Record<Provider, ProviderModel[]> = {
  openai: [
    {
      id: "gpt-5.5",
      label: "GPT-5.5",
      note: "Latest · Internal enterprise model",
    },
  ],
};

export const DEFAULT_MODEL: Record<Provider, string> = {
  openai: "gpt-5.5",
};

/**
 * Allowlist of valid model IDs. Validated server-side so a compromised client
 * cannot make the server call arbitrary model strings.
 */
export const ALLOWED_MODELS: Record<Provider, ReadonlySet<string>> = {
  openai: new Set(PROVIDER_MODELS.openai.map((m) => m.id)),
};

export function isConfigured(c: LlmConfig | null | undefined): c is LlmConfig {
  return !!c && !!c.apiKey && !!c.provider && !!c.model;
}

/**
 * Validates a config object received from the client. Returns the typed
 * config if valid, or null. Rejects unknown providers, models not in the
 * allowlist, or malformed API keys.
 */
export function validateConfig(raw: unknown): LlmConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<LlmConfig>;
  if (c.provider !== "openai") return null;
  if (typeof c.apiKey !== "string" || c.apiKey.trim().length < 10) return null;
  if (typeof c.model !== "string") return null;
  if (!ALLOWED_MODELS[c.provider].has(c.model)) return null;
  return {
    provider: c.provider,
    apiKey: c.apiKey.trim(),
    model: c.model,
  };
}
