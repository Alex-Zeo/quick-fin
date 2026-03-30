import { z } from 'zod';
import {
  QBOBaseEntity, QBORef, QBORefOptional, QBODateOptional,
  QBOOptionalString, QBOAddress, QBOEmail, QBOCustomField,
} from '../common.js';
import { QBOMoneyOptional } from '../money.js';
import { InvoiceLine, TxnTaxDetail } from './invoice.js';

/** RefundReceipt schema */
export const RefundReceiptSchema = QBOBaseEntity.extend({
  Line: z.array(InvoiceLine),
  CustomerRef: QBORef,
  DepositToAccountRef: QBORefOptional,
  PaymentMethodRef: QBORefOptional,
  CurrencyRef: QBORefOptional,
  DepartmentRef: QBORefOptional,
  ClassRef: QBORefOptional,
  PaymentRefNum: QBOOptionalString.optional(),
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
  HomeTotalAmt: QBOMoneyOptional.optional(),
  ExchangeRate: z.number().optional(),
  GlobalTaxCalculation: z.enum(['TaxExcluded', 'TaxInclusive', 'NotApplicable']).optional(),
  ApplyTaxAfterDiscount: z.boolean().optional(),
  PrintStatus: z.enum(['NotSet', 'NeedToPrint', 'PrintComplete']).optional(),
  EmailStatus: z.enum(['NotSet', 'NeedToSend', 'EmailSent']).optional(),
  CheckPayment: z.object({
    BankAccountRef: QBORef.optional(),
    PrintStatus: z.string().optional(),
  }).passthrough().optional(),
  RecurDataRef: QBORefOptional,
}).passthrough();

export type RefundReceipt = z.infer<typeof RefundReceiptSchema>;
