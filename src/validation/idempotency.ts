/**
 * Fingerprint-based idempotency manager.
 *
 * Uses better-sqlite3 to persist operation fingerprints so identical
 * requests return cached results instead of creating duplicates.
 */

import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IdempotencyCheck {
  exists: boolean;
  result?: unknown;
}

interface IdempotencyRow {
  fingerprint: string;
  result: string;
  in_flight: number;
  created_at: number;
  expires_at: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default TTL: 1 hour */
const DEFAULT_TTL_MS = 60 * 60 * 1000;

/** Cleanup interval: every 5 minutes */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// IdempotencyManager
// ---------------------------------------------------------------------------

export class IdempotencyManager {
  private readonly db: Database.Database;
  private readonly ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param dbPath  Path to SQLite database file (default: in-memory)
   * @param ttlMs   Time-to-live for fingerprints in milliseconds
   */
  constructor(dbPath: string = ':memory:', ttlMs: number = DEFAULT_TTL_MS) {
    this.db = new Database(dbPath);
    this.ttlMs = ttlMs;
    this.init();
    this.startCleanup();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Generate a fingerprint from operation parameters.
   *
   * @param operationType  e.g. 'CREATE', 'UPDATE'
   * @param entityType     e.g. 'Invoice', 'JournalEntry'
   * @param keyFields      Deterministic subset of the payload
   */
  static fingerprint(
    operationType: string,
    entityType: string,
    keyFields: Record<string, unknown>,
  ): string {
    // Sort keys for deterministic serialization
    const sortedKeys = Object.keys(keyFields).sort();
    const sorted: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      sorted[key] = keyFields[key];
    }
    const input = `${operationType}|${entityType}|${JSON.stringify(sorted)}`;
    return createHash('sha256').update(input).digest('hex');
  }

  /**
   * Check if a fingerprint has already been processed.
   * Returns cached result if it exists.
   */
  check(fingerprint: string): IdempotencyCheck {
    const now = Date.now();
    const row = this.db.prepare(
      'SELECT fingerprint, result, in_flight, created_at, expires_at FROM idempotency WHERE fingerprint = ? AND expires_at > ?',
    ).get(fingerprint, now) as IdempotencyRow | undefined;

    if (!row) {
      return { exists: false };
    }

    // If in-flight, treat as existing but no result yet
    if (row.in_flight === 1) {
      return { exists: true, result: undefined };
    }

    try {
      return { exists: true, result: JSON.parse(row.result) };
    } catch {
      return { exists: true, result: row.result };
    }
  }

  /**
   * Record a successful result for a fingerprint.
   */
  record(fingerprint: string, result: unknown): void {
    const now = Date.now();
    const expiresAt = now + this.ttlMs;
    const serialized = JSON.stringify(result);

    this.db.prepare(`
      INSERT INTO idempotency (fingerprint, result, in_flight, created_at, expires_at)
      VALUES (?, ?, 0, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        result = excluded.result,
        in_flight = 0,
        expires_at = excluded.expires_at
    `).run(fingerprint, serialized, now, expiresAt);
  }

  /**
   * Mark a fingerprint as in-flight (operation started but not complete).
   * Prevents concurrent duplicate operations.
   */
  markInFlight(fingerprint: string): void {
    const now = Date.now();
    const expiresAt = now + this.ttlMs;

    this.db.prepare(`
      INSERT INTO idempotency (fingerprint, result, in_flight, created_at, expires_at)
      VALUES (?, '', 1, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        in_flight = 1,
        expires_at = excluded.expires_at
    `).run(fingerprint, now, expiresAt);
  }

  /**
   * Clear in-flight status (e.g. on failure, allowing retry).
   */
  clearInFlight(fingerprint: string): void {
    this.db.prepare(
      'DELETE FROM idempotency WHERE fingerprint = ? AND in_flight = 1',
    ).run(fingerprint);
  }

  /**
   * Remove all expired entries.
   */
  cleanup(): number {
    const now = Date.now();
    const result = this.db.prepare(
      'DELETE FROM idempotency WHERE expires_at <= ?',
    ).run(now);
    return result.changes;
  }

  /**
   * Shut down the manager, stopping cleanup and closing the database.
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.db.close();
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private init(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS idempotency (
        fingerprint TEXT PRIMARY KEY,
        result      TEXT NOT NULL DEFAULT '',
        in_flight   INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        expires_at  INTEGER NOT NULL
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_idempotency_expires
      ON idempotency(expires_at)
    `);
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);

    // Unref so it doesn't prevent process exit
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      (this.cleanupTimer as NodeJS.Timeout).unref();
    }
  }
}
