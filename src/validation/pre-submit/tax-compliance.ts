/**
 * Tax code compliance validation.
 *
 * Checks that tax codes are present where required, valid in QBO,
 * and appropriate for the entity's jurisdiction.
 */

import type { ValidationResult, ValidationError } from './je-balance.js';
import type { HttpClient } from './account-validity.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaxCodeRef {
  value: string;
  name?: string;
}

interface LineItem {
  Amount?: string | number | null;
  DetailType?: string;
  SalesItemLineDetail?: {
    TaxCodeRef?: TaxCodeRef;
    [key: string]: unknown;
  };
  ItemBasedExpenseLineDetail?: {
    TaxCodeRef?: TaxCodeRef;
    [key: string]: unknown;
  };
  AccountBasedExpenseLineDetail?: {
    TaxCodeRef?: TaxCodeRef;
    [key: string]: unknown;
  };
  JournalEntryLineDetail?: {
    TaxCodeRef?: TaxCodeRef;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface QBOTaxCodeResponse {
  QueryResponse?: {
    TaxCode?: Array<{
      Id: string;
      Name: string;
      Active?: boolean;
      Taxable?: boolean;
      TaxGroup?: boolean;
      Description?: string;
      [key: string]: unknown;
    }>;
    totalCount?: number;
  };
}

interface QBOCompanyInfoResponse {
  QueryResponse?: {
    CompanyInfo?: Array<{
      Country?: string;
      [key: string]: unknown;
    }>;
  };
}

/** Entity types that require tax codes on line items */
const TAX_REQUIRED_ENTITY_TYPES = new Set([
  'Invoice', 'SalesReceipt', 'Estimate', 'CreditMemo',
  'Bill', 'Expense', 'Purchase',
]);

/** Jurisdictions that require tax codes on every taxable line */
const STRICT_TAX_JURISDICTIONS = new Set([
  'AU', 'GB', 'CA', 'IN', 'NZ',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractTaxCodeRef(line: LineItem): TaxCodeRef | undefined {
  return (
    line.SalesItemLineDetail?.TaxCodeRef ??
    line.ItemBasedExpenseLineDetail?.TaxCodeRef ??
    line.AccountBasedExpenseLineDetail?.TaxCodeRef ??
    line.JournalEntryLineDetail?.TaxCodeRef
  );
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate tax codes on line items.
 *
 * @param realmId     QBO company ID
 * @param lineItems   Array of entity line items
 * @param httpClient  HTTP client for QBO API calls
 * @param entityType  The entity type (e.g. 'Invoice', 'Bill')
 */
export async function validateTaxCode(
  realmId: string,
  lineItems: LineItem[],
  httpClient: HttpClient,
  entityType?: string,
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];

  if (!lineItems || lineItems.length === 0) {
    return { valid: true, errors: [] };
  }

  // Determine if tax codes are required for this entity type
  const taxRequired = entityType ? TAX_REQUIRED_ENTITY_TYPES.has(entityType) : false;

  // Fetch company info to determine jurisdiction
  let country: string | undefined;
  try {
    const result = await httpClient.query(realmId, 'SELECT * FROM CompanyInfo');
    const body = result.body as QBOCompanyInfoResponse;
    country = body?.QueryResponse?.CompanyInfo?.[0]?.Country;
  } catch {
    // Non-fatal: proceed without jurisdiction check
  }

  const strictJurisdiction = country ? STRICT_TAX_JURISDICTIONS.has(country) : false;

  // Collect all unique tax code IDs referenced in lines
  const taxCodeIds = new Set<string>();
  const linesTaxCodes: Array<{ index: number; taxCodeRef?: TaxCodeRef }> = [];

  for (let i = 0; i < lineItems.length; i++) {
    const line = lineItems[i];
    // Skip SubTotalLine, DiscountLine, etc.
    if (line.DetailType === 'SubTotalLineDetail' || line.DetailType === 'DiscountLineDetail') {
      continue;
    }

    const taxCodeRef = extractTaxCodeRef(line);
    linesTaxCodes.push({ index: i, taxCodeRef });

    if (taxCodeRef?.value) {
      taxCodeIds.add(taxCodeRef.value);
    } else if (taxRequired && strictJurisdiction) {
      errors.push({
        field: `Line[${i}].TaxCodeRef`,
        code: 'TAX_CODE_MISSING',
        message: `Line ${i} is missing a tax code, which is required for ${entityType} in jurisdiction ${country}`,
        meta: { lineIndex: i, entityType, country },
      });
    }
  }

  // Validate referenced tax codes exist and are active in QBO
  if (taxCodeIds.size > 0) {
    const idList = Array.from(taxCodeIds).map((id) => `'${id}'`).join(', ');
    try {
      const result = await httpClient.query(
        realmId,
        `SELECT * FROM TaxCode WHERE Id IN (${idList})`,
      );
      const body = result.body as QBOTaxCodeResponse;
      const validCodes = body?.QueryResponse?.TaxCode ?? [];
      const validCodeMap = new Map(validCodes.map((tc) => [tc.Id, tc]));

      for (const { index, taxCodeRef } of linesTaxCodes) {
        if (!taxCodeRef?.value) continue;

        const taxCode = validCodeMap.get(taxCodeRef.value);
        if (!taxCode) {
          errors.push({
            field: `Line[${index}].TaxCodeRef`,
            code: 'TAX_CODE_NOT_FOUND',
            message: `Tax code '${taxCodeRef.value}' on line ${index} does not exist in QBO`,
            meta: { lineIndex: index, taxCodeId: taxCodeRef.value },
          });
          continue;
        }

        if (taxCode.Active === false) {
          errors.push({
            field: `Line[${index}].TaxCodeRef`,
            code: 'TAX_CODE_INACTIVE',
            message: `Tax code '${taxCode.Name}' (${taxCode.Id}) on line ${index} is inactive`,
            meta: { lineIndex: index, taxCodeId: taxCode.Id, taxCodeName: taxCode.Name },
          });
        }
      }
    } catch (err) {
      errors.push({
        field: 'TaxCode',
        code: 'TAX_CODE_LOOKUP_FAILED',
        message: `Failed to validate tax codes: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
