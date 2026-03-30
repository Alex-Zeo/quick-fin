import { z } from 'zod';
import {
  QBOBaseEntity, QBORef, QBORefOptional, QBODateOptional,
  QBOOptionalString, QBOAddress, QBOEmail, QBOCustomField,
} from '../common.js';
import { QBOMoneyOptional } from '../money.js';
import { InvoiceLine, TxnTaxDetail } from './invoice.js';

/** CreditMemo schema */
export const CreditMemoSchema = QBOBaseEntity.extend({
  Line: z.array(InvoiceLine),
  CustomerRef: QBORef,
  CurrencyRef: QBORefOptional,
  DepartmentRef: QBORefOptional,
  ClassRef: QBORefOptional,
  SalesTermRef: QBORefOptional,
  DocNumber: QBOOptionalString.optional(),
  TxnDate: QBODateOptional,
  PrivateNote: QBOOptionalString.optional(),
  CustomerMemo: z.object({ value: z.string().optional() }).passthrough().optional(),
  TxnTaxDetail: TxnTaxDetail,
  BillAddr: QBOAddress,
  ShipAddr: QBOAddress,
  BillEmail: QBOEmail,
  CustomField: z.array(QBOCustomField).optional(),
  TotalAmt: QBOMoneyOptional.optional(),
  Balance: QBOMoneyOptional.optional(),
  RemainingCredit: QBOMoneyOptional.optional(),
  HomeTotalAmt: QBOMoneyOptional.optional(),
  ExchangeRate: z.number().optional(),
  GlobalTaxCalculation: z.enum(['TaxExcluded', 'TaxInclusive', 'NotApplicable']).optional(),
  ApplyTaxAfterDiscount: z.boolean().optional(),
  PrintStatus: z.enum(['NotSet', 'NeedToPrint', 'PrintComplete']).optional(),
  EmailStatus: z.enum(['NotSet', 'NeedToSend', 'EmailSent']).optional(),
  RecurDataRef: QBORefOptional,
}).passthrough();

export type CreditMemo = z.infer<typeof CreditMemoSchema>;
