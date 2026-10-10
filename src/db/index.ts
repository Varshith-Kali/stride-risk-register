/**
 * SQLite access layer (node:sqlite, zero native dependencies).
 *
 * - Lazy singleton: the DB file is opened on first use.
 * - Migrations run automatically on first use (schema_migrations table).
 * - Reviewers are seeded from config/reviewers.yaml on every init
 *   (new names are added, `active` flags are synced, history is untouched).
 * - DB path override: RISK_REGISTER_DB_PATH env var.
 *
 * The module exposes small typed helpers (one per aggregate) so route
 * handlers never write raw SQL. A future Postgres move keeps these
 * signatures and swaps the driver.
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import { MIGRATIONS, type ReviewerRow } from "./schema";

const now = () => new Date().toISOString();

function resolveDbPath(): string {
  const fromEnv = process.env.RISK_REGISTER_DB_PATH?.trim();
  if (fromEnv) return fromEnv;
  return join(process.cwd(), "data", "risk-register.db");
}

let db: DatabaseSync | null = null;

function openDb(): DatabaseSync {
  if (db) return db;
  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  // Pragmas: foreign keys on, WAL for concurrent readers, busy timeout.
  db.exec(`PRAGMA foreign_keys = ON;`);
  db.exec(`PRAGMA journal_mode = WAL;`);
  db.exec(`PRAGMA busy_timeout = 5000;`);
  migrate(db);
  seedReviewers(db);
  return db;
}

function migrate(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      applied_at  TEXT NOT NULL
    );
  `);
  const applied = new Set(
    database
      .prepare(`SELECT version FROM schema_migrations`)
      .all()
      .map((r) => (r as { version: number }).version)
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    database.exec("BEGIN;");
    try {
      database.exec(m.sql);
      database
        .prepare(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`)
        .run(m.version, now());
      database.exec("COMMIT;");
    } catch (e) {
      database.exec("ROLLBACK;");
      throw e;
    }
  }
}

interface ReviewerSeed {
  name: string;
  role?: string;
  active?: boolean;
}

function seedReviewers(database: DatabaseSync) {
  const yamlPath = join(process.cwd(), "config", "reviewers.yaml");
  if (!existsSync(yamlPath)) return;
  let seeds: ReviewerSeed[] = [];
  try {
    const parsed = parseYaml(readFileSync(yamlPath, "utf8")) as {
      reviewers?: ReviewerSeed[];
    };
    seeds = parsed?.reviewers ?? [];
  } catch {
    return; // never break startup on a malformed roster file
  }
  const insert = database.prepare(
    `INSERT OR IGNORE INTO reviewers (name, role, active, created_at) VALUES (?, ?, ?, ?)`
  );
  const syncActive = database.prepare(
    `UPDATE reviewers SET role = ?, active = ? WHERE name = ?`
  );
  for (const s of seeds) {
    if (!s?.name?.trim()) continue;
    insert.run(s.name.trim(), s.role ?? "", s.active === false ? 0 : 1, now());
    syncActive.run(s.role ?? "", s.active === false ? 0 : 1, s.name.trim());
  }
}

/* ─── Generic typed helpers ───────────────────────────────────────────────── */

export function getDb(): DatabaseSync {
  return openDb();
}

type Params = (string | number | null | undefined)[];

/** node:sqlite's SQLInputValue rejects `undefined` — normalize to NULL. */
const cleanParams = (params: Params): (string | number | null)[] =>
  params.map((p) => (p === undefined ? null : p));

export function all<T>(sql: string, ...params: Params): T[] {
  return openDb().prepare(sql).all(...cleanParams(params)) as T[];
}

export function get<T>(sql: string, ...params: Params): T | undefined {
  return openDb().prepare(sql).get(...cleanParams(params)) as T | undefined;
}

export function run(sql: string, ...params: Params): { lastInsertRowid: number | bigint; changes: number | bigint } {
  const info = openDb().prepare(sql).run(...cleanParams(params));
  return { lastInsertRowid: info.lastInsertRowid, changes: info.changes };
}

export function transaction<T>(fn: () => T): T {
  const database = openDb();
  database.exec("BEGIN;");
  try {
    const result = fn();
    database.exec("COMMIT;");
    return result;
  } catch (e) {
    database.exec("ROLLBACK;");
    throw e;
  }
}

/* ─── Reviewers ───────────────────────────────────────────────────────────── */

export function listActiveReviewers(): ReviewerRow[] {
  return all<ReviewerRow>(
    `SELECT * FROM reviewers WHERE active = 1 ORDER BY name ASC`
  );
}

export function getReviewerByName(name: string): ReviewerRow | undefined {
  return get<ReviewerRow>(`SELECT * FROM reviewers WHERE name = ?`, name);
}

export function ensureReviewer(name: string): ReviewerRow {
  const existing = getReviewerByName(name);
  if (existing) return existing;
  const { lastInsertRowid } = run(
    `INSERT INTO reviewers (name, role, active, created_at) VALUES (?, ?, 1, ?)`,
    name,
    "",
    now()
  );
  const row = get<ReviewerRow>(`SELECT * FROM reviewers WHERE id = ?`, Number(lastInsertRowid));
  if (!row) throw new Error("Failed to create reviewer");
  return row;
}

/* ─── Audit ───────────────────────────────────────────────────────────────── */

export function audit(
  actor: string,
  action: string,
  entity: string,
  entityId: string | number,
  detail: string
): void {
  run(
    `INSERT INTO audit_log (actor, action, entity, entity_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    actor || "system",
    action,
    entity,
    String(entityId),
    detail,
    now()
  );
}

export { now };
