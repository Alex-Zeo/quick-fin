import { z } from 'zod';
import {
  QBOBaseEntity, QBORef, QBORefOptional, QBODateOptional,
  QBOOptionalString, QBOAddress, QBOEmail, QBOCustomField, QBOLinkedTxn,
  QBOLineItemBase,
} from '../common.js';
import { QBOMoneyOptional } from '../money.js';
import { TxnTaxDetail } from './invoice.js';
import { ItemBasedExpenseLineDetail, AccountBasedExpenseLineDetail } from './bill.js';

/** PurchaseOrder line */
export const PurchaseOrderLine = QBOLineItemBase.extend({
  ItemBasedExpenseLineDetail: ItemBasedExpenseLineDetail.optional(),
  AccountBasedExpenseLineDetail: AccountBasedExpenseLineDetail.optional(),
}).passthrough();

/** PurchaseOrder schema */
export const PurchaseOrderSchema = QBOBaseEntity.extend({
  VendorRef: QBORef,
  APAccountRef: QBORefOptional,
  Line: z.array(PurchaseOrderLine),
  CurrencyRef: QBORefOptional,
  DepartmentRef: QBORefOptional,
  ClassRef: QBORefOptional,
  SalesTermRef: QBORefOptional,
  ShipMethodRef: QBORefOptional,
  ShipTo: QBORefOptional,
  DocNumber: QBOOptionalString.optional(),
  TxnDate: QBODateOptional,
  DueDate: QBODateOptional,
  ShipDate: QBODateOptional,
  PrivateNote: QBOOptionalString.optional(),
  Memo: QBOOptionalString.optional(),
  VendorAddr: QBOAddress,
  ShipAddr: QBOAddress,
  POEmail: QBOEmail,
  TxnTaxDetail: TxnTaxDetail,
  LinkedTxn: z.array(QBOLinkedTxn).optional(),
  CustomField: z.array(QBOCustomField).optional(),
  TotalAmt: QBOMoneyOptional.optional(),
  ExchangeRate: z.number().optional(),
  GlobalTaxCalculation: z.enum(['TaxExcluded', 'TaxInclusive', 'NotApplicable']).optional(),
  POStatus: z.enum(['Open', 'Closed']).optional(),
  EmailStatus: z.enum(['NotSet', 'NeedToSend', 'EmailSent']).optional(),
  RecurDataRef: QBORefOptional,
}).passthrough();

export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;
