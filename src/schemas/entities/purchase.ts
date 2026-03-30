import { z } from 'zod';
import {
  QBOBaseEntity, QBORef, QBORefOptional, QBODateOptional,
  QBOOptionalString, QBOAddress, QBOLinkedTxn, QBOLineItemBase,
} from '../common.js';
import { QBOMoneyOptional } from '../money.js';
import { TxnTaxDetail } from './invoice.js';
import { ItemBasedExpenseLineDetail, AccountBasedExpenseLineDetail } from './bill.js';

/** Purchase line item */
export const PurchaseLine = QBOLineItemBase.extend({
  ItemBasedExpenseLineDetail: ItemBasedExpenseLineDetail.optional(),
  AccountBasedExpenseLineDetail: AccountBasedExpenseLineDetail.optional(),
}).passthrough();

/** Purchase schema (expense/check) */
export const PurchaseSchema = QBOBaseEntity.extend({
  AccountRef: QBORef,
  PaymentType: z.enum(['Cash', 'Check', 'CreditCard']),
  Line: z.array(PurchaseLine),
  EntityRef: QBORefOptional,
  CurrencyRef: QBORefOptional,
  DepartmentRef: QBORefOptional,
  DocNumber: QBOOptionalString.optional(),
  TxnDate: QBODateOptional,
  PrivateNote: QBOOptionalString.optional(),
  TxnTaxDetail: TxnTaxDetail,
  RemitToAddr: QBOAddress,
  LinkedTxn: z.array(QBOLinkedTxn).optional(),
  TotalAmt: QBOMoneyOptional.optional(),
  ExchangeRate: z.number().optional(),
  GlobalTaxCalculation: z.enum(['TaxExcluded', 'TaxInclusive', 'NotApplicable']).optional(),
  Credit: z.boolean().optional(),
  PrintStatus: z.enum(['NotSet', 'NeedToPrint', 'PrintComplete']).optional(),
  RecurDataRef: QBORefOptional,
  TxnSource: QBOOptionalString.optional(),
}).passthrough();

export type Purchase = z.infer<typeof PurchaseSchema>;
