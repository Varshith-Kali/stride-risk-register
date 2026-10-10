# STRIDE Risk Register & Visibility Platform

A governed, ranked, visual risk register for the ISG (Information Security
Group) Security Architecture team. It starts where **STRIDE GPT** ends:
STRIDE GPT performs threat modelling and exports an Excel file — this platform
ingests that export plus the architecture reviewer's recommendations and turns
them into a traceable, reviewer-accountable portfolio of risk.

## Relation to STRIDE GPT

- **Same product suite, same stack.** STRIDE GPT is Next.js 16 + React 19 +
  TypeScript + Tailwind v4 + shadcn/ui (the master prompt assumed
  Streamlit/Python, but the actual STRIDE GPT repo is Next.js — "same stack as
  STRIDE GPT" resolves to this Next.js stack). This repo reuses its theme
  tokens, layout conventions, session-only OpenAI key pattern, and OOXML
  writer style so both tools feel like one product.
- **Same data contract.** The intake expects the real STRIDE GPT export: a
  single `STRIDE` sheet with the 7 columns
  `S.No | STRIDE Category | Threat Description | MITRE ATT&CK Mapping | Risk Level | Existing Controls | Safety Metrics`
  (verified against the STRIDE GPT source, not its README). Schema drift is
  handled by a column-mapping preview step, not by guessing.
- **Same LLM engine pattern.** OpenAI Responses API, model `gpt-5.5`
  (server-side allowlist), temperature 0.1, structured JSON-schema outputs,
  plus a no-hallucination post-check that every AI link traces to the input.

## Quickstart

```bash
npm install
npm run dev        # serves on :3001
```

Open http://localhost:3001, enter your OpenAI API key in the dialog (top
bar), and start a **New Submission**: upload the STRIDE GPT `.xlsx`, pick a
reviewer, paste recommendations, Process.

## OpenAI API key (session-only)

- The key is entered in the in-app dialog and kept in **React state only** —
  never `localStorage`, never the DB, never a file, never logs.
- Every AI request carries the key in the JSON body; the server validates it
  with `validateConfig()` (provider `openai`, model allowlist `gpt-5.5`) and
  calls `https://api.openai.com/v1/responses` **server-side**. The browser
  never talks to OpenAI directly.
- **AI features (threat↔recommendation mapping, executive summary, grounded
  Q&A) require a key.** Everything else — upload, parsing, ranking, register,
  charts, workflow, exports — works fully offline.

## Configuration

- `config/reviewers.yaml` — the reviewer roster for the mandatory reviewer
  dropdown (seeded with Varshith Puli and Prathamesh Mohite). Add up to ~15
  reviewers here; the app seeds/syncs the `reviewers` table from this file on
  startup. Never remove a reviewer with history — set `active: false`.
- Database: SQLite via `node:sqlite` (zero native deps). Default location is
  `./data/risk-register.db` (created on first run); override with the
  `RISK_REGISTER_DB_PATH` env var. Migrations run automatically on first use.

## Data handling & security

- **No secrets in the repo.** API keys are session-only; the DB holds
  operational data (threats, recommendations, audit trail), never keys.
- **Server-side LLM only** (see above). No data is sent to any provider other
  than the configured OpenAI endpoint; optional local-model support is
  roadmap, not implemented.
- **File validation:** uploads must be `.xlsx` (content-type + `PK\x03\x04`
  ZIP signature), ≤ 10 MiB, ≤ 50 sheets, ≤ 200k cells, uncompressed ≤ 100 MiB
  (zip-bomb check). Malformed files get clear errors, never a crash.
- **Input sanitisation** on all text fields (trim, collapse whitespace, strip
  control chars, 20k-char cap); API routes enforce rate limits
  (`checkRateLimit`) and a strict response envelope
  (`{ ok: true, data }` / `{ ok: false, error, requestId }`).
- **No-hallucination rule:** every AI-derived link carries a rationale, an
  exact source quote, a confidence level, and a source label
  (`From Excel` / `From Reviewer` / `AI-inferred link`). A post-check rejects
  any link whose quote is not a substring of the source text. Missing data
  renders as **"Not provided"** — never invented. See `docs/ARCHITECTURE.md`.

## Testing

```bash
npm test                  # vitest run (node env)
npx vitest run tests/ooxml.test.ts   # single file
node tests/fixtures/make-fixture.mjs # regenerate the sample xlsx fixture
npm run type-check         # tsc --noEmit
npm run lint               # eslint
```

Pure core logic (`src/core/*`) is covered by vitest, including the
no-hallucination guard: a recommendation unrelated to any threat stays
unmapped, and `assertTraceable` throws on fabricated links. The fixture
(`tests/fixtures/sample-threat-model.xlsx`) mirrors the real STRIDE GPT
schema — 12 threat rows, all 6 STRIDE categories, all 4 risk levels, one empty
Risk Level, one blank row, plus a junk `Notes` sheet the parser must ignore.

## Deployment notes

- Standard Next.js deployment (`npm run build` / `npm start -p 3001`) behind a
  reverse proxy. Example Caddyfile-style shape:

  ```
  risk-register.example.com {
      reverse_proxy 127.0.0.1:3001
  }
  ```

- **SQLite persistence caveat:** `node:sqlite` is single-instance file
  storage. Run exactly one app instance per DB file, keep `data/` on a
  persistent volume, and back up `risk-register.db` on a schedule. The data
  layer (`src/db/index.ts`) exposes small typed helpers precisely so a future
  Postgres move keeps the same signatures and swaps only the driver.
- Set `RISK_REGISTER_DB_PATH` if the default `./data` location does not suit
  the host. Never commit the DB file.
- **Reverse-proxy requirement:** the app must run behind a proxy that
  overwrites `X-Forwarded-For` with the real client IP (Caddy does this by
  default). Rate limiting keys off that header; a direct `next start`
  deployment would let clients spoof it and rotate rate-limit identities.
- **Trust model:** the app has no login by design — it is built for a trusted
  internal network. Do not expose it to the internet without an authentication
  gate (e.g. HTTP Basic Auth or SSO at the reverse proxy). Every caller has
  full read/write power; the audit log records who did what (self-attested
  names), but cannot prevent misuse.

## Limitations

- **SQLite is single-instance** — no multi-writer horizontal scaling; see the
  Postgres path above.
- **English-only parsing heuristics** for recommendation splitting and
  owner/priority/timeline extraction; other languages split on blank lines
  but explicit extraction may miss.
- **AI features need an OpenAI key** (session-only); without it, threat↔
  recommendation links must be created manually.
- Charts use **recharts** (React-native), not Plotly — the master prompt's
  Plotly assumption was Python-flavoured; recharts fits the Next.js stack.
- Compliance tagging, reviewer Q&A, and digest generation are specced in
  `docs/ARCHITECTURE.md`; AI-suggested items are always tagged
  "AI Suggestion, Unverified" and kept separate from the factual register.
