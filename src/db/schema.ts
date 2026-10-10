/**
 * SQLite schema for the STRIDE Risk Register platform.
 *
 * Migrations are versioned and applied in order by src/db/index.ts.
 * The schema is deliberately relational and narrow so a future move to
 * Postgres is a mechanical translation (same tables, same columns).
 *
 * Conventions:
 *  - Timestamps are ISO-8601 UTC strings (TEXT).
 *  - Booleans are INTEGER 0/1.
 *  - JSON arrays/objects are stored as TEXT (parsed at the boundary).
 *  - Every threat row keeps its Excel provenance: sheet name + 1-based row.
 *  - Nothing in the register may exist without a source: threat rows come
 *    from an uploaded Excel, recommendations from reviewer-typed text.
 */

export interface Migration {
  version: number;
  description: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "Initial schema: reviewers, projects, submissions, threats, recommendations, links, governance",
    sql: `
      CREATE TABLE IF NOT EXISTS reviewers (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL UNIQUE,
        role        TEXT NOT NULL DEFAULT '',
        active      INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL UNIQUE,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS submissions (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id        INTEGER NOT NULL REFERENCES projects(id),
        reviewer_id       INTEGER NOT NULL REFERENCES reviewers(id),
        review_date       TEXT NOT NULL,
        notes             TEXT NOT NULL DEFAULT '',
        excel_filename    TEXT NOT NULL DEFAULT '',
        excel_fingerprint TEXT NOT NULL DEFAULT '',
        version           INTEGER NOT NULL DEFAULT 1,
        mapping_json      TEXT NOT NULL DEFAULT '{}',
        created_at        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_submissions_project ON submissions(project_id);
      CREATE INDEX IF NOT EXISTS idx_submissions_reviewer ON submissions(reviewer_id);

      CREATE TABLE IF NOT EXISTS threats (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        submission_id    INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
        excel_sheet      TEXT NOT NULL DEFAULT '',
        excel_row        INTEGER NOT NULL DEFAULT 0,
        threat_ref       TEXT NOT NULL DEFAULT '',
        title            TEXT NOT NULL DEFAULT '',
        description      TEXT NOT NULL DEFAULT '',
        stride_category  TEXT NOT NULL DEFAULT '',
        component        TEXT NOT NULL DEFAULT '',
        mitre            TEXT NOT NULL DEFAULT '[]',
        risk_level       TEXT NOT NULL DEFAULT '',
        existing_controls TEXT NOT NULL DEFAULT '',
        safety_metrics   TEXT NOT NULL DEFAULT '',
        severity_score   REAL,
        status           TEXT NOT NULL DEFAULT 'Open',
        priority_override TEXT,
        priority_override_reason TEXT,
        rank_score       REAL,
        rank_explanation TEXT NOT NULL DEFAULT '',
        created_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_threats_submission ON threats(submission_id);
      CREATE INDEX IF NOT EXISTS idx_threats_status ON threats(status);

      CREATE TABLE IF NOT EXISTS recommendations (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
        reco_index    INTEGER NOT NULL DEFAULT 0,
        text          TEXT NOT NULL DEFAULT '',
        owner         TEXT NOT NULL DEFAULT '',
        priority      TEXT NOT NULL DEFAULT '',
        timeline      TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'Open',
        created_at    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_recos_submission ON recommendations(submission_id);

      CREATE TABLE IF NOT EXISTS links (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        threat_id         INTEGER NOT NULL REFERENCES threats(id) ON DELETE CASCADE,
        recommendation_id INTEGER NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
        confidence        TEXT NOT NULL DEFAULT 'Medium',
        rationale         TEXT NOT NULL DEFAULT '',
        quote             TEXT NOT NULL DEFAULT '',
        source_label      TEXT NOT NULL DEFAULT 'AI-inferred link',
        decision          TEXT NOT NULL DEFAULT 'proposed',
        decided_by        TEXT NOT NULL DEFAULT '',
        decided_at        TEXT,
        created_at        TEXT NOT NULL,
        UNIQUE(threat_id, recommendation_id)
      );
      CREATE INDEX IF NOT EXISTS idx_links_threat ON links(threat_id);
      CREATE INDEX IF NOT EXISTS idx_links_reco ON links(recommendation_id);

      CREATE TABLE IF NOT EXISTS status_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        threat_id   INTEGER NOT NULL REFERENCES threats(id) ON DELETE CASCADE,
        from_status TEXT NOT NULL DEFAULT '',
        to_status   TEXT NOT NULL DEFAULT '',
        changed_by  TEXT NOT NULL DEFAULT '',
        reason      TEXT NOT NULL DEFAULT '',
        changed_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_status_threat ON status_history(threat_id);

      CREATE TABLE IF NOT EXISTS audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        actor       TEXT NOT NULL DEFAULT '',
        action      TEXT NOT NULL DEFAULT '',
        entity      TEXT NOT NULL DEFAULT '',
        entity_id   TEXT NOT NULL DEFAULT '',
        detail      TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

      CREATE TABLE IF NOT EXISTS accepted_risks (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        threat_id     INTEGER NOT NULL UNIQUE REFERENCES threats(id) ON DELETE CASCADE,
        justification TEXT NOT NULL DEFAULT '',
        approver      TEXT NOT NULL DEFAULT '',
        expiry_date   TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recommendation_library (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        text        TEXT NOT NULL,
        category    TEXT NOT NULL DEFAULT '',
        approved_by TEXT NOT NULL DEFAULT '',
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS column_mappings (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        fingerprint TEXT NOT NULL UNIQUE,
        mapping_json TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
    `,
  },
];

/* ─── Row types (what comes back from the DB) ─────────────────────────────── */

export interface ReviewerRow {
  id: number; name: string; role: string; active: number; created_at: string;
}
export interface ProjectRow {
  id: number; name: string; created_at: string;
}
export interface SubmissionRow {
  id: number; project_id: number; reviewer_id: number; review_date: string;
  notes: string; excel_filename: string; excel_fingerprint: string;
  version: number; mapping_json: string; created_at: string;
}
export interface ThreatRow {
  id: number; submission_id: number; excel_sheet: string; excel_row: number;
  threat_ref: string; title: string; description: string; stride_category: string;
  component: string; mitre: string; risk_level: string; existing_controls: string;
  safety_metrics: string; severity_score: number | null; status: string;
  priority_override: string | null; priority_override_reason: string | null;
  rank_score: number | null; rank_explanation: string; created_at: string;
}
export interface RecommendationRow {
  id: number; submission_id: number; reco_index: number; text: string;
  owner: string; priority: string; timeline: string; status: string; created_at: string;
}
export interface LinkRow {
  id: number; threat_id: number; recommendation_id: number; confidence: string;
  rationale: string; quote: string; source_label: string; decision: string;
  decided_by: string; decided_at: string | null; created_at: string;
}
export interface StatusHistoryRow {
  id: number; threat_id: number; from_status: string; to_status: string;
  changed_by: string; reason: string; changed_at: string;
}
export interface AuditLogRow {
  id: number; actor: string; action: string; entity: string; entity_id: string;
  detail: string; created_at: string;
}
export interface AcceptedRiskRow {
  id: number; threat_id: number; justification: string; approver: string;
  expiry_date: string; created_at: string;
}
export interface LibraryRow {
  id: number; text: string; category: string; approved_by: string;
  usage_count: number; created_at: string;
}
