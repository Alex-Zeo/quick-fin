/**
 * Segregation of Duties (SoD) engine — in-memory conflict detection.
 *
 * Prevents a single session from executing incompatible operations within
 * a configurable time window (default 24 hours).
 */

import type { Session } from './rbac.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SoDContext {
  entityId?: string;
  counterpartyId?: string;
  /** Additional context for same-entity checks (e.g. bank detail fields). */
  meta?: Record<string, unknown>;
}

export interface SoDResult {
  ok: boolean;
  conflict?: {
    rule: string;
    priorOperation: string;
    priorEntityType: string;
    priorTimestamp: number;
    message: string;
  };
}

interface OperationRecord {
  operation: string;
  entityType: string;
  entityId?: string;
  counterpartyId?: string;
  meta?: Record<string, unknown>;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Conflict rule definition
// ---------------------------------------------------------------------------

interface ConflictRule {
  name: string;
  operationA: string;
  entityTypeA: string;
  operationB: string;
  entityTypeB: string;
  /** When true, conflict only fires if the counterpartyId matches. */
  sameCounterparty?: boolean;
  /** When true, conflict only fires if entityId matches. */
  sameEntity?: boolean;
  /** Match on meta key (e.g. "bankDetails" for vendor bank detail changes). */
  metaKey?: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Hardcoded conflict matrix
// ---------------------------------------------------------------------------

const CONFLICT_RULES: readonly ConflictRule[] = [
  {
    name: 'vendor-create-billpayment',
    operationA: 'CREATE',
    entityTypeA: 'Vendor',
    operationB: 'CREATE',
    entityTypeB: 'BillPayment',
    sameCounterparty: true,
    message: 'Cannot create a vendor and pay that vendor in the same session window',
  },
  {
    name: 'invoice-create-payment',
    operationA: 'CREATE',
    entityTypeA: 'Invoice',
    operationB: 'CREATE',
    entityTypeB: 'Payment',
    sameCounterparty: true,
    message: 'Cannot create an invoice and collect payment for the same customer in the same session window',
  },
  {
    name: 'journal-create-approve',
    operationA: 'CREATE',
    entityTypeA: 'JournalEntry',
    operationB: 'APPROVE',
    entityTypeB: 'JournalEntry',
    sameEntity: false, // any JE create + any JE approve in the same session
    message: 'Cannot create and approve journal entries in the same session window',
  },
  {
    name: 'account-update-journal-create',
    operationA: 'UPDATE',
    entityTypeA: 'Account',
    operationB: 'CREATE',
    entityTypeB: 'JournalEntry',
    message: 'Cannot modify account structure and create journal entries in the same session window',
  },
  {
    name: 'vendor-bank-update-billpayment',
    operationA: 'UPDATE',
    entityTypeA: 'Vendor',
    operationB: 'CREATE',
    entityTypeB: 'BillPayment',
    sameCounterparty: true,
    metaKey: 'bankDetails',
    message: 'Cannot update vendor bank details and create a bill payment for the same vendor in the same session window',
  },
] as const;

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class SoDEngine {
  /** sessionId -> list of recent operations */
  private readonly history = new Map<string, OperationRecord[]>();
  /** Window in milliseconds (default 24h) */
  private readonly windowMs: number;

  constructor(windowHours = 24) {
    this.windowMs = windowHours * 60 * 60 * 1000;
  }

  /**
   * Check whether the proposed operation conflicts with any prior
   * operations in this session's history window.
   */
  check(
    session: Session,
    operation: string,
    entityType: string,
    context?: SoDContext,
  ): SoDResult {
    const records = this.getRecent(session.sessionId);

    for (const rule of CONFLICT_RULES) {
      // Check both directions: proposed is B and history has A, or proposed is A and history has B.
      const match = this.matchRule(rule, operation, entityType, context, records);
      if (match) {
        return {
          ok: false,
          conflict: {
            rule: rule.name,
            priorOperation: match.operation,
            priorEntityType: match.entityType,
            priorTimestamp: match.timestamp,
            message: rule.message,
          },
        };
      }
    }

    return { ok: true };
  }

  /**
   * Record an operation for future SoD checks.
   * Call this AFTER the operation succeeds.
   */
  record(
    session: Session,
    operation: string,
    entityType: string,
    context?: SoDContext,
  ): void {
    if (!this.history.has(session.sessionId)) {
      this.history.set(session.sessionId, []);
    }
    this.history.get(session.sessionId)!.push({
      operation,
      entityType,
      entityId: context?.entityId,
      counterpartyId: context?.counterpartyId,
      meta: context?.meta,
      timestamp: Date.now(),
    });
  }

  /**
   * Purge records older than the window for a specific session.
   */
  prune(sessionId: string): void {
    const cutoff = Date.now() - this.windowMs;
    const records = this.history.get(sessionId);
    if (!records) return;
    const pruned = records.filter((r) => r.timestamp > cutoff);
    if (pruned.length === 0) {
      this.history.delete(sessionId);
    } else {
      this.history.set(sessionId, pruned);
    }
  }

  /**
   * Purge all expired records across all sessions.
   */
  pruneAll(): void {
    for (const sessionId of this.history.keys()) {
      this.prune(sessionId);
    }
  }

  /**
   * Clear all history (for testing).
   */
  clear(): void {
    this.history.clear();
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private getRecent(sessionId: string): OperationRecord[] {
    const cutoff = Date.now() - this.windowMs;
    const records = this.history.get(sessionId) ?? [];
    return records.filter((r) => r.timestamp > cutoff);
  }

  private matchRule(
    rule: ConflictRule,
    proposedOp: string,
    proposedType: string,
    proposedCtx: SoDContext | undefined,
    history: OperationRecord[],
  ): OperationRecord | null {
    // Direction 1: proposed = B, history has A
    if (proposedOp === rule.operationB && proposedType === rule.entityTypeB) {
      for (const rec of history) {
        if (rec.operation === rule.operationA && rec.entityType === rule.entityTypeA) {
          if (this.contextMatches(rule, rec, proposedCtx)) {
            return rec;
          }
        }
      }
    }

    // Direction 2: proposed = A, history has B
    if (proposedOp === rule.operationA && proposedType === rule.entityTypeA) {
      for (const rec of history) {
        if (rec.operation === rule.operationB && rec.entityType === rule.entityTypeB) {
          if (this.contextMatches(rule, rec, proposedCtx)) {
            return rec;
          }
        }
      }
    }

    return null;
  }

  private contextMatches(
    rule: ConflictRule,
    historic: OperationRecord,
    proposed: SoDContext | undefined,
  ): boolean {
    // Same-counterparty check
    if (rule.sameCounterparty) {
      const hCp = historic.counterpartyId;
      const pCp = proposed?.counterpartyId;
      if (!hCp || !pCp || hCp !== pCp) return false;
    }

    // Same-entity check
    if (rule.sameEntity) {
      const hId = historic.entityId;
      const pId = proposed?.entityId;
      if (!hId || !pId || hId !== pId) return false;
    }

    // Meta key check (e.g., bankDetails flag)
    if (rule.metaKey) {
      const hasMeta = historic.meta?.[rule.metaKey] || proposed?.meta?.[rule.metaKey];
      if (!hasMeta) return false;
    }

    return true;
  }
}
