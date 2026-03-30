/**
 * Period controller — fiscal period open/close management.
 *
 * Persists period stages in SQLite. Enforces write restrictions based on
 * which stage a period is in.
 */

import Database from 'better-sqlite3';
import type { Session } from './rbac.js';
import { PermissionTier } from './rbac.js';

// ---------------------------------------------------------------------------
// Enums & types
// ---------------------------------------------------------------------------

export enum PeriodStage {
  OPEN = 'OPEN',
  PRELIMINARY_CLOSE = 'PRELIMINARY_CLOSE',
  UNDER_REVIEW = 'UNDER_REVIEW',
  FINAL_CLOSE = 'FINAL_CLOSE',
  AUDIT_ADJUSTMENT = 'AUDIT_ADJUSTMENT',
}

/** Valid transitions: from -> allowed next stages */
const VALID_TRANSITIONS: Record<PeriodStage, PeriodStage[]> = {
  [PeriodStage.OPEN]: [PeriodStage.PRELIMINARY_CLOSE],
  [PeriodStage.PRELIMINARY_CLOSE]: [PeriodStage.UNDER_REVIEW, PeriodStage.OPEN],
  [PeriodStage.UNDER_REVIEW]: [PeriodStage.FINAL_CLOSE, PeriodStage.PRELIMINARY_CLOSE],
  [PeriodStage.FINAL_CLOSE]: [PeriodStage.AUDIT_ADJUSTMENT],
  [PeriodStage.AUDIT_ADJUSTMENT]: [], // terminal
};

/** Minimum tier required to initiate a transition */
const TRANSITION_MIN_TIER: Record<PeriodStage, PermissionTier> = {
  [PeriodStage.OPEN]: PermissionTier.CONTROLLER,
  [PeriodStage.PRELIMINARY_CLOSE]: PermissionTier.CONTROLLER,
  [PeriodStage.UNDER_REVIEW]: PermissionTier.CONTROLLER,
  [PeriodStage.FINAL_CLOSE]: PermissionTier.CFO,
  [PeriodStage.AUDIT_ADJUSTMENT]: PermissionTier.CFO,
};

export interface PeriodRecord {
  realmId: string;
  periodEnd: string; // YYYY-MM-DD
  stage: PeriodStage;
  updatedBy: string;
  updatedAt: number;
}

export interface WriteCheck {
  allowed: boolean;
  reason: string;
  requiresApproval?: boolean;
  requiresDualAuth?: boolean;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fiscal_periods (
      realm_id    TEXT NOT NULL,
      period_end  TEXT NOT NULL,
      stage       TEXT NOT NULL DEFAULT 'OPEN',
      updated_by  TEXT NOT NULL,
      updated_at  INTEGER NOT NULL,
      PRIMARY KEY (realm_id, period_end)
    );

    CREATE TABLE IF NOT EXISTS period_transitions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      realm_id    TEXT NOT NULL,
      period_end  TEXT NOT NULL,
      from_stage  TEXT NOT NULL,
      to_stage    TEXT NOT NULL,
      authorized_by TEXT NOT NULL,
      transitioned_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fiscal_config (
      realm_id          TEXT PRIMARY KEY,
      fiscal_year_start TEXT NOT NULL DEFAULT '01-01'
    );
  `);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the period-end date (last day of the fiscal month) for a given
 * transaction date. Uses a configurable fiscal year start month.
 */
function derivePeriodEnd(txnDate: string, fiscalYearStart: string): string {
  const [startMonth] = fiscalYearStart.split('-').map(Number);
  const txn = new Date(txnDate + 'T00:00:00Z');
  const year = txn.getUTCFullYear();
  const month = txn.getUTCMonth(); // 0-based

  // Determine the fiscal month boundary
  // The period-end is the last day of the calendar month the txn falls in
  const lastDay = new Date(Date.UTC(year, month + 1, 0));

  // If the fiscal year starts in a month other than January, adjust the
  // fiscal-year label but keep the period-end as the calendar month end
  void startMonth; // used for fiscal year label, not period-end derivation

  return lastDay.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// PeriodController class
// ---------------------------------------------------------------------------

export class PeriodController {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    initSchema(this.db);
  }

  /**
   * Set the fiscal year start for a realm (e.g. "04-01" for April).
   */
  setFiscalYearStart(realmId: string, monthDay: string): void {
    this.db
      .prepare(
        `INSERT INTO fiscal_config (realm_id, fiscal_year_start)
         VALUES (?, ?)
         ON CONFLICT(realm_id) DO UPDATE SET fiscal_year_start = excluded.fiscal_year_start`,
      )
      .run(realmId, monthDay);
  }

  /**
   * Get the fiscal year start for a realm (defaults to "01-01").
   */
  getFiscalYearStart(realmId: string): string {
    const row = this.db
      .prepare('SELECT fiscal_year_start FROM fiscal_config WHERE realm_id = ?')
      .get(realmId) as { fiscal_year_start: string } | undefined;
    return row?.fiscal_year_start ?? '01-01';
  }

  /**
   * Get the period stage for a given realm and transaction date.
   * If no explicit period record exists, the period is OPEN.
   */
  getPeriodStatus(realmId: string, date: string): PeriodStage {
    const fiscalStart = this.getFiscalYearStart(realmId);
    const periodEnd = derivePeriodEnd(date, fiscalStart);

    const row = this.db
      .prepare('SELECT stage FROM fiscal_periods WHERE realm_id = ? AND period_end = ?')
      .get(realmId, periodEnd) as { stage: string } | undefined;

    return (row?.stage as PeriodStage) ?? PeriodStage.OPEN;
  }

  /**
   * Get the full period record (or null if it has never been explicitly set).
   */
  getPeriodRecord(realmId: string, periodEnd: string): PeriodRecord | null {
    const row = this.db
      .prepare('SELECT * FROM fiscal_periods WHERE realm_id = ? AND period_end = ?')
      .get(realmId, periodEnd) as Record<string, unknown> | undefined;

    if (!row) return null;
    return {
      realmId: row['realm_id'] as string,
      periodEnd: row['period_end'] as string,
      stage: row['stage'] as PeriodStage,
      updatedBy: row['updated_by'] as string,
      updatedAt: row['updated_at'] as number,
    };
  }

  /**
   * Transition a period to a new stage with authorization checks.
   */
  transitionPeriod(
    realmId: string,
    periodEnd: string,
    newStage: PeriodStage,
    authorizedBy: Session,
  ): void {
    const current = this.getPeriodRecord(realmId, periodEnd);
    const currentStage = current?.stage ?? PeriodStage.OPEN;

    // Validate transition is allowed
    const allowed = VALID_TRANSITIONS[currentStage];
    if (!allowed.includes(newStage)) {
      throw new Error(
        `Invalid period transition: ${currentStage} -> ${newStage}. Allowed: [${allowed.join(', ')}]`,
      );
    }

    // Validate tier
    const minTier = TRANSITION_MIN_TIER[newStage];
    if (authorizedBy.tier < minTier) {
      throw new Error(
        `Tier ${PermissionTier[authorizedBy.tier]} cannot transition to ${newStage}; requires ${PermissionTier[minTier]} or higher`,
      );
    }

    const now = Date.now();

    // Upsert the period record
    this.db
      .prepare(
        `INSERT INTO fiscal_periods (realm_id, period_end, stage, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(realm_id, period_end) DO UPDATE
           SET stage = excluded.stage,
               updated_by = excluded.updated_by,
               updated_at = excluded.updated_at`,
      )
      .run(realmId, periodEnd, newStage, authorizedBy.userId, now);

    // Log the transition
    this.db
      .prepare(
        `INSERT INTO period_transitions (realm_id, period_end, from_stage, to_stage, authorized_by, transitioned_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(realmId, periodEnd, currentStage, newStage, authorizedBy.userId, now);
  }

  /**
   * Determine whether a write operation is allowed for a given date.
   *
   * Stage rules:
   *   OPEN                -> all operations allowed
   *   PRELIMINARY_CLOSE   -> only AJEs with Controller approval
   *   UNDER_REVIEW        -> only Controller-approved AJEs
   *   FINAL_CLOSE         -> only audit adjustments with dual auth
   *   AUDIT_ADJUSTMENT    -> frozen; only auditor-approved entries
   */
  canWrite(realmId: string, txnDate: string, operation: string): WriteCheck {
    const stage = this.getPeriodStatus(realmId, txnDate);

    switch (stage) {
      case PeriodStage.OPEN:
        return { allowed: true, reason: 'Period is open' };

      case PeriodStage.PRELIMINARY_CLOSE:
        if (operation === 'CREATE_AJE' || operation === 'ADJUSTING_ENTRY') {
          return {
            allowed: true,
            reason: 'Preliminary close: adjusting journal entries allowed with Controller approval',
            requiresApproval: true,
          };
        }
        return {
          allowed: false,
          reason: `Period is in preliminary close; only adjusting journal entries are permitted (attempted: ${operation})`,
        };

      case PeriodStage.UNDER_REVIEW:
        if (operation === 'CREATE_AJE' || operation === 'ADJUSTING_ENTRY') {
          return {
            allowed: true,
            reason: 'Under review: adjusting journal entries allowed with Controller approval',
            requiresApproval: true,
          };
        }
        return {
          allowed: false,
          reason: `Period is under review; only Controller-approved AJEs are permitted (attempted: ${operation})`,
        };

      case PeriodStage.FINAL_CLOSE:
        if (operation === 'AUDIT_ADJUSTMENT') {
          return {
            allowed: true,
            reason: 'Final close: audit adjustments allowed with dual authorization',
            requiresApproval: true,
            requiresDualAuth: true,
          };
        }
        return {
          allowed: false,
          reason: `Period is in final close; only audit adjustments with dual auth are permitted (attempted: ${operation})`,
        };

      case PeriodStage.AUDIT_ADJUSTMENT:
        if (operation === 'AUDITOR_ENTRY') {
          return {
            allowed: true,
            reason: 'Audit adjustment period: auditor-approved entries only',
            requiresApproval: true,
            requiresDualAuth: true,
          };
        }
        return {
          allowed: false,
          reason: `Period is frozen for audit adjustments; only auditor-approved entries are permitted (attempted: ${operation})`,
        };

      default:
        return { allowed: false, reason: `Unknown period stage: ${stage}` };
    }
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}
