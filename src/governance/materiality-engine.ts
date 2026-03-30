/**
 * Materiality engine — dollar-threshold routing and daily aggregate tracking.
 *
 * Classifies transactions into AUTO / SINGLE_APPROVAL / DUAL_APPROVAL based
 * on configurable thresholds from the ControlThresholds config. Tracks daily
 * aggregates per realm to enforce velocity limits.
 */

import type { ControlThresholds } from '../config/schema.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum MaterialityLevel {
  /** Below threshold — no approval needed */
  AUTO = 'AUTO',
  /** Normal — single approver required */
  SINGLE_APPROVAL = 'SINGLE_APPROVAL',
  /** Material — dual approval required */
  DUAL_APPROVAL = 'DUAL_APPROVAL',
}

export interface MaterialityResult {
  level: MaterialityLevel;
  autoMax: number;
  singleMax: number;
}

export interface DailyTotals {
  realmId: string;
  date: string; // YYYY-MM-DD
  paymentValue: number;
  invoiceValue: number;
  journalEntryCount: number;
  recordsModified: number;
  recordsDeleted: number;
  paymentCount: number;
}

export interface DailyLimitCheck {
  allowed: boolean;
  reason: string;
  currentTotal?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Threshold map: entity type -> [autoMax field, singleApprovalMax field]
// ---------------------------------------------------------------------------

type ThresholdKey = keyof ControlThresholds;

const ENTITY_THRESHOLDS: Record<string, [ThresholdKey, ThresholdKey]> = {
  Invoice: ['invoiceAutoMax', 'invoiceSingleApprovalMax'],
  Bill: ['billAutoMax', 'billSingleApprovalMax'],
  Payment: ['paymentSingleApprovalMax', 'paymentSingleApprovalMax'],
  BillPayment: ['paymentSingleApprovalMax', 'paymentSingleApprovalMax'],
  Refund: ['refundSingleApprovalMax', 'refundSingleApprovalMax'],
  CreditMemo: ['refundSingleApprovalMax', 'refundSingleApprovalMax'],
  JournalEntry: ['journalEntryAutoMax', 'journalEntrySingleApprovalMax'],
  Expense: ['expenseAutoMax', 'expenseSingleApprovalMax'],
  Purchase: ['expenseAutoMax', 'expenseSingleApprovalMax'],
  Estimate: ['estimateAutoMax', 'estimateSingleApprovalMax'],
  SalesReceipt: ['invoiceAutoMax', 'invoiceSingleApprovalMax'],
};

// ---------------------------------------------------------------------------
// Daily aggregates — in-memory store keyed by "realmId:YYYY-MM-DD"
// ---------------------------------------------------------------------------

function todayKey(realmId: string): string {
  const d = new Date();
  const dateStr = d.toISOString().slice(0, 10);
  return `${realmId}:${dateStr}`;
}

function emptyTotals(realmId: string): DailyTotals {
  return {
    realmId,
    date: new Date().toISOString().slice(0, 10),
    paymentValue: 0,
    invoiceValue: 0,
    journalEntryCount: 0,
    recordsModified: 0,
    recordsDeleted: 0,
    paymentCount: 0,
  };
}

// ---------------------------------------------------------------------------
// MaterialityEngine class
// ---------------------------------------------------------------------------

export class MaterialityEngine {
  private readonly thresholds: ControlThresholds;
  private readonly dailyStore = new Map<string, DailyTotals>();

  constructor(thresholds: ControlThresholds) {
    this.thresholds = thresholds;
  }

  /**
   * Classify a transaction amount for a given entity type.
   *
   *   amount <= autoMax           -> AUTO
   *   autoMax < amount <= singleMax -> SINGLE_APPROVAL
   *   amount > singleMax          -> DUAL_APPROVAL
   */
  classify(entityType: string, amount: number): MaterialityResult {
    const mapping = ENTITY_THRESHOLDS[entityType];
    if (!mapping) {
      // Unknown entity type — require single approval as a safe default
      return {
        level: amount <= 1000 ? MaterialityLevel.AUTO : MaterialityLevel.SINGLE_APPROVAL,
        autoMax: 1000,
        singleMax: Infinity,
      };
    }

    const [autoKey, singleKey] = mapping;
    const autoMax = this.thresholds[autoKey] as number;
    const singleMax = this.thresholds[singleKey] as number;

    let level: MaterialityLevel;
    if (amount <= autoMax) {
      level = MaterialityLevel.AUTO;
    } else if (amount <= singleMax) {
      level = MaterialityLevel.SINGLE_APPROVAL;
    } else {
      level = MaterialityLevel.DUAL_APPROVAL;
    }

    return { level, autoMax, singleMax };
  }

  /**
   * Record a completed transaction in daily aggregates.
   */
  recordTransaction(
    realmId: string,
    entityType: string,
    amount: number,
    operation: string = 'CREATE',
  ): void {
    const key = todayKey(realmId);
    if (!this.dailyStore.has(key)) {
      this.dailyStore.set(key, emptyTotals(realmId));
    }
    const totals = this.dailyStore.get(key)!;

    // Accumulate by entity type
    const lowerType = entityType.toLowerCase();
    if (lowerType === 'payment' || lowerType === 'billpayment') {
      totals.paymentValue += Math.abs(amount);
      totals.paymentCount += 1;
    } else if (lowerType === 'invoice' || lowerType === 'salesreceipt') {
      totals.invoiceValue += Math.abs(amount);
    } else if (lowerType === 'journalentry') {
      totals.journalEntryCount += 1;
    }

    // Track modifications and deletions
    if (operation === 'UPDATE' || operation === 'CREATE') {
      totals.recordsModified += 1;
    } else if (operation === 'DELETE' || operation === 'VOID') {
      totals.recordsDeleted += 1;
    }
  }

  /**
   * Get current day's aggregate totals for a realm.
   */
  getDailyTotals(realmId: string): DailyTotals {
    const key = todayKey(realmId);
    return this.dailyStore.get(key) ?? emptyTotals(realmId);
  }

  /**
   * Check whether a new transaction would breach daily limits.
   */
  checkDailyLimits(
    realmId: string,
    entityType: string,
    amount: number,
    operation: string = 'CREATE',
  ): DailyLimitCheck {
    const totals = this.getDailyTotals(realmId);
    const lowerType = entityType.toLowerCase();

    // Payment value limit
    if (lowerType === 'payment' || lowerType === 'billpayment') {
      const projected = totals.paymentValue + Math.abs(amount);
      if (projected > this.thresholds.dailyPaymentValueMax) {
        return {
          allowed: false,
          reason: `Daily payment value would reach $${projected.toFixed(2)}, exceeding limit of $${this.thresholds.dailyPaymentValueMax}`,
          currentTotal: totals.paymentValue,
          limit: this.thresholds.dailyPaymentValueMax,
        };
      }

      // Payment count limit
      if (totals.paymentCount + 1 > this.thresholds.paymentCountPerDay) {
        return {
          allowed: false,
          reason: `Daily payment count would reach ${totals.paymentCount + 1}, exceeding limit of ${this.thresholds.paymentCountPerDay}`,
          currentTotal: totals.paymentCount,
          limit: this.thresholds.paymentCountPerDay,
        };
      }
    }

    // Invoice value limit
    if (lowerType === 'invoice' || lowerType === 'salesreceipt') {
      const projected = totals.invoiceValue + Math.abs(amount);
      if (projected > this.thresholds.dailyInvoiceValueMax) {
        return {
          allowed: false,
          reason: `Daily invoice value would reach $${projected.toFixed(2)}, exceeding limit of $${this.thresholds.dailyInvoiceValueMax}`,
          currentTotal: totals.invoiceValue,
          limit: this.thresholds.dailyInvoiceValueMax,
        };
      }
    }

    // Journal entry count limit
    if (lowerType === 'journalentry') {
      if (totals.journalEntryCount + 1 > this.thresholds.dailyJournalEntryCountMax) {
        return {
          allowed: false,
          reason: `Daily journal entry count would reach ${totals.journalEntryCount + 1}, exceeding limit of ${this.thresholds.dailyJournalEntryCountMax}`,
          currentTotal: totals.journalEntryCount,
          limit: this.thresholds.dailyJournalEntryCountMax,
        };
      }
    }

    // Records modified limit
    if (operation === 'UPDATE' || operation === 'CREATE') {
      if (totals.recordsModified + 1 > this.thresholds.dailyRecordsModifiedMax) {
        return {
          allowed: false,
          reason: `Daily records modified would reach ${totals.recordsModified + 1}, exceeding limit of ${this.thresholds.dailyRecordsModifiedMax}`,
          currentTotal: totals.recordsModified,
          limit: this.thresholds.dailyRecordsModifiedMax,
        };
      }
    }

    // Records deleted limit
    if (operation === 'DELETE' || operation === 'VOID') {
      if (totals.recordsDeleted + 1 > this.thresholds.dailyRecordsDeletedMax) {
        return {
          allowed: false,
          reason: `Daily records deleted would reach ${totals.recordsDeleted + 1}, exceeding limit of ${this.thresholds.dailyRecordsDeletedMax}`,
          currentTotal: totals.recordsDeleted,
          limit: this.thresholds.dailyRecordsDeletedMax,
        };
      }
    }

    return { allowed: true, reason: 'Within daily limits' };
  }

  /**
   * Clear stale daily totals (call at midnight or on schedule).
   */
  pruneOldDays(): void {
    const today = new Date().toISOString().slice(0, 10);
    for (const [key] of this.dailyStore) {
      const keyDate = key.split(':').slice(1).join(':');
      if (keyDate !== today) {
        this.dailyStore.delete(key);
      }
    }
  }

  /**
   * Clear all aggregates (for testing).
   */
  clear(): void {
    this.dailyStore.clear();
  }
}
