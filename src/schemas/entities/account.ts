import { z } from 'zod';
import {
  QBOBaseEntity, QBORef, QBORefOptional, QBOOptionalString,
} from '../common.js';
import { QBOMoneyOptional } from '../money.js';

/** Account classification */
export const AccountClassification = z.enum([
  'Asset', 'Equity', 'Expense', 'Liability', 'Revenue',
]);

/** Account type */
export const AccountType = z.enum([
  'Bank', 'Other Current Asset', 'Fixed Asset', 'Other Asset',
  'Accounts Receivable',
  'Equity',
  'Expense', 'Other Expense', 'Cost of Goods Sold',
  'Accounts Payable', 'Credit Card', 'Long Term Liability', 'Other Current Liability',
  'Income', 'Other Income',
]);

/** Account schema (Chart of Accounts) */
export const AccountSchema = QBOBaseEntity.extend({
  Name: z.string(),
  AccountType: AccountType,
  AccountSubType: z.string().optional(),
  Classification: AccountClassification.optional(),
  AcctNum: QBOOptionalString.optional(),
  Description: QBOOptionalString.optional(),
  Active: z.boolean().optional(),
  SubAccount: z.boolean().optional(),
  ParentRef: QBORefOptional,
  FullyQualifiedName: QBOOptionalString.optional(),
  CurrencyRef: QBORefOptional,
  CurrentBalance: QBOMoneyOptional.optional(),
  CurrentBalanceWithSubAccounts: QBOMoneyOptional.optional(),
  TaxCodeRef: QBORefOptional,
  TxnLocationType: z.string().optional(),
}).passthrough();

export type Account = z.infer<typeof AccountSchema>;
