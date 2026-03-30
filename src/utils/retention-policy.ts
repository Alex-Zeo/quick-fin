/**
 * Record lifecycle and retention policy.
 *
 * Enforces retention periods for different record types:
 * - Financial/audit/tax: 7 years (SOX/regulatory compliance)
 * - Temp data: 90 days
 * - Logs: 1 year
 */

import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecordType = 'financial' | 'audit' | 'tax' | 'temp' | 'log';

interface ExpiredRecord {
  id: string;
  recordType: RecordType;
  createdAt: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RETENTION_DAYS: Record<RecordType, number> = {
  financial: 2555, // 7 years
  audit: 2555,     // 7 years
  tax: 2555,       // 7 years
  temp: 90,        // 90 days
  log: 365,        // 1 year
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// RetentionPolicy
// ---------------------------------------------------------------------------

export class RetentionPolicy {
  /**
   * Check if a record should still be retained.
   *
   * @param recordType  The type of record
   * @param createdAt   When the record was created
   * @returns true if the record should be kept, false if expired
   */
  shouldRetain(recordType: RecordType, createdAt: Date): boolean {
    const retentionDays = RETENTION_DAYS[recordType];
    const expiresAt = new Date(createdAt.getTime() + retentionDays * MS_PER_DAY);
    return new Date() < expiresAt;
  }

  /**
   * Get the retention period in days for a record type.
   */
  getRetentionDays(recordType: RecordType): number {
    return RETENTION_DAYS[recordType];
  }

  /**
   * Calculate the expiry date for a record.
   */
  getExpiryDate(recordType: RecordType, createdAt: Date): Date {
    const retentionDays = RETENTION_DAYS[recordType];
    return new Date(createdAt.getTime() + retentionDays * MS_PER_DAY);
  }

  /**
   * Query a SQLite database for expired record IDs.
   *
   * Expects a table with columns: id TEXT, record_type TEXT, created_at TEXT (ISO 8601)
   *
   * @param db         better-sqlite3 Database instance
   * @param tableName  Table to scan for expired records
   * @returns Array of expired record IDs
   */
  getExpiredRecords(db: Database.Database, tableName: string = 'records'): string[] {
    const now = Date.now();
    const expired: string[] = [];

    for (const [type, days] of Object.entries(RETENTION_DAYS)) {
      const cutoff = new Date(now - days * MS_PER_DAY).toISOString();

      try {
        const rows = db.prepare(
          `SELECT id FROM "${tableName}" WHERE record_type = ? AND created_at < ?`,
        ).all(type, cutoff) as Array<{ id: string }>;

        for (const row of rows) {
          expired.push(row.id);
        }
      } catch {
        // Table or columns may not exist — skip
      }
    }

    return expired;
  }

  /**
   * Purge expired records from a SQLite table.
   *
   * @param db         better-sqlite3 Database instance
   * @param tableName  Table to purge
   * @returns Number of records deleted
   */
  purgeExpired(db: Database.Database, tableName: string = 'records'): number {
    const now = Date.now();
    let totalDeleted = 0;

    for (const [type, days] of Object.entries(RETENTION_DAYS)) {
      const cutoff = new Date(now - days * MS_PER_DAY).toISOString();

      try {
        const result = db.prepare(
          `DELETE FROM "${tableName}" WHERE record_type = ? AND created_at < ?`,
        ).run(type, cutoff);
        totalDeleted += result.changes;
      } catch {
        // Table or columns may not exist — skip
      }
    }

    return totalDeleted;
  }
}
