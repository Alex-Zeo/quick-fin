import { z } from 'zod';
import {
  QBOBaseEntity, QBORef, QBORefOptional, QBODateOptional,
  QBOOptionalString, QBOLineItemBase,
} from '../common.js';
import { QBOMoneyOptional } from '../money.js';
import { TxnTaxDetail } from './invoice.js';

/** JournalEntryLineDetail for debit/credit lines */
export const JournalEntryLineDetail = z.object({
  PostingType: z.enum(['Debit', 'Credit']),
  AccountRef: QBORef,
  Entity: z.object({
    Type: z.string().optional(),
    EntityRef: QBORef.optional(),
  }).passthrough().optional(),
  ClassRef: QBORef.optional(),
  DepartmentRef: QBORef.optional(),
  TaxCodeRef: QBORef.optional(),
  TaxApplicableOn: z.string().optional(),
  TaxAmount: QBOMoneyOptional.optional(),
  BillableStatus: z.enum(['Billable', 'NotBillable', 'HasBeenBilled']).optional(),
}).passthrough();

/** JournalEntry line */
export const JournalEntryLine = QBOLineItemBase.extend({
  JournalEntryLineDetail: JournalEntryLineDetail.optional(),
}).passthrough();

/** JournalEntry schema */
export const JournalEntrySchema = QBOBaseEntity.extend({
  Line: z.array(JournalEntryLine),
  CurrencyRef: QBORefOptional,
  DocNumber: QBOOptionalString.optional(),
  TxnDate: QBODateOptional,
  PrivateNote: QBOOptionalString.optional(),
  TxnTaxDetail: TxnTaxDetail,
  Adjustment: z.boolean().optional(),
  HomeTotalAmt: QBOMoneyOptional.optional(),
  TotalAmt: QBOMoneyOptional.optional(),
  ExchangeRate: z.number().optional(),
  GlobalTaxCalculation: z.enum(['TaxExcluded', 'TaxInclusive', 'NotApplicable']).optional(),
  RecurDataRef: QBORefOptional,
}).passthrough();

export type JournalEntry = z.infer<typeof JournalEntrySchema>;
