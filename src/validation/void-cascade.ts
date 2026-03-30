/**
 * Void impact analysis.
 *
 * Before voiding an entity, analyzes linked transactions to determine
 * the cascade of affected entities and the correct void order.
 */

import type { HttpClient } from './pre-submit/account-validity.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AffectedEntity {
  entityType: string;
  entityId: string;
  docNumber?: string;
  amount?: string;
  relationship: string; // e.g. 'linked-payment', 'applied-credit-memo'
}

export interface CascadeResult {
  entityType: string;
  entityId: string;
  affectedEntities: AffectedEntity[];
  voidOrder: string[];
  warnings: string[];
  canVoid: boolean;
}

interface QBOQueryResponse {
  QueryResponse?: {
    [key: string]: Array<Record<string, unknown>> | number | undefined;
    totalCount?: number;
  };
}

// ---------------------------------------------------------------------------
// Correct void sequences
// ---------------------------------------------------------------------------

/**
 * Void order: entities must be voided in reverse dependency order.
 * A Payment applied to an Invoice must be voided before the Invoice.
 */
const VOID_ORDER_MAP: Record<string, string[]> = {
  Invoice: ['Payment', 'CreditMemo', 'Deposit', 'Invoice'],
  Bill: ['BillPayment', 'VendorCredit', 'Bill'],
  Payment: ['Payment'],
  BillPayment: ['BillPayment'],
  CreditMemo: ['CreditMemo'],
  VendorCredit: ['VendorCredit'],
  SalesReceipt: ['Deposit', 'SalesReceipt'],
  Estimate: ['Invoice', 'Estimate'],
  Deposit: ['Deposit'],
  JournalEntry: ['JournalEntry'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function queryLinked(
  realmId: string,
  entityType: string,
  entityId: string,
  httpClient: HttpClient,
): Promise<Array<Record<string, unknown>>> {
  try {
    const sql = `SELECT * FROM ${entityType} WHERE Id = '${entityId}'`;
    const result = await httpClient.query(realmId, sql);
    const body = result.body as QBOQueryResponse;
    return (body?.QueryResponse?.[entityType] as Array<Record<string, unknown>>) ?? [];
  } catch {
    return [];
  }
}

async function findLinkedPayments(
  realmId: string,
  invoiceId: string,
  httpClient: HttpClient,
): Promise<AffectedEntity[]> {
  const affected: AffectedEntity[] = [];

  try {
    // Query payments and check their Line items for links to this invoice
    const sql = `SELECT * FROM Payment MAXRESULTS 100`;
    const result = await httpClient.query(realmId, sql);
    const body = result.body as QBOQueryResponse;
    const payments = (body?.QueryResponse?.Payment as Array<Record<string, unknown>>) ?? [];

    for (const payment of payments) {
      const lines = (payment.Line as Array<Record<string, unknown>>) ?? [];
      for (const line of lines) {
        const linkedTxns = (line.LinkedTxn as Array<Record<string, unknown>>) ?? [];
        for (const linked of linkedTxns) {
          if (linked.TxnType === 'Invoice' && String(linked.TxnId) === invoiceId) {
            affected.push({
              entityType: 'Payment',
              entityId: String(payment.Id),
              docNumber: payment.DocNumber as string | undefined,
              amount: payment.TotalAmt != null ? String(payment.TotalAmt) : undefined,
              relationship: 'linked-payment',
            });
          }
        }
      }
    }
  } catch {
    // Non-fatal
  }

  return affected;
}

async function findLinkedCreditMemos(
  realmId: string,
  invoiceId: string,
  httpClient: HttpClient,
): Promise<AffectedEntity[]> {
  const affected: AffectedEntity[] = [];

  try {
    const sql = `SELECT * FROM CreditMemo MAXRESULTS 100`;
    const result = await httpClient.query(realmId, sql);
    const body = result.body as QBOQueryResponse;
    const creditMemos = (body?.QueryResponse?.CreditMemo as Array<Record<string, unknown>>) ?? [];

    for (const cm of creditMemos) {
      const lines = (cm.Line as Array<Record<string, unknown>>) ?? [];
      for (const line of lines) {
        const linkedTxns = (line.LinkedTxn as Array<Record<string, unknown>>) ?? [];
        for (const linked of linkedTxns) {
          if (linked.TxnType === 'Invoice' && String(linked.TxnId) === invoiceId) {
            affected.push({
              entityType: 'CreditMemo',
              entityId: String(cm.Id),
              docNumber: cm.DocNumber as string | undefined,
              amount: cm.TotalAmt != null ? String(cm.TotalAmt) : undefined,
              relationship: 'applied-credit-memo',
            });
          }
        }
      }
    }
  } catch {
    // Non-fatal
  }

  return affected;
}

async function findLinkedBillPayments(
  realmId: string,
  billId: string,
  httpClient: HttpClient,
): Promise<AffectedEntity[]> {
  const affected: AffectedEntity[] = [];

  try {
    const sql = `SELECT * FROM BillPayment MAXRESULTS 100`;
    const result = await httpClient.query(realmId, sql);
    const body = result.body as QBOQueryResponse;
    const billPayments = (body?.QueryResponse?.BillPayment as Array<Record<string, unknown>>) ?? [];

    for (const bp of billPayments) {
      const lines = (bp.Line as Array<Record<string, unknown>>) ?? [];
      for (const line of lines) {
        const linkedTxns = (line.LinkedTxn as Array<Record<string, unknown>>) ?? [];
        for (const linked of linkedTxns) {
          if (linked.TxnType === 'Bill' && String(linked.TxnId) === billId) {
            affected.push({
              entityType: 'BillPayment',
              entityId: String(bp.Id),
              docNumber: bp.DocNumber as string | undefined,
              amount: bp.TotalAmt != null ? String(bp.TotalAmt) : undefined,
              relationship: 'linked-bill-payment',
            });
          }
        }
      }
    }
  } catch {
    // Non-fatal
  }

  return affected;
}

async function findLinkedInvoicesForPayment(
  realmId: string,
  paymentId: string,
  httpClient: HttpClient,
): Promise<AffectedEntity[]> {
  const affected: AffectedEntity[] = [];

  const payments = await queryLinked(realmId, 'Payment', paymentId, httpClient);
  if (payments.length === 0) return affected;

  const payment = payments[0];
  const lines = (payment.Line as Array<Record<string, unknown>>) ?? [];

  for (const line of lines) {
    const linkedTxns = (line.LinkedTxn as Array<Record<string, unknown>>) ?? [];
    for (const linked of linkedTxns) {
      if (linked.TxnType === 'Invoice') {
        affected.push({
          entityType: 'Invoice',
          entityId: String(linked.TxnId),
          relationship: 'paid-invoice',
        });
      }
    }
  }

  return affected;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the correct void order for an entity type.
 * Dependencies must be voided first (reverse dependency order).
 */
export function getVoidOrder(entityType: string): string[] {
  return VOID_ORDER_MAP[entityType] ?? [entityType];
}

/**
 * Analyze the cascade impact of voiding an entity.
 *
 * @param realmId     QBO company ID
 * @param entityType  The type of entity being voided
 * @param entityId    The ID of the entity being voided
 * @param httpClient  HTTP client for QBO API calls
 */
export async function analyzeCascade(
  realmId: string,
  entityType: string,
  entityId: string,
  httpClient: HttpClient,
): Promise<CascadeResult> {
  const affectedEntities: AffectedEntity[] = [];
  const warnings: string[] = [];

  switch (entityType) {
    case 'Invoice': {
      const [payments, creditMemos] = await Promise.all([
        findLinkedPayments(realmId, entityId, httpClient),
        findLinkedCreditMemos(realmId, entityId, httpClient),
      ]);

      affectedEntities.push(...payments, ...creditMemos);

      if (payments.length > 0) {
        warnings.push(
          `${payments.length} payment(s) are linked to this invoice and must be voided first`,
        );
      }
      if (creditMemos.length > 0) {
        warnings.push(
          `${creditMemos.length} credit memo(s) are applied to this invoice and must be unapplied or voided first`,
        );
      }
      break;
    }

    case 'Bill': {
      const billPayments = await findLinkedBillPayments(realmId, entityId, httpClient);
      affectedEntities.push(...billPayments);

      if (billPayments.length > 0) {
        warnings.push(
          `${billPayments.length} bill payment(s) are linked to this bill and must be voided first`,
        );
      }
      break;
    }

    case 'Payment': {
      const invoices = await findLinkedInvoicesForPayment(realmId, entityId, httpClient);
      affectedEntities.push(...invoices);

      if (invoices.length > 0) {
        warnings.push(
          `Voiding this payment will re-open ${invoices.length} invoice(s)`,
        );
      }
      break;
    }

    case 'SalesReceipt': {
      // SalesReceipts may have deposits
      try {
        const sql = `SELECT * FROM Deposit MAXRESULTS 100`;
        const result = await httpClient.query(realmId, sql);
        const body = result.body as QBOQueryResponse;
        const deposits = (body?.QueryResponse?.Deposit as Array<Record<string, unknown>>) ?? [];

        for (const deposit of deposits) {
          const lines = (deposit.Line as Array<Record<string, unknown>>) ?? [];
          for (const line of lines) {
            const linkedTxns = (line.LinkedTxn as Array<Record<string, unknown>>) ?? [];
            for (const linked of linkedTxns) {
              if (linked.TxnType === 'SalesReceipt' && String(linked.TxnId) === entityId) {
                affectedEntities.push({
                  entityType: 'Deposit',
                  entityId: String(deposit.Id),
                  amount: deposit.TotalAmt != null ? String(deposit.TotalAmt) : undefined,
                  relationship: 'linked-deposit',
                });
              }
            }
          }
        }
      } catch {
        // Non-fatal
      }

      if (affectedEntities.length > 0) {
        warnings.push(
          `${affectedEntities.length} deposit(s) include this sales receipt and must be modified first`,
        );
      }
      break;
    }
  }

  const voidOrder = getVoidOrder(entityType);
  const hasBlockingDependencies = affectedEntities.some(
    (e) => voidOrder.indexOf(e.entityType) < voidOrder.indexOf(entityType),
  );

  return {
    entityType,
    entityId,
    affectedEntities,
    voidOrder,
    warnings,
    canVoid: !hasBlockingDependencies || affectedEntities.length === 0,
  };
}
