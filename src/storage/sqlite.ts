import { createRequire } from "node:module";

import type { AuditRecord, QueryFilter } from "../types.js";
import type { AuditStore } from "./base.js";
import { resolveTime } from "./match.js";

// Minimal structural types for node:sqlite so we can compile against
// @types/node 20, where the module's typings don't exist yet.
interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteRow {
  id: string;
  system: string;
  prompt_version: string;
  model: string | null;
  session_id: string | null;
  user_id: string | null;
  input: string;
  output: string;
  confidence: number | null;
  cost_gbp: number | null;
  latency_ms: number;
  created_at: string;
  expires_at: string | null;
  context: string;
}

export function sqliteAvailable(): boolean {
  try {
    createRequire(import.meta.url)("node:sqlite");
    return true;
  } catch {
    return false;
  }
}

/**
 * SQLite-backed audit store using Node's built-in `node:sqlite` (Node >= 22.5).
 * No native dependencies — the whole package stays dependency-free. Queries
 * are translated to indexed SQL instead of scanning every record, so this is
 * the backend to use once the JSON file stops being funny.
 */
export class SqliteStore implements AuditStore {
  private readonly db: SqliteDatabase;

  constructor(dbPath: string) {
    let mod: { DatabaseSync: new (path: string) => SqliteDatabase };
    try {
      mod = createRequire(import.meta.url)("node:sqlite");
    } catch {
      throw new Error(
        "SqliteStore requires Node.js >= 22.5 (built-in node:sqlite). " +
          "On older Node, use FileStore or MemoryStore instead.",
      );
    }
    this.db = new mod.DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_records (
        id TEXT PRIMARY KEY,
        system TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        model TEXT,
        session_id TEXT,
        user_id TEXT,
        input TEXT NOT NULL,
        output TEXT NOT NULL,
        confidence REAL,
        cost_gbp REAL,
        latency_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        context TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_records_created_at ON audit_records(created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_records_user_id ON audit_records(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_records_session_id ON audit_records(session_id);
      CREATE INDEX IF NOT EXISTS idx_audit_records_system ON audit_records(system);
    `);
  }

  async append(record: AuditRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO audit_records
           (id, system, prompt_version, model, session_id, user_id,
            input, output, confidence, cost_gbp, latency_ms,
            created_at, expires_at, context)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.system,
        record.promptVersion,
        record.model,
        record.sessionId,
        record.userId,
        toJson(record.input),
        toJson(record.output),
        record.confidence,
        record.costGbp,
        record.latencyMs,
        record.createdAt,
        record.expiresAt,
        JSON.stringify(record.context),
      );
  }

  async get(id: string): Promise<AuditRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM audit_records WHERE id = ?").get(id) as
      | SqliteRow
      | undefined;
    return row ? toRecord(row) : undefined;
  }

  async query(filter: QueryFilter): Promise<AuditRecord[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const now = Date.now();

    if (filter.since) {
      clauses.push("created_at >= ?");
      params.push(new Date(resolveTime(filter.since, now)).toISOString());
    }
    if (filter.until) {
      clauses.push("created_at <= ?");
      params.push(new Date(resolveTime(filter.until, now)).toISOString());
    }

    const w = filter.where;
    if (w) {
      if (w.userId !== undefined) {
        clauses.push("user_id = ?");
        params.push(w.userId);
      }
      if (w.sessionId !== undefined) {
        clauses.push("session_id = ?");
        params.push(w.sessionId);
      }
      if (w.system !== undefined) {
        clauses.push("system = ?");
        params.push(w.system);
      }
      if (w.model !== undefined) {
        clauses.push("model = ?");
        params.push(w.model);
      }
      if (w.confidence) {
        clauses.push("confidence IS NOT NULL");
        const c = w.confidence;
        if (c.lt !== undefined) { clauses.push("confidence < ?"); params.push(c.lt); }
        if (c.lte !== undefined) { clauses.push("confidence <= ?"); params.push(c.lte); }
        if (c.gt !== undefined) { clauses.push("confidence > ?"); params.push(c.gt); }
        if (c.gte !== undefined) { clauses.push("confidence >= ?"); params.push(c.gte); }
      }
    }

    let sql = "SELECT * FROM audit_records";
    if (clauses.length > 0) sql += ` WHERE ${clauses.join(" AND ")}`;
    sql += " ORDER BY created_at DESC";
    if (filter.limit) {
      sql += " LIMIT ?";
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as SqliteRow[];
    return rows.map(toRecord);
  }

  async deleteWhere(predicate: (r: AuditRecord) => boolean): Promise<number> {
    // The interface takes an arbitrary JS predicate, so we can't push it into
    // SQL — load, filter, delete by id. Erasure volumes are small enough.
    const rows = this.db.prepare("SELECT * FROM audit_records").all() as SqliteRow[];
    const doomed = rows.map(toRecord).filter(predicate);
    const del = this.db.prepare("DELETE FROM audit_records WHERE id = ?");
    for (const r of doomed) del.run(r.id);
    return doomed.length;
  }

  close(): void {
    this.db.close();
  }
}

function toJson(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value);
}

function toRecord(row: SqliteRow): AuditRecord {
  return {
    id: row.id,
    system: row.system,
    promptVersion: row.prompt_version,
    model: row.model,
    sessionId: row.session_id,
    userId: row.user_id,
    input: JSON.parse(row.input) as unknown,
    output: JSON.parse(row.output) as unknown,
    confidence: row.confidence,
    costGbp: row.cost_gbp,
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    context: JSON.parse(row.context) as Record<string, unknown>,
  };
}
