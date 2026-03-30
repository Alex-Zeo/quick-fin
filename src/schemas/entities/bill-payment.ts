import { z } from 'zod';
import {
  QBOBaseEntity, QBORef, QBORefOptional, QBODateOptional,
  QBOOptionalString, QBOLinkedTxn,
} from '../common.js';
import { QBOMoney, QBOMoneyOptional } from '../money.js';

/** BillPayment line (links to bills) */
export const BillPaymentLine = z.object({
  Amount: z.union([z.string(), z.number()]).optional(),
  LinkedTxn: z.array(QBOLinkedTxn).optional(),
}).passthrough();

/** CheckPayment detail */
export const CheckPayment = z.object({
  BankAccountRef: QBORef.optional(),
  PrintStatus: z.enum(['NotSet', 'NeedToPrint', 'PrintComplete']).optional(),
}).passthrough();

/** CreditCardPayment detail */
export const CreditCardPayment = z.object({
  CCAccountRef: QBORef.optional(),
}).passthrough();

/** BillPayment schema */
export const BillPaymentSchema = QBOBaseEntity.extend({
  VendorRef: QBORef,
  TotalAmt: QBOMoney,
  PayType: z.enum(['Check', 'CreditCard']),
  Line: z.array(BillPaymentLine).optional(),
  CheckPayment: CheckPayment.optional(),
  CreditCardPayment: CreditCardPayment.optional(),
  APAccountRef: QBORefOptional,
  CurrencyRef: QBORefOptional,
  DepartmentRef: QBORefOptional,
  DocNumber: QBOOptionalString.optional(),
  TxnDate: QBODateOptional,
  PrivateNote: QBOOptionalString.optional(),
  ExchangeRate: z.number().optional(),
  ProcessBillPayment: z.boolean().optional(),
}).passthrough();

export type BillPayment = z.infer<typeof BillPaymentSchema>;
