/**
 * Override detector — tracks management overrides of governance controls.
 *
 * Every time a control is bypassed (with justification), an immutable record
 * is stored in SQLite. Monthly budgets cap how many overrides a realm can use.
 */

import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum OverrideType {
  THRESHOLD_EXCEPTION = 'THRESHOLD_EXCEPTION',
  CONTROL_BYPASS = 'CONTROL_BYPASS',
  PERIOD_OVERRIDE = 'PERIOD_OVERRIDE',
  SOD_EXCEPTION = 'SOD_EXCEPTION',
}

export interface Override {
  id: number;
  realmId: string;
  userId: string;
  overrideType: OverrideType;
  controlBypassed: string;
  justification: string;
  createdAt: number; // epoch ms
}

export interface OverrideBudget {
  used: number;
  limit: number;
  remaining: number;
  monthLabel: string; // YYYY-MM
}

export interface DateRange {
  from: number; // epoch ms
  to: number;   // epoch ms
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MONTHLY_LIMIT = 10;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS override_log (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      realm_id          TEXT NOT NULL,
      user_id           TEXT NOT NULL,
      override_type     TEXT NOT NULL,
      control_bypassed  TEXT NOT NULL,
      justification     TEXT NOT NULL,
      created_at        INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_override_realm_date
      ON override_log(realm_id, created_at);

    CREATE TABLE IF NOT EXISTS override_budgets (
      realm_id      TEXT PRIMARY KEY,
      monthly_limit INTEGER NOT NULL DEFAULT ${DEFAULT_MONTHLY_LIMIT}
    );
  `);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentMonthRange(): { start: number; end: number; label: string } {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = Date.UTC(year, month, 1);
  const end = Date.UTC(year, month + 1, 1) - 1;
  const label = `${year}-${String(month + 1).padStart(2, '0')}`;
  return { start, end, label };
}

function rowToOverride(row: Record<string, unknown>): Override {
  return {
    id: row['id'] as number,
    realmId: row['realm_id'] as string,
    userId: row['user_id'] as string,
    overrideType: row['override_type'] as OverrideType,
    controlBypassed: row['control_bypassed'] as string,
    justification: row['justification'] as string,
    createdAt: row['created_at'] as number,
  };
}

// ---------------------------------------------------------------------------
// OverrideDetector class
// ---------------------------------------------------------------------------

export class OverrideDetector {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    initSchema(this.db);
  }

  /**
   * Log a management override.
   * Throws if the realm has exhausted its monthly budget.
   */
  logOverride(
    realmId: string,
    userId: string,
    overrideType: OverrideType,
    controlBypassed: string,
    justification: string,
  ): Override {
    if (!justification || justification.trim().length === 0) {
      throw new Error('Override justification is required');
    }

    // Check budget before allowing the override
    const budget = this.getOverrideBudget(realmId);
    if (budget.remaining <= 0) {
      throw new Error(
        `Override budget exhausted for realm ${realmId} in ${budget.monthLabel}: ${budget.used}/${budget.limit} used`,
      );
    }

    const now = Date.now();
    const result = this.db
      .prepare(
        `INSERT INTO override_log (realm_id, user_id, override_type, control_bypassed, justification, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(realmId, userId, overrideType, controlBypassed, justification.trim(), now);

    return {
      id: Number(result.lastInsertRowid),
      realmId,
      userId,
      overrideType,
      controlBypassed,
      justification: justification.trim(),
      createdAt: now,
    };
  }

  /**
   * Query overrides for a realm within a date range.
   */
  getOverrides(realmId: string, dateRange?: DateRange): Override[] {
    if (dateRange) {
      const rows = this.db
        .prepare(
          'SELECT * FROM override_log WHERE realm_id = ? AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC',
        )
        .all(realmId, dateRange.from, dateRange.to) as Array<Record<string, unknown>>;
      return rows.map(rowToOverride);
    }

    const rows = this.db
      .prepare('SELECT * FROM override_log WHERE realm_id = ? ORDER BY created_at DESC')
      .all(realmId) as Array<Record<string, unknown>>;
    return rows.map(rowToOverride);
  }

  /**
   * Get override budget (used / limit) for the current month.
   */
  getOverrideBudget(realmId: string): OverrideBudget {
    const { start, end, label } = currentMonthRange();

    // Count overrides this month
    const countRow = this.db
      .prepare(
        'SELECT COUNT(*) as cnt FROM override_log WHERE realm_id = ? AND created_at >= ? AND created_at <= ?',
      )
      .get(realmId, start, end) as { cnt: number };

    const used = countRow.cnt;

    // Get custom budget or use default
    const budgetRow = this.db
      .prepare('SELECT monthly_limit FROM override_budgets WHERE realm_id = ?')
      .get(realmId) as { monthly_limit: number } | undefined;

    const limit = budgetRow?.monthly_limit ?? DEFAULT_MONTHLY_LIMIT;

    return {
      used,
      limit,
      remaining: Math.max(0, limit - used),
      monthLabel: label,
    };
  }

  /**
   * Set a custom monthly override budget for a realm.
   */
  setMonthlyLimit(realmId: string, limit: number): void {
    if (limit < 0) throw new Error('Monthly override limit must be non-negative');
    this.db
      .prepare(
        `INSERT INTO override_budgets (realm_id, monthly_limit)
         VALUES (?, ?)
         ON CONFLICT(realm_id) DO UPDATE SET monthly_limit = excluded.monthly_limit`,
      )
      .run(realmId, limit);
  }

  /**
   * Get overrides grouped by type for a realm in a date range.
   */
  getOverrideSummary(
    realmId: string,
    dateRange?: DateRange,
  ): Record<OverrideType, number> {
    const overrides = this.getOverrides(realmId, dateRange);
    const summary: Record<string, number> = {
      [OverrideType.THRESHOLD_EXCEPTION]: 0,
      [OverrideType.CONTROL_BYPASS]: 0,
      [OverrideType.PERIOD_OVERRIDE]: 0,
      [OverrideType.SOD_EXCEPTION]: 0,
    };
    for (const o of overrides) {
      summary[o.overrideType] = (summary[o.overrideType] ?? 0) + 1;
    }
    return summary as Record<OverrideType, number>;
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}
