import { z } from 'zod';
import {
  QBOBaseEntity, QBORef, QBORefOptional, QBODateOptional,
  QBOOptionalString, QBOLinkedTxn, QBOLineItemBase,
} from '../common.js';
import { QBOMoneyOptional } from '../money.js';
import { TxnTaxDetail } from './invoice.js';

/** ItemBasedExpenseLineDetail */
export const ItemBasedExpenseLineDetail = z.object({
  ItemRef: QBORef.optional(),
  ClassRef: QBORef.optional(),
  UnitPrice: QBOMoneyOptional.optional(),
  Qty: z.number().optional(),
  TaxCodeRef: QBORef.optional(),
  BillableStatus: z.enum(['Billable', 'NotBillable', 'HasBeenBilled']).optional(),
  CustomerRef: QBORef.optional(),
  TaxInclusiveAmt: QBOMoneyOptional.optional(),
}).passthrough();

/** AccountBasedExpenseLineDetail */
export const AccountBasedExpenseLineDetail = z.object({
  AccountRef: QBORef.optional(),
  ClassRef: QBORef.optional(),
  TaxCodeRef: QBORef.optional(),
  TaxAmount: QBOMoneyOptional.optional(),
  BillableStatus: z.enum(['Billable', 'NotBillable', 'HasBeenBilled']).optional(),
  CustomerRef: QBORef.optional(),
  MarkupInfo: z.object({
    PercentBased: z.boolean().optional(),
    Percent: z.number().optional(),
    PriceLevelRef: QBORef.optional(),
    MarkUpIncomeAccountRef: QBORef.optional(),
  }).passthrough().optional(),
  TaxInclusiveAmt: QBOMoneyOptional.optional(),
}).passthrough();

/** Bill line item */
export const BillLine = QBOLineItemBase.extend({
  ItemBasedExpenseLineDetail: ItemBasedExpenseLineDetail.optional(),
  AccountBasedExpenseLineDetail: AccountBasedExpenseLineDetail.optional(),
}).passthrough();

/** Bill schema */
export const BillSchema = QBOBaseEntity.extend({
  VendorRef: QBORef,
  Line: z.array(BillLine),
  APAccountRef: QBORefOptional,
  CurrencyRef: QBORefOptional,
  DepartmentRef: QBORefOptional,
  SalesTermRef: QBORefOptional,
  DocNumber: QBOOptionalString.optional(),
  TxnDate: QBODateOptional,
  DueDate: QBODateOptional,
  PrivateNote: QBOOptionalString.optional(),
  TxnTaxDetail: TxnTaxDetail,
  LinkedTxn: z.array(QBOLinkedTxn).optional(),
  TotalAmt: QBOMoneyOptional.optional(),
  Balance: QBOMoneyOptional.optional(),
  HomeBalance: QBOMoneyOptional.optional(),
  HomeTotalAmt: QBOMoneyOptional.optional(),
  ExchangeRate: z.number().optional(),
  GlobalTaxCalculation: z.enum(['TaxExcluded', 'TaxInclusive', 'NotApplicable']).optional(),
  RecurDataRef: QBORefOptional,
}).passthrough();

export type Bill = z.infer<typeof BillSchema>;
