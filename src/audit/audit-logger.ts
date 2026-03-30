/**
 * Hash-chained immutable audit log backed by SQLite (WAL mode).
 *
 * Every audit entry includes a SHA-256 hash that covers the previous
 * entry's hash, creating a tamper-evident chain. Logging is SYNCHRONOUS
 * to guarantee the entry is persisted before the MCP response returns.
 */

import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditEntry {
  traceId: string;
  sessionId: string;
  userId: string;
  realmId: string;
  toolName: string;
  entityType: string;
  entityId: string;
  operation: string;
  requestPayloadHash: string;
  requestPayloadEncrypted?: Buffer;
  responseStatus: number;
  syncTokenBefore?: string;
  syncTokenAfter?: string;
  approvalRef?: string;
  aiModelId?: string;
}

export interface AuditRecord extends AuditEntry {
  id: number;
  entryHash: string;
  previousHash: string;
  timestamp: string;
}

export interface AuditQueryFilters {
  startDate?: string;
  endDate?: string;
  entityType?: string;
  entityId?: string;
  userId?: string;
  sessionId?: string;
  realmId?: string;
  toolName?: string;
  operation?: string;
  limit?: number;
  offset?: number;
}

export interface ChainTip {
  hash: string;
  id: number;
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS audit_log (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_hash                  TEXT    NOT NULL,
  previous_hash               TEXT    NOT NULL,
  timestamp                   TEXT    NOT NULL,
  trace_id                    TEXT    NOT NULL,
  session_id                  TEXT    NOT NULL,
  user_id                     TEXT    NOT NULL,
  realm_id                    TEXT    NOT NULL,
  tool_name                   TEXT    NOT NULL,
  entity_type                 TEXT    NOT NULL,
  entity_id                   TEXT    NOT NULL,
  operation                   TEXT    NOT NULL,
  request_payload_hash        TEXT    NOT NULL,
  request_payload_encrypted   BLOB,
  response_status             INTEGER NOT NULL,
  sync_token_before           TEXT,
  sync_token_after            TEXT,
  approval_ref                TEXT,
  ai_model_id                 TEXT
)`;

const CREATE_INDEXES_SQL = [
  'CREATE INDEX IF NOT EXISTS idx_audit_realm_ts ON audit_log(realm_id, timestamp)',
  'CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id)',
  'CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id)',
  'CREATE INDEX IF NOT EXISTS idx_audit_trace ON audit_log(trace_id)',
  'CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_audit_tool ON audit_log(tool_name)',
];

const INSERT_SQL = `
INSERT INTO audit_log (
  entry_hash, previous_hash, timestamp, trace_id, session_id, user_id,
  realm_id, tool_name, entity_type, entity_id, operation,
  request_payload_hash, request_payload_encrypted, response_status,
  sync_token_before, sync_token_after, approval_ref, ai_model_id
) VALUES (
  @entryHash, @previousHash, @timestamp, @traceId, @sessionId, @userId,
  @realmId, @toolName, @entityType, @entityId, @operation,
  @requestPayloadHash, @requestPayloadEncrypted, @responseStatus,
  @syncTokenBefore, @syncTokenAfter, @approvalRef, @aiModelId
)`;

const GET_LAST_HASH_SQL = `
SELECT id, entry_hash FROM audit_log ORDER BY id DESC LIMIT 1`;

// ---------------------------------------------------------------------------
// Hash computation
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hash for an audit entry.
 * The hash covers all non-hash fields plus the previous entry's hash.
 */
function computeEntryHash(
  previousHash: string,
  timestamp: string,
  entry: AuditEntry,
): string {
  const data = [
    previousHash,
    timestamp,
    entry.traceId,
    entry.sessionId,
    entry.userId,
    entry.realmId,
    entry.toolName,
    entry.entityType,
    entry.entityId,
    entry.operation,
    entry.requestPayloadHash,
    String(entry.responseStatus),
    entry.syncTokenBefore ?? '',
    entry.syncTokenAfter ?? '',
    entry.approvalRef ?? '',
    entry.aiModelId ?? '',
  ].join('|');

  return createHash('sha256').update(data).digest('hex');
}

// ---------------------------------------------------------------------------
// AuditLogger
// ---------------------------------------------------------------------------

/** Genesis hash for the first entry in the chain. */
const GENESIS_HASH = '0'.repeat(64);

export class AuditLogger {
  private readonly db: Database.Database;
  private readonly insertStmt: Database.Statement;
  private readonly getLastHashStmt: Database.Statement;

  constructor(dbPath: string = './data/audit.db') {
    // Ensure directory exists
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);

    // WAL mode for concurrent reads + single-writer performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    // Create schema
    this.db.exec(CREATE_TABLE_SQL);
    for (const sql of CREATE_INDEXES_SQL) {
      this.db.exec(sql);
    }

    // Prepare statements
    this.insertStmt = this.db.prepare(INSERT_SQL);
    this.getLastHashStmt = this.db.prepare(GET_LAST_HASH_SQL);
  }

  /**
   * Log an audit entry. SYNCHRONOUS — the entry is persisted before this returns.
   *
   * @returns The entry ID (as string for convenience).
   */
  log(entry: AuditEntry): string {
    const timestamp = new Date().toISOString();

    // Get previous hash (chain tip)
    const last = this.getLastHashStmt.get() as { id: number; entry_hash: string } | undefined;
    const previousHash = last?.entry_hash ?? GENESIS_HASH;

    // Compute this entry's hash
    const entryHash = computeEntryHash(previousHash, timestamp, entry);

    const result = this.insertStmt.run({
      entryHash,
      previousHash,
      timestamp,
      traceId: entry.traceId,
      sessionId: entry.sessionId,
      userId: entry.userId,
      realmId: entry.realmId,
      toolName: entry.toolName,
      entityType: entry.entityType,
      entityId: entry.entityId,
      operation: entry.operation,
      requestPayloadHash: entry.requestPayloadHash,
      requestPayloadEncrypted: entry.requestPayloadEncrypted ?? null,
      responseStatus: entry.responseStatus,
      syncTokenBefore: entry.syncTokenBefore ?? null,
      syncTokenAfter: entry.syncTokenAfter ?? null,
      approvalRef: entry.approvalRef ?? null,
      aiModelId: entry.aiModelId ?? null,
    });

    return String(result.lastInsertRowid);
  }

  /**
   * Query audit entries with optional filters.
   */
  query(filters: AuditQueryFilters = {}): AuditRecord[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filters.startDate) {
      conditions.push('timestamp >= @startDate');
      params.startDate = filters.startDate;
    }
    if (filters.endDate) {
      conditions.push('timestamp <= @endDate');
      params.endDate = filters.endDate;
    }
    if (filters.entityType) {
      conditions.push('entity_type = @entityType');
      params.entityType = filters.entityType;
    }
    if (filters.entityId) {
      conditions.push('entity_id = @entityId');
      params.entityId = filters.entityId;
    }
    if (filters.userId) {
      conditions.push('user_id = @userId');
      params.userId = filters.userId;
    }
    if (filters.sessionId) {
      conditions.push('session_id = @sessionId');
      params.sessionId = filters.sessionId;
    }
    if (filters.realmId) {
      conditions.push('realm_id = @realmId');
      params.realmId = filters.realmId;
    }
    if (filters.toolName) {
      conditions.push('tool_name = @toolName');
      params.toolName = filters.toolName;
    }
    if (filters.operation) {
      conditions.push('operation = @operation');
      params.operation = filters.operation;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;

    const sql = `
      SELECT * FROM audit_log ${where}
      ORDER BY id DESC
      LIMIT @limit OFFSET @offset
    `;

    const rows = this.db.prepare(sql).all({ ...params, limit, offset }) as Array<Record<string, unknown>>;

    return rows.map(rowToRecord);
  }

  /**
   * Get the chain tip (latest hash and ID).
   */
  getChainTip(): ChainTip | null {
    const row = this.getLastHashStmt.get() as { id: number; entry_hash: string } | undefined;
    if (!row) return null;
    return { hash: row.entry_hash, id: row.id };
  }

  /**
   * Get a single audit record by ID.
   */
  getById(id: number): AuditRecord | null {
    const row = this.db.prepare('SELECT * FROM audit_log WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return rowToRecord(row);
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToRecord(row: Record<string, unknown>): AuditRecord {
  return {
    id: row.id as number,
    entryHash: row.entry_hash as string,
    previousHash: row.previous_hash as string,
    timestamp: row.timestamp as string,
    traceId: row.trace_id as string,
    sessionId: row.session_id as string,
    userId: row.user_id as string,
    realmId: row.realm_id as string,
    toolName: row.tool_name as string,
    entityType: row.entity_type as string,
    entityId: row.entity_id as string,
    operation: row.operation as string,
    requestPayloadHash: row.request_payload_hash as string,
    requestPayloadEncrypted: row.request_payload_encrypted as Buffer | undefined,
    responseStatus: row.response_status as number,
    syncTokenBefore: row.sync_token_before as string | undefined,
    syncTokenAfter: row.sync_token_after as string | undefined,
    approvalRef: row.approval_ref as string | undefined,
    aiModelId: row.ai_model_id as string | undefined,
  };
}

/**
 * Recompute the expected hash for a given audit record.
 * Used by the chain verifier.
 */
export function recomputeHash(record: AuditRecord): string {
  return computeEntryHash(record.previousHash, record.timestamp, {
    traceId: record.traceId,
    sessionId: record.sessionId,
    userId: record.userId,
    realmId: record.realmId,
    toolName: record.toolName,
    entityType: record.entityType,
    entityId: record.entityId,
    operation: record.operation,
    requestPayloadHash: record.requestPayloadHash,
    responseStatus: record.responseStatus,
    syncTokenBefore: record.syncTokenBefore,
    syncTokenAfter: record.syncTokenAfter,
    approvalRef: record.approvalRef,
    aiModelId: record.aiModelId,
  });
}
