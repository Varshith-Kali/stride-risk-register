# Architecture — STRIDE Risk Register & Visibility Platform

Durable architecture record. Adapted from `~/workspace/stride-study/BUILD_SPEC.md`
(the build spec); where the spec and this doc disagree, this doc wins after the
code lands. Status notes below mark what exists vs. what the spec assigns to
other agents — check `git log` before quoting either.

## 1. Stack

| Layer        | Choice | Why |
|---|---|---|
| Framework    | Next.js 16 + React 19 + TypeScript (strict) | **Same stack as STRIDE GPT** — the actual repo, not the master prompt's Streamlit/Python assumption. Theme, components, and LLM patterns are directly reusable. |
| Styling      | Tailwind CSS v4 + shadcn/ui (Radix) + lucide-react | Same component library as STRIDE GPT; monochrome Apple-inspired light theme. |
| Charts       | recharts | React-native charting. Plotly.js is the Python-ecosystem default the master prompt named; recharts is the correct call inside a Next.js 16 + React 19 app (SSR-friendly, composable, no heavy imperative wrapper). |
| Database     | SQLite via `node:sqlite` (zero native deps) | Phase-1 persistence per spec; file DB, WAL mode, auto-migrations. SQLAlchemy was the prompt's assumption — `node:sqlite` is the same-stack answer. |
| LLM          | OpenAI Responses API, `gpt-5.5`, temperature 0.1 | Mirrors STRIDE GPT's transport (`stride-engine.ts`); server-side allowlist, session-only key. The prompt's "multi-provider abstraction" is aspirational — STRIDE GPT is OpenAI-only and so is this. |
| Tests        | vitest (node env) | Pure core logic is dependency-free and testable in node. |

### Why Next.js, not Streamlit

The master prompt asked for "the same stack as STRIDE GPT" and assumed
Python/Streamlit. The STRIDE GPT study (see `~/workspace/stride-study/`) found
the real repo is **Next.js 16 + React 19 + TypeScript**. Rebuilding in
Streamlit would have broken theme parity (the prompt's own hard requirement),
the session-only key dialog, the OOXML writer, and the component reuse the
study checklist calls out. Same-stack resolves to Next.js.

### Why recharts, not Plotly

Plotly is named in the prompt alongside the Streamlit assumption. In this
stack, recharts gives declarative React components, small bundle cost, and
clean SSR — Plotly.js would need a client-only imperative wrapper and ships a
far heavier runtime for the same bar/donut/treemap views.

## 2. Theme parity decisions

STRIDE GPT's identity is a monochrome Apple-inspired light theme. Parity is
enforced by convention (BUILD_SPEC §0), not by a theme provider:

- Use **only** the tokens/utilities in `src/app/globals.css`:
  `bg-background`, `text-foreground`, `border-border`, `bg-card`,
  `text-muted-foreground`, `bg-muted`, `bg-primary`, `text-primary-foreground`,
  `bg-secondary`, `bg-accent`, `text-destructive`, `bg-destructive`,
  `ring-ring`, chart vars `--chart-1..5`.
- Utility classes: `.apple-card`, `.text-eyebrow`, `.text-title`,
  `.text-display`, `.text-headline`, `.navbar-solid`, `.tabbar-solid`,
  `.fade-in`, `.no-scrollbar`.
- Fonts: Inter (sans) + JetBrains Mono (mono) via `next/font` — already in
  layout. **No ThemeProvider** — STRIDE GPT is light-only; keep parity.
- **No emojis in UI** (lucide icons only).
- Domain addition (not in STRIDE GPT): risk-level colors, used consistently
  everywhere — Critical `#dc2626`, High `#ea580c`, Medium `#ca8a04`, Low
  `#16a34a` (`RISK_COLORS` + `riskBadgeVariant()` in `src/lib/risk.ts`).
- CSP nonce via `proxy.ts` (same pattern as STRIDE GPT).

## 3. System architecture

```
 Browser (React 19)
   │  intake wizard → mapping preview → dashboard / register / views
   │  API key lives in React state only (useApiKey), sent in AI request bodies
   ▼
 Next.js route handlers (src/app/api/*)
   ├─ ingest: multipart xlsx → src/core (parse) → SQLite
   ├─ reads:  dashboard / threats / timeline / portfolio / scorecard / audit
   ├─ writes: status / links / overrides / library  (+ audit rows, human-only)
   └─ AI:     /api/ai/{map,summary,ask,test} → OpenAI Responses API (server-side)
               every response post-validated by src/core/validate.ts
   ▼
 src/core/*  (pure, zero-LLM, vitest-covered)
   ooxml → columns → excel → recommendations → ranking → validate → sanitize
   ▼
 src/db/*  (node:sqlite; all SQL behind typed helpers in db/index.ts)
   data/risk-register.db  (override: RISK_REGISTER_DB_PATH)
```

Key flows:

- **Ingest** (`POST /api/submissions`, multipart): validate file → `readWorkbook`
  → `suggestMapping` (+ remembered fingerprint) → user confirms mapping →
  `parseThreats` + `parseRecommendations` → atomic transaction (project,
  reviewer, submission version = max+1, threats, recos, audit). Optional
  `POST /api/ai/map` proposes threat↔recommendation links; reviewer
  accepts/rejects/re-links each (human-in-the-loop, decisions stored).
- **Read**: `GET /api/dashboard` returns KPIs + all chart aggregates in one
  call; register/timeline/portfolio/scorecard are thin filtered reads.
- **Governance writes**: statuses are set by humans only
  (`PATCH /api/threats/[id]` validates the status enum; Accepted Risk requires
  a `accepted_risks` row with justification + approver + expiry); every change
  writes `status_history` + `audit_log`.

## 4. Database schema (SQLite; `src/db/schema.ts` is the source of truth)

```
reviewers ──< submissions >── projects
   │              │
   │              ├─< threats ──< links >── recommendations
   │              │     │            │
   │              │     ├─< status_history
   │              │     └─< accepted_risks
   │              └─< recommendations
   │
   ├─< recommendation_library   (reviewer-approved, reusable recos)
   ├─< column_mappings          (fingerprint → confirmed ColumnMapping)
   └─< audit_log                 (who changed what, when, why)
```

Tables (all `CREATE TABLE IF NOT EXISTS`, migrated automatically):

- `reviewers(id, name UNIQUE, role, active)` — seeded/synced from
  `config/reviewers.yaml` on every init; history is never deleted.
- `projects(id, name UNIQUE, …)`; `submissions(id, project_id, reviewer_id,
  version, review_date, notes, created_at)` — re-uploading a revised Excel for
  the same project creates a new version; diffs compare versions.
- `threats(id, submission_id, sheet, row, ref, title, description, stride,
  component, mitre, risk, existing_controls, safety_metrics, severity_score,
  status, priority_override, …)` — `sheet`+`row` = Excel provenance.
- `recommendations(id, submission_id, idx, text, owner, priority, timeline,
  status)` — owner/priority/timeline only when explicitly stated.
- `links(id, threat_id, recommendation_id, confidence, rationale, quote,
  source_label, decision, decided_by, …)` — `source_label ∈ {From Excel,
  From Reviewer, AI-inferred link}`.
- `status_history`, `audit_log(entity, entity_id, actor, action, before,
  after, reason, at)`, `accepted_risks(threat_id, justification, approver,
  expiry_date)`, `recommendation_library`, `column_mappings(fingerprint,
  mapping_json)`.

Postgres path: route handlers use only the typed helpers in `src/db/index.ts`
(`all/get/run/transaction/audit`, `listActiveReviewers`, `ensureReviewer`);
a future move keeps those signatures and swaps the driver.

## 5. API inventory (defined by BUILD_SPEC; routes land with the data/UI agents)

Envelope: `{ ok: true, data }` / `{ ok: false, error, requestId }`.

- `GET /api/reviewers` — active reviewers.
- `POST /api/ingest/preview` (multipart `file`) — sheets, headers, sample
  rows, `suggestedMapping`, remembered mapping.
- `POST /api/submissions` (multipart) — creates versioned submission.
- `GET /api/submissions[?project=&reviewer=]`, `GET /api/submissions/[id]`,
  `GET /api/submissions/[id]/diff?compareTo=`.
- `GET /api/threats?…` (submissionId/status/risk/stride/q), `PATCH
  /api/threats/[id]`, `PATCH /api/recommendations/[id]`,
  `PATCH /api/links/[id]`, `POST /api/links` (manual link).
- `GET /api/dashboard` (KPIs + chart aggregates), `/api/timeline`,
  `/api/portfolio`, `/api/patterns`, `/api/scorecard`, `/api/audit`.
- `GET /api/export/register?submissionId=` (xlsx via self-contained
  `src/core/ooxml-write.ts`), `GET /api/export/audit-pack?submissionId=`.
- `POST /api/ai/map|summary|ask|test` — **require the session OpenAI key**;
  map/summary/ask are post-validated by `src/core/validate.ts`.

## 6. No-hallucination design (product-critical)

1. **Traceability by construction.** Every `ParsedThreat` stores `sheet` +
   `row` (1-based Excel row). Every `ProposedLink` stores `rationale`
   (one sentence), `quote` (exact source span), `confidence`
   (High/Medium/Low), `source_label`. Recommendations keep original wording.
2. **Post-validation.** `assertTraceable()` (src/core/validate.ts) throws if
   any link's quote is not a case-insensitive substring of the linked
   recommendation or threat text, or if a link dangles off a non-existent
   row/index. AI routes run this before returning.
3. **"Not provided", never invented.** Missing severity/DREAD/owner/due date
   renders literally as "Not provided". Ranking with no risk input says so in
   its explanation ("ranked by STRIDE category order only").
4. **Unmapped is visible.** Threats with no recommendation → "No Reviewer
   Response"; recommendations matching no threat → "Unmapped Recommendation".
   `findUnmapped()` powers the coverage-gap views. Links are never forced.
5. **Human-in-the-loop.** Statuses, priority overrides (mandatory reason),
   and link accept/reject are human-only and audit-logged. AI suggestions
   beyond the input (compliance tags, extra mitigations) are tagged
   **"AI Suggestion, Unverified"** and separated from the factual register.

## 7. Security model

- **Credentials:** session-only OpenAI key (React state; never localStorage,
  DB, files, or logs). Server validates via `validateConfig()` — provider
  allowlist, key length, model allowlist (`gpt-5.5`). Temperature 0.1,
  90s timeout, 2 retries; provider errors mapped to `LlmError`.
- **Transport:** browser ↔ app only; the browser never calls OpenAI (CSP
  `connect-src 'self'`, nonce via `proxy.ts`).
- **Uploads:** content-type + ZIP-signature check, ≤ 10 MiB, ≤ 50 sheets,
  ≤ 200k cells, uncompressed ≤ 100 MiB; `OoxmlError` carries user-facing
  messages, never stack traces.
- **Inputs:** `sanitize.ts` (trim, collapse whitespace, strip control chars
  except `\n\t`, 20k cap); routes use `readJsonRequest` + `checkRateLimit`.
- **Accountability:** `audit_log` records who changed what, when, and why;
  Accepted Risk additionally requires justification + approver + expiry and
  resurfaces before expiry.

## 8. Testing strategy

- `src/core/*` is pure and dependency-free: vitest in node env
  (`vitest.config.ts`, alias `@` → `./src`).
- `tests/fixtures/sample-threat-model.xlsx` (generated by
  `tests/fixtures/make-fixture.mjs`, plain node) mirrors the real STRIDE GPT
  schema: 12 rows, all 6 STRIDE categories, all 4 risk levels, one empty Risk
  Level, one blank row, one junk `Notes` sheet.
- Suites: `ooxml` (round-trip + guards), `columns` (exact + fuzzy mapping,
  fingerprint stability), `excel` (parsing + provenance + ragged rows),
  `recommendations` (splitting + explicit-only extraction), `ranking`
  (transparent scores + "Not provided" explanations), `validate`
  (no-hallucination guard: fabricated quotes throw, unrelated recos stay
  unmapped).
- `npm run type-check` (strict tsc) and `npm run lint` gate the rest.
