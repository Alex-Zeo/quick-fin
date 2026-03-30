/**
 * Pre-submit validation pipeline.
 *
 * Chains all validators and runs applicable ones based on entity type.
 */

import type { ValidationResult, ValidationError } from './je-balance.js';
import { validateJEBalance } from './je-balance.js';
import { validateAccountRef, type HttpClient } from './account-validity.js';
import { validateTaxCode } from './tax-compliance.js';
import { validateCurrency } from './currency-guard.js';

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type { ValidationResult, ValidationError } from './je-balance.js';
export type { HttpClient } from './account-validity.js';
export { validateJEBalance } from './je-balance.js';
export { validateAccountRef } from './account-validity.js';
export { validateTaxCode } from './tax-compliance.js';
export { validateCurrency } from './currency-guard.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EntityType = string;
type OperationType = 'CREATE' | 'UPDATE' | 'DELETE' | 'VOID';

// ---------------------------------------------------------------------------
// PreSubmitValidator
// ---------------------------------------------------------------------------

/**
 * Chains all pre-submit validators and runs applicable ones
 * based on entity type and operation.
 */
export class PreSubmitValidator {
  /**
   * Run all applicable validators for the given entity type and operation.
   *
   * @param realmId     QBO company ID
   * @param entityType  QBO entity type (e.g. 'Invoice', 'JournalEntry')
   * @param operation   The operation being performed
   * @param payload     The entity payload
   * @param httpClient  HTTP client for QBO API calls
   * @returns Array of validation results from all applicable validators
   */
  async validate(
    realmId: string,
    entityType: EntityType,
    operation: OperationType,
    payload: Record<string, unknown>,
    httpClient: HttpClient,
  ): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    // Only validate on CREATE and UPDATE — DELETE/VOID don't submit payloads
    if (operation !== 'CREATE' && operation !== 'UPDATE') {
      return results;
    }

    // 1. JournalEntry balance check
    if (entityType === 'JournalEntry') {
      results.push(validateJEBalance(payload));
    }

    // 2. Account reference validation
    const accountRefs = this.extractAccountRefs(entityType, payload);
    for (const { ref, context } of accountRefs) {
      const result = await validateAccountRef(realmId, ref, httpClient, context);
      results.push(result);
    }

    // 3. Tax compliance
    const lines = (payload.Line ?? []) as Array<Record<string, unknown>>;
    if (lines.length > 0) {
      const taxResult = await validateTaxCode(realmId, lines, httpClient, entityType);
      results.push(taxResult);
    }

    // 4. Currency consistency
    const currencyResult = await validateCurrency(realmId, payload, httpClient);
    results.push(currencyResult);

    return results;
  }

  /**
   * Convenience: validate and return a flat list of errors.
   * Throws nothing — the caller decides how to handle errors.
   */
  async validateFlat(
    realmId: string,
    entityType: EntityType,
    operation: OperationType,
    payload: Record<string, unknown>,
    httpClient: HttpClient,
  ): Promise<{ valid: boolean; errors: ValidationError[] }> {
    const results = await this.validate(realmId, entityType, operation, payload, httpClient);
    const errors = results.flatMap((r) => r.errors);
    return { valid: errors.length === 0, errors };
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private extractAccountRefs(
    entityType: string,
    payload: Record<string, unknown>,
  ): Array<{ ref: { value: string; name?: string }; context: string }> {
    const refs: Array<{ ref: { value: string; name?: string }; context: string }> = [];

    // Top-level account refs
    const topLevelRefs: Array<{ key: string; contextSuffix: string }> = [
      { key: 'DepositToAccountRef', contextSuffix: 'DepositToAccount' },
      { key: 'ARAccountRef', contextSuffix: 'ARAccount' },
      { key: 'APAccountRef', contextSuffix: 'APAccount' },
    ];

    for (const { key, contextSuffix } of topLevelRefs) {
      const ref = payload[key] as { value?: string; name?: string } | undefined;
      if (ref?.value) {
        refs.push({ ref: { value: ref.value, name: ref.name }, context: `${entityType}:${contextSuffix}` });
      }
    }

    // Line-level account refs
    const lines = payload.Line as Array<Record<string, unknown>> | undefined;
    if (lines) {
      for (const line of lines) {
        // JournalEntry lines
        const jeDetail = line.JournalEntryLineDetail as Record<string, unknown> | undefined;
        if (jeDetail) {
          const accountRef = jeDetail.AccountRef as { value?: string; name?: string } | undefined;
          if (accountRef?.value) {
            refs.push({ ref: { value: accountRef.value, name: accountRef.name }, context: `${entityType}:Account` });
          }
        }

        // Sales/expense line details
        for (const detailKey of ['SalesItemLineDetail', 'ItemBasedExpenseLineDetail', 'AccountBasedExpenseLineDetail']) {
          const detail = line[detailKey] as Record<string, unknown> | undefined;
          if (detail) {
            const itemAccountRef = detail.ItemAccountRef as { value?: string; name?: string } | undefined;
            if (itemAccountRef?.value) {
              refs.push({
                ref: { value: itemAccountRef.value, name: itemAccountRef.name },
                context: `${entityType}:ExpenseAccount`,
              });
            }
          }
        }
      }
    }

    return refs;
  }
}
