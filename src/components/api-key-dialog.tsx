"use client";

import { useState } from "react";
import { KeyRound, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { aiConfig, useApiKey } from "@/hooks/use-api-key";
import { apiPost } from "@/lib/api-client";

/**
 * Agent D — session OpenAI key entry.
 *
 * Password input; "Save for this session" keeps the key in React state only
 * (never persisted anywhere). "Test connection" POSTs to /api/ai/test with
 * `{ config }` — the route may not exist yet (Agent B); a 404 renders as a
 * graceful "service not deployed yet" note instead of a crash.
 */
export function ApiKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { apiKey, setApiKey, model, hasKey } = useApiKey();
  const [draft, setDraft] = useState("");
  const [testing, setTesting] = useState(false);
  const [testState, setTestState] = useState<
    { ok: true; message: string } | { ok: false; message: string } | null
  >(null);

  const effectiveKey = draft.trim() || apiKey;

  function save() {
    if (!effectiveKey) return;
    setApiKey(effectiveKey);
    setDraft("");
    setTestState({
      ok: true,
      message: "Key saved for this browser session only.",
    });
  }

  async function testConnection() {
    if (!effectiveKey) {
      setTestState({ ok: false, message: "Enter a key first." });
      return;
    }
    setTesting(true);
    setTestState(null);
    try {
      await apiPost<{ ok: boolean }>("/api/ai/test", {
        config: aiConfig(effectiveKey, model),
      });
      setTestState({
        ok: true,
        message: "Connection succeeded — the key works.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Test failed";
      // Agent B's route may not be deployed yet — say so explicitly.
      if (/404|not found/i.test(msg)) {
        setTestState({
          ok: false,
          message:
            "AI service is not deployed yet (route not found). The key is still saved for this session.",
        });
      } else {
        setTestState({ ok: false, message: msg });
      }
    } finally {
      setTesting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            OpenAI API key
          </DialogTitle>
          <DialogDescription>
            Required only for AI features (link mapping, executive summary,
            register Q&amp;A). The key stays in this page&apos;s memory and is
            cleared when you close the tab — it is never stored on the server
            or in any file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="api-key-input">API key</Label>
            <Input
              id="api-key-input"
              type="password"
              autoComplete="off"
              placeholder={hasKey ? "•••••••• (key already set)" : "sk-..."}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
            />
            <p className="text-xs text-muted-foreground">
              Model: <span className="font-mono">{model}</span> · Requests go
              directly to OpenAI from the server; no other provider receives
              your data.
            </p>
          </div>

          {testState && (
            <div
              className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                testState.ok
                  ? "border-[#16a34a]/30 bg-[#16a34a]/5 text-foreground"
                  : "border-destructive/30 bg-destructive/5 text-foreground"
              }`}
            >
              {testState.ok ? (
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#16a34a]" />
              ) : (
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              )}
              <span>{testState.message}</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={testConnection}
            disabled={testing || !effectiveKey}
          >
            {testing && <Loader2 className="h-4 w-4 animate-spin" />}
            Test connection
          </Button>
          <Button onClick={save} disabled={!effectiveKey}>
            Save for this session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
