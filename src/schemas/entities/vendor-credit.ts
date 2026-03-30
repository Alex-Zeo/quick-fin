import { z } from 'zod';
import {
  QBOBaseEntity, QBORef, QBORefOptional, QBODateOptional,
  QBOOptionalString, QBOLinkedTxn,
} from '../common.js';
import { QBOMoneyOptional } from '../money.js';
import { TxnTaxDetail } from './invoice.js';
import { BillLine } from './bill.js';

/** VendorCredit schema */
export const VendorCreditSchema = QBOBaseEntity.extend({
  VendorRef: QBORef,
  Line: z.array(BillLine),
  APAccountRef: QBORefOptional,
  CurrencyRef: QBORefOptional,
  DepartmentRef: QBORefOptional,
  DocNumber: QBOOptionalString.optional(),
  TxnDate: QBODateOptional,
  PrivateNote: QBOOptionalString.optional(),
  TxnTaxDetail: TxnTaxDetail,
  LinkedTxn: z.array(QBOLinkedTxn).optional(),
  TotalAmt: QBOMoneyOptional.optional(),
  Balance: QBOMoneyOptional.optional(),
  ExchangeRate: z.number().optional(),
  GlobalTaxCalculation: z.enum(['TaxExcluded', 'TaxInclusive', 'NotApplicable']).optional(),
  RecurDataRef: QBORefOptional,
}).passthrough();

export type VendorCredit = z.infer<typeof VendorCreditSchema>;
