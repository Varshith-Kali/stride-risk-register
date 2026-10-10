# User Guide — STRIDE Risk Register & Visibility Platform

This guide walks through the platform end to end. It tracks BUILD_SPEC — if a
screen described here is not yet in your deployment, check with your
administrator. Screens marked **AI** need an OpenAI API key (entered once per
session in the top-bar dialog); everything else works offline.

## 1. New submission (intake wizard)

1. Click **New Submission** in the top bar.
2. **Upload** the threat-model Excel exported from STRIDE GPT (`.xlsx`,
   ≤ 10 MiB). The file is validated immediately — wrong type or a corrupt
   file gets a clear error, not a crash.
3. Fill in the optional metadata: **application/project name**, **review
   date** (defaults to today), **notes**.
4. **Select the reviewer** (mandatory) — the dropdown lists the active
   reviewers from `config/reviewers.yaml` (currently Varshith Puli and
   Prathamesh Mohite; up to ~15 supported). Every record in the submission is
   permanently mapped to this reviewer.
5. **Paste the reviewer recommendations** into the free-text box — numbered,
   bulleted, or plain paragraphs. Original wording is preserved.
6. Click **Process**.

### Column-mapping preview

Before anything is stored you see a **Column Mapping Preview**: the app
auto-detects which Excel column is the threat ID, STRIDE category,
description, MITRE mapping, risk level, controls, and safety metrics, and
shows a few sample rows. Confirm or correct the mapping, then continue — the
confirmed mapping is remembered (by column fingerprint) for the next upload
with the same layout. Files that do not look like a STRIDE GPT export get
fuzzy matching here rather than silent mis-parsing.

You land on the **Executive Overview** for the new submission.

## 2. Executive Overview (dashboard)

- **KPI cards**: total threats, high/critical count, threats with reviewer
  response, unmapped threats, unmapped recommendations, reviewer coverage %.
  Every number drills down to the underlying rows.
- **AI executive summary** (**AI**): one paragraph grounded strictly in the
  data, each statement traceable. Click **Generate** after entering your key.
- **Charts**: STRIDE category distribution (donut), risk-level bar, top-N
  ranked threats (horizontal bar), threats by component (treemap), coverage
  (with vs. without recommendations), reviewer workload (per-reviewer bars).

## 3. Risk Register (main table)

Columns: Risk ID, Project, Threat, STRIDE category, Component,
Severity/Score, Reviewer, Linked Recommendation(s), Status, **Source row**
(the exact Excel sheet + row the threat came from).

- **Filter, sort, search, column chooser**; export the current view to
  Excel/CSV.
- **Row drill-down** (click a row): the full threat, linked recommendations
  with evidence quotes, the audit trail, and actions:
  - **Change status** — Open, In Progress, Mitigated, Accepted Risk,
    Deferred, Rejected/Not Applicable. Statuses are set by humans only.
  - **Override priority** — allowed, but requires a mandatory reason, which
    is logged.
  - **Accept / reject / re-link AI-proposed links** — each link shows its
    rationale, supporting quote, confidence, and source label
    (`From Excel` / `From Reviewer` / `AI-inferred link`). Your decision and
    name are stored.
- **"Why is this ranked here?"** — every ranked item shows its explanation,
  e.g. *"Ranked #3: Risk Level High (base 75); no DREAD score provided."*
  If the Excel had no risk data, the explanation says so explicitly —
  the platform never invents a score.

## 4. Recommendations view

All reviewer recommendations in one place: linked threats, priority, status,
and **unmapped recommendations highlighted** (recommendations that match no
threat are shown, not hidden). From here you can:

- change a recommendation's status;
- **Save to library** — reviewer-approved recommendations become reusable
  entries in the searchable Recommendation Library for consistent, faster
  future reviews.

## 5. Reviewers, Portfolio, Timeline

- **Reviewers**: pick a reviewer to see their submissions, open items, ageing
  (days since review / days open), and coverage.
- **Portfolio**: all projects side by side — risk posture, open items, and
  trend over time as new submission versions land.
- **Timeline**: submission dates, review dates, and status changes per project
  and reviewer, plus an ageing view. Remediation dates appear only when
  actually provided or entered — nothing is inferred.

### Review quality scorecard

Per reviewer, objective visibility metrics only: coverage %, unmapped ratio,
time from submission to review, ageing of open items. This is framed as
**visibility, not performance policing**.

## 6. Statuses and the Accepted-Risk flow

Threat statuses: **Open · In Progress · Mitigated · Accepted Risk ·
Deferred · Rejected/Not Applicable**.

- **Accepted Risk** requires three human-entered fields: a **justification**,
  an **approver name**, and an **expiry/review date**. Accepted risks
  automatically resurface before expiry.
- Re-uploading a revised Excel for the same project creates a **new version**;
  the **diff view** shows added, removed, and changed threats, and what got
  resolved between versions (residual-risk trend).

## 7. Exports

- **Excel register** — the governed risk register as `.xlsx`.
- **CSV** — the current register view.
- **Evidence-linked audit pack** — one-click bundle proving what was threat
  modelled, what was recommended, who reviewed it, and what was decided
  (useful for audits and governance).
- **Printable executive report** (`/report/[id]`) — print-optimized page with
  a Print button.

## 8. AI-assisted workflows (key required)

- **Threat↔recommendation mapping** (**AI**): after intake, the platform
  proposes many-to-many links with rationale, exact quotes, and confidence.
  Nothing is final until you accept/reject it.
- **Reviewer Q&A over the register** (**AI**): ask grounded questions like
  "Which open high threats exist for Project X?" — answers come only from
  stored data and cite rows.
- Anything the AI suggests beyond the input is visibly tagged
  **"AI Suggestion, Unverified"** and kept separate from the factual register.

## 9. Reading the register honestly

- **"Not provided"** means the source Excel or the reviewer text did not
  contain that field. It is not a gap in the platform — it is the platform
  refusing to guess.
- **"No Reviewer Response"** on a threat means the reviewer never addressed
  it — a coverage gap in the review, surfaced deliberately.
- **"Unmapped Recommendation"** means a recommendation could not be tied to
  any threat — a coverage gap in the threat model, surfaced deliberately.
- **Recurring patterns** ("Spoofing on API gateways appears in 6 of 9
  reviews") are computed only from stored submissions, never from outside
  knowledge.
