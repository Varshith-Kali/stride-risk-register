"use client";

/**
 * Agent D — session-only OpenAI API key store (canonical version).
 *
 * The key lives in React state ONLY: it is never written to localStorage,
 * cookies, the DB, or any file. Every AI route receives it in the request
 * body as `{ config: { provider: "openai", apiKey, model } }` and the page
 * session losing it on refresh is the intended behaviour.
 */

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export const AI_MODEL = "gpt-5.5";

interface ApiKeyContextValue {
  /** Raw session key (empty string when not set). */
  apiKey: string;
  /** Replace the session key (trims whitespace). */
  setApiKey: (key: string) => void;
  /** Fixed model identifier sent to AI routes. */
  model: string;
  /** True once a non-empty key has been saved for this session. */
  hasKey: boolean;
}

const ApiKeyContext = createContext<ApiKeyContextValue | null>(null);

export function ApiKeyProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKeyState] = useState("");
  const setApiKey = useCallback(
    (key: string) => setApiKeyState(key.trim()),
    [],
  );
  return (
    <ApiKeyContext.Provider
      value={{ apiKey, setApiKey, model: AI_MODEL, hasKey: apiKey.length > 0 }}
    >
      {children}
    </ApiKeyContext.Provider>
  );
}

export function useApiKey(): ApiKeyContextValue {
  const ctx = useContext(ApiKeyContext);
  if (!ctx) {
    // Defensive fallback so pages render even outside the provider.
    return {
      apiKey: "",
      setApiKey: () => {},
      model: AI_MODEL,
      hasKey: false,
    };
  }
  return ctx;
}

/** Body shape every AI route expects for provider auth (BUILD_SPEC.md §0). */
export function aiConfig(apiKey: string, model: string = AI_MODEL) {
  return { provider: "openai" as const, apiKey, model };
}
