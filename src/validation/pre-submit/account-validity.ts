/**
 * Account reference validation.
 *
 * Checks that referenced accounts exist, are active, and are of the
 * correct type for the operation being performed.
 */

import type { ValidationResult, ValidationError } from './je-balance.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HttpClient {
  get(realmId: string, path: string): Promise<{ statusCode: number; body: unknown }>;
  query(realmId: string, query: string): Promise<{ statusCode: number; body: unknown }>;
}

interface AccountRef {
  value: string;
  name?: string;
}

interface QBOQueryResponse {
  QueryResponse?: {
    Account?: Array<{
      Id: string;
      Name: string;
      AccountType: string;
      Classification?: string;
      Active?: boolean;
      [key: string]: unknown;
    }>;
    totalCount?: number;
  };
}

/** Maps entity type + context to the allowed account types. */
const ACCOUNT_TYPE_RULES: Record<string, string[]> = {
  'Invoice:DepositToAccount': ['Bank', 'Other Current Asset'],
  'Invoice:IncomeAccount': ['Income', 'Other Income'],
  'Bill:ExpenseAccount': ['Expense', 'Other Expense', 'Cost of Goods Sold'],
  'Bill:APAccount': ['Accounts Payable'],
  'Payment:DepositToAccount': ['Bank', 'Other Current Asset', 'Other Current Liability'],
  'Payment:ARAccount': ['Accounts Receivable'],
  'BillPayment:APAccount': ['Accounts Payable'],
  'BillPayment:BankAccount': ['Bank'],
  'JournalEntry:Account': [
    'Bank', 'Other Current Asset', 'Fixed Asset', 'Other Asset',
    'Accounts Receivable', 'Equity',
    'Expense', 'Other Expense', 'Cost of Goods Sold',
    'Accounts Payable', 'Credit Card', 'Long Term Liability', 'Other Current Liability',
    'Income', 'Other Income',
  ],
  'Expense:Account': ['Bank', 'Credit Card'],
  'Expense:ExpenseAccount': ['Expense', 'Other Expense', 'Cost of Goods Sold'],
};

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate that an account reference points to an existing, active account
 * of the correct type for the given context.
 *
 * @param realmId     QBO company ID
 * @param accountRef  The account reference to validate
 * @param httpClient  HTTP client for QBO API calls
 * @param context     Operation context (e.g. 'Invoice:DepositToAccount')
 */
export async function validateAccountRef(
  realmId: string,
  accountRef: AccountRef,
  httpClient: HttpClient,
  context?: string,
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];

  if (!accountRef.value) {
    return {
      valid: false,
      errors: [{
        field: 'AccountRef.value',
        code: 'ACCOUNT_REF_MISSING',
        message: 'Account reference value is required',
      }],
    };
  }

  let account: QBOQueryResponse['QueryResponse'] extends { Account?: infer A } ? (A extends Array<infer E> ? E : never) : never;

  try {
    const sql = `SELECT * FROM Account WHERE Id = '${accountRef.value}'`;
    const result = await httpClient.query(realmId, sql);
    const body = result.body as QBOQueryResponse;
    const accounts = body?.QueryResponse?.Account;

    if (!accounts || accounts.length === 0) {
      errors.push({
        field: 'AccountRef',
        code: 'ACCOUNT_NOT_FOUND',
        message: `Account with Id '${accountRef.value}' not found`,
        meta: { accountId: accountRef.value },
      });
      return { valid: false, errors };
    }

    account = accounts[0];
  } catch (err) {
    errors.push({
      field: 'AccountRef',
      code: 'ACCOUNT_LOOKUP_FAILED',
      message: `Failed to look up account '${accountRef.value}': ${err instanceof Error ? err.message : String(err)}`,
    });
    return { valid: false, errors };
  }

  // Check active status
  if (account.Active === false) {
    errors.push({
      field: 'AccountRef',
      code: 'ACCOUNT_INACTIVE',
      message: `Account '${account.Name}' (${account.Id}) is inactive`,
      meta: { accountId: account.Id, accountName: account.Name },
    });
  }

  // Check account type for context
  if (context) {
    const allowedTypes = ACCOUNT_TYPE_RULES[context];
    if (allowedTypes && !allowedTypes.includes(account.AccountType)) {
      errors.push({
        field: 'AccountRef',
        code: 'ACCOUNT_TYPE_MISMATCH',
        message: `Account '${account.Name}' is type '${account.AccountType}', but ${context} requires one of: ${allowedTypes.join(', ')}`,
        meta: {
          accountId: account.Id,
          accountName: account.Name,
          accountType: account.AccountType,
          allowedTypes,
          context,
        },
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
