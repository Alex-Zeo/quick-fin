/**
 * Fuzzy duplicate detection for QBO entities.
 *
 * Checks same counterparty + amount within 5% + date within 30 days +
 * similar reference number to identify potential duplicate transactions.
 */

import Decimal from 'decimal.js';
import type { HttpClient } from './pre-submit/account-validity.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DuplicateMatch {
  entityId: string;
  entityType: string;
  confidence: number; // 0-1
  matchReasons: string[];
  entity: Record<string, unknown>;
}

export interface DuplicateResult {
  isDuplicate: boolean;
  confidence: number; // highest match confidence
  matches: DuplicateMatch[];
}

interface EntityPayload {
  CustomerRef?: { value: string; name?: string };
  VendorRef?: { value: string; name?: string };
  TotalAmt?: string | number;
  TxnDate?: string;
  DocNumber?: string;
  PaymentRefNum?: string;
  Line?: Array<{ Amount?: string | number; [key: string]: unknown }>;
  [key: string]: unknown;
}

interface QBOQueryResponseData {
  [entityType: string]: Array<Record<string, unknown>> | number | undefined;
}

interface QBOQueryResponse {
  QueryResponse?: QBOQueryResponseData;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Amount must be within 5% to be considered a potential duplicate */
const AMOUNT_TOLERANCE = 0.05;

/** Date must be within 30 days */
const DATE_WINDOW_DAYS = 30;

/** Confidence thresholds */
const DUPLICATE_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// DuplicateDetector
// ---------------------------------------------------------------------------

export class DuplicateDetector {
  /**
   * Check for potential duplicate entities in QBO.
   *
   * @param realmId     QBO company ID
   * @param entityType  QBO entity type (e.g. 'Invoice', 'Bill', 'Payment')
   * @param entity      The entity payload to check
   * @param httpClient  HTTP client for QBO API calls
   */
  async check(
    realmId: string,
    entityType: string,
    entity: EntityPayload,
    httpClient: HttpClient,
  ): Promise<DuplicateResult> {
    const counterpartyRef = entity.CustomerRef ?? entity.VendorRef;
    const counterpartyField = entity.CustomerRef ? 'CustomerRef' : 'VendorRef';
    const amount = this.extractAmount(entity);
    const txnDate = entity.TxnDate;

    // Need at least counterparty or amount to do meaningful detection
    if (!counterpartyRef?.value && amount === null) {
      return { isDuplicate: false, confidence: 0, matches: [] };
    }

    // Build query to find potential matches
    const conditions: string[] = [];

    if (counterpartyRef?.value) {
      conditions.push(`${counterpartyField} = '${counterpartyRef.value}'`);
    }

    if (txnDate) {
      const dateRange = this.getDateRange(txnDate, DATE_WINDOW_DAYS);
      conditions.push(`TxnDate >= '${dateRange.start}' AND TxnDate <= '${dateRange.end}'`);
    }

    if (conditions.length === 0) {
      return { isDuplicate: false, confidence: 0, matches: [] };
    }

    const whereClause = conditions.join(' AND ');
    const sql = `SELECT * FROM ${entityType} WHERE ${whereClause} MAXRESULTS 50`;

    let candidates: Array<Record<string, unknown>>;
    try {
      const result = await httpClient.query(realmId, sql);
      const body = result.body as QBOQueryResponse;
      candidates = (body?.QueryResponse as Record<string, unknown>)?.[entityType] as Array<Record<string, unknown>> ?? [];
    } catch {
      // If query fails, cannot determine duplicates
      return { isDuplicate: false, confidence: 0, matches: [] };
    }

    // Score each candidate
    const matches: DuplicateMatch[] = [];

    for (const candidate of candidates) {
      const score = this.scoreMatch(entity, candidate, entityType);
      if (score.confidence >= 0.4) {
        matches.push({
          entityId: String(candidate.Id ?? ''),
          entityType,
          confidence: score.confidence,
          matchReasons: score.reasons,
          entity: candidate,
        });
      }
    }

    // Sort by confidence descending
    matches.sort((a, b) => b.confidence - a.confidence);

    const highestConfidence = matches.length > 0 ? matches[0].confidence : 0;

    return {
      isDuplicate: highestConfidence >= DUPLICATE_THRESHOLD,
      confidence: highestConfidence,
      matches,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private extractAmount(entity: EntityPayload): Decimal | null {
    if (entity.TotalAmt != null) {
      try {
        return new Decimal(String(entity.TotalAmt));
      } catch {
        return null;
      }
    }

    // Sum line amounts as fallback
    if (entity.Line && entity.Line.length > 0) {
      let total = new Decimal(0);
      for (const line of entity.Line) {
        if (line.Amount != null) {
          try {
            total = total.plus(new Decimal(String(line.Amount)));
          } catch {
            // skip invalid amounts
          }
        }
      }
      return total.isZero() ? null : total;
    }

    return null;
  }

  private scoreMatch(
    entity: EntityPayload,
    candidate: Record<string, unknown>,
    _entityType: string,
  ): { confidence: number; reasons: string[] } {
    const reasons: string[] = [];
    let totalWeight = 0;
    let matchedWeight = 0;

    // --- Counterparty match (weight: 30) ---
    const entityCounterparty = entity.CustomerRef?.value ?? entity.VendorRef?.value;
    const candidateCounterparty =
      (candidate.CustomerRef as { value?: string })?.value ??
      (candidate.VendorRef as { value?: string })?.value;

    totalWeight += 30;
    if (entityCounterparty && candidateCounterparty && entityCounterparty === candidateCounterparty) {
      matchedWeight += 30;
      reasons.push('Same counterparty');
    }

    // --- Amount match within tolerance (weight: 35) ---
    const entityAmount = this.extractAmount(entity);
    const candidateAmount = candidate.TotalAmt != null
      ? (() => { try { return new Decimal(String(candidate.TotalAmt)); } catch { return null; } })()
      : null;

    totalWeight += 35;
    if (entityAmount && candidateAmount && entityAmount.gt(0) && candidateAmount.gt(0)) {
      const deviation = entityAmount.minus(candidateAmount).abs().div(entityAmount);
      if (deviation.lte(AMOUNT_TOLERANCE)) {
        matchedWeight += 35;
        if (entityAmount.equals(candidateAmount)) {
          reasons.push('Exact amount match');
        } else {
          reasons.push(`Amount within ${deviation.times(100).toFixed(1)}% tolerance`);
        }
      }
    }

    // --- Date proximity (weight: 20) ---
    const entityDate = entity.TxnDate;
    const candidateDate = candidate.TxnDate as string | undefined;

    totalWeight += 20;
    if (entityDate && candidateDate) {
      const daysDiff = Math.abs(this.daysBetween(entityDate, candidateDate));
      if (daysDiff === 0) {
        matchedWeight += 20;
        reasons.push('Same date');
      } else if (daysDiff <= 3) {
        matchedWeight += 15;
        reasons.push(`Date within ${daysDiff} day(s)`);
      } else if (daysDiff <= DATE_WINDOW_DAYS) {
        matchedWeight += 5;
        reasons.push(`Date within ${daysDiff} days`);
      }
    }

    // --- Reference number match (weight: 15) ---
    const entityRef = entity.DocNumber ?? entity.PaymentRefNum ?? '';
    const candidateRef = (candidate.DocNumber as string) ?? (candidate.PaymentRefNum as string) ?? '';

    totalWeight += 15;
    if (entityRef && candidateRef) {
      if (entityRef === candidateRef) {
        matchedWeight += 15;
        reasons.push('Exact reference match');
      } else if (this.fuzzyRefMatch(entityRef, candidateRef)) {
        matchedWeight += 10;
        reasons.push('Similar reference number');
      }
    }

    const confidence = totalWeight > 0 ? matchedWeight / totalWeight : 0;
    return { confidence: Math.round(confidence * 100) / 100, reasons };
  }

  private getDateRange(dateStr: string, windowDays: number): { start: string; end: string } {
    const date = new Date(dateStr);
    const start = new Date(date);
    start.setDate(start.getDate() - windowDays);
    const end = new Date(date);
    end.setDate(end.getDate() + windowDays);
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  }

  private daysBetween(a: string, b: string): number {
    const dateA = new Date(a);
    const dateB = new Date(b);
    const diffMs = dateA.getTime() - dateB.getTime();
    return Math.round(diffMs / (24 * 60 * 60 * 1000));
  }

  /**
   * Fuzzy reference matching: normalized comparison after
   * stripping common prefixes/suffixes and non-alphanumeric chars.
   */
  private fuzzyRefMatch(a: string, b: string): boolean {
    const normalize = (s: string): string =>
      s.replace(/^(INV|BILL|PMT|JE|SO|EST|CM|SR|PO|REF|#)[-\s#]*/i, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase();

    const normA = normalize(a);
    const normB = normalize(b);

    if (!normA || !normB) return false;
    return normA === normB || normA.includes(normB) || normB.includes(normA);
  }
}
