/**
 * Currency consistency validation.
 *
 * Ensures currency on transactions matches the counterparty's default
 * currency and that exchange rates are within tolerance of market rates.
 */

import Decimal from 'decimal.js';
import type { ValidationResult, ValidationError } from './je-balance.js';
import type { HttpClient } from './account-validity.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CurrencyRef {
  value: string;
  name?: string;
}

interface CounterpartyRef {
  value: string;
  name?: string;
}

interface EntityPayload {
  CurrencyRef?: CurrencyRef;
  CustomerRef?: CounterpartyRef;
  VendorRef?: CounterpartyRef;
  ExchangeRate?: number | null;
  [key: string]: unknown;
}

interface QBOCustomerResponse {
  QueryResponse?: {
    Customer?: Array<{
      Id: string;
      DisplayName: string;
      CurrencyRef?: CurrencyRef;
      [key: string]: unknown;
    }>;
  };
}

interface QBOVendorResponse {
  QueryResponse?: {
    Vendor?: Array<{
      Id: string;
      DisplayName: string;
      CurrencyRef?: CurrencyRef;
      [key: string]: unknown;
    }>;
  };
}

interface QBOCompanyInfoResponse {
  QueryResponse?: {
    CompanyInfo?: Array<{
      HomeCurrency?: CurrencyRef;
      MultiCurrencyEnabled?: boolean;
      [key: string]: unknown;
    }>;
  };
}

/** Exchange rate tolerance: 5% deviation from expected rate */
const EXCHANGE_RATE_TOLERANCE = 0.05;

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate currency consistency with customer/vendor default and exchange rate bounds.
 *
 * @param realmId     QBO company ID
 * @param entity      The entity payload being submitted
 * @param httpClient  HTTP client for QBO API calls
 */
export async function validateCurrency(
  realmId: string,
  entity: EntityPayload,
  httpClient: HttpClient,
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const txnCurrency = entity.CurrencyRef?.value;

  // If no currency specified, entity uses home currency — nothing to validate
  if (!txnCurrency) {
    return { valid: true, errors: [] };
  }

  // Fetch company home currency
  let homeCurrency: string | undefined;
  let multiCurrencyEnabled = false;

  try {
    const result = await httpClient.query(realmId, 'SELECT * FROM CompanyInfo');
    const body = result.body as QBOCompanyInfoResponse;
    const info = body?.QueryResponse?.CompanyInfo?.[0];
    homeCurrency = info?.HomeCurrency?.value;
    multiCurrencyEnabled = info?.MultiCurrencyEnabled === true;
  } catch {
    // Non-fatal: proceed without company currency check
  }

  // If multi-currency is not enabled but a foreign currency is specified
  if (homeCurrency && !multiCurrencyEnabled && txnCurrency !== homeCurrency) {
    errors.push({
      field: 'CurrencyRef',
      code: 'MULTI_CURRENCY_DISABLED',
      message: `Transaction currency '${txnCurrency}' differs from home currency '${homeCurrency}', but multi-currency is not enabled for this company`,
      meta: { txnCurrency, homeCurrency },
    });
    return { valid: false, errors };
  }

  // Check counterparty currency consistency
  const counterpartyRef = entity.CustomerRef ?? entity.VendorRef;
  const counterpartyType = entity.CustomerRef ? 'Customer' : entity.VendorRef ? 'Vendor' : null;

  if (counterpartyRef && counterpartyType) {
    try {
      const sql = `SELECT * FROM ${counterpartyType} WHERE Id = '${counterpartyRef.value}'`;
      const result = await httpClient.query(realmId, sql);

      let counterpartyCurrency: string | undefined;
      let counterpartyName: string | undefined;

      if (counterpartyType === 'Customer') {
        const body = result.body as QBOCustomerResponse;
        const cust = body?.QueryResponse?.Customer?.[0];
        counterpartyCurrency = cust?.CurrencyRef?.value;
        counterpartyName = cust?.DisplayName;
      } else {
        const body = result.body as QBOVendorResponse;
        const vendor = body?.QueryResponse?.Vendor?.[0];
        counterpartyCurrency = vendor?.CurrencyRef?.value;
        counterpartyName = vendor?.DisplayName;
      }

      // QBO requires transactions to match the counterparty's currency
      if (counterpartyCurrency && txnCurrency !== counterpartyCurrency) {
        errors.push({
          field: 'CurrencyRef',
          code: 'CURRENCY_MISMATCH',
          message: `Transaction currency '${txnCurrency}' does not match ${counterpartyType.toLowerCase()} '${counterpartyName}' default currency '${counterpartyCurrency}'`,
          meta: {
            txnCurrency,
            counterpartyCurrency,
            counterpartyType,
            counterpartyId: counterpartyRef.value,
            counterpartyName,
          },
        });
      }
    } catch (err) {
      errors.push({
        field: 'CurrencyRef',
        code: 'COUNTERPARTY_LOOKUP_FAILED',
        message: `Failed to validate counterparty currency: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Validate exchange rate tolerance (only for foreign currency)
  if (entity.ExchangeRate != null && homeCurrency && txnCurrency !== homeCurrency) {
    const exchangeRate = new Decimal(entity.ExchangeRate);

    // Basic sanity: exchange rate must be positive
    if (exchangeRate.lte(0)) {
      errors.push({
        field: 'ExchangeRate',
        code: 'EXCHANGE_RATE_INVALID',
        message: `Exchange rate must be positive, got ${exchangeRate.toFixed(6)}`,
        meta: { exchangeRate: exchangeRate.toFixed(6) },
      });
    } else {
      // Fetch the QBO-stored exchange rate for the currency pair
      try {
        const result = await httpClient.query(
          realmId,
          `SELECT * FROM ExchangeRate WHERE SourceCurrencyCode = '${txnCurrency}' AND TargetCurrencyCode = '${homeCurrency}'`,
        );

        const body = result.body as {
          QueryResponse?: {
            ExchangeRate?: Array<{ Rate?: number; [key: string]: unknown }>;
          };
        };

        const marketRate = body?.QueryResponse?.ExchangeRate?.[0]?.Rate;

        if (marketRate != null && marketRate > 0) {
          const marketDec = new Decimal(marketRate);
          const deviation = exchangeRate.minus(marketDec).abs().div(marketDec);

          if (deviation.gt(EXCHANGE_RATE_TOLERANCE)) {
            errors.push({
              field: 'ExchangeRate',
              code: 'EXCHANGE_RATE_OUT_OF_TOLERANCE',
              message: `Exchange rate ${exchangeRate.toFixed(6)} deviates ${deviation.times(100).toFixed(2)}% from market rate ${marketDec.toFixed(6)} (tolerance: ${EXCHANGE_RATE_TOLERANCE * 100}%)`,
              meta: {
                exchangeRate: exchangeRate.toFixed(6),
                marketRate: marketDec.toFixed(6),
                deviation: deviation.toFixed(4),
                tolerance: EXCHANGE_RATE_TOLERANCE,
              },
            });
          }
        }
      } catch {
        // Non-fatal: exchange rate lookup may not be supported in sandbox
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
