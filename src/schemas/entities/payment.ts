import { z } from 'zod';
import {
  QBOBaseEntity, QBORef, QBORefOptional, QBODateOptional,
  QBOOptionalString, QBOLinkedTxn,
} from '../common.js';
import { QBOMoney, QBOMoneyOptional } from '../money.js';

/** Line on a payment (links to invoices) */
export const PaymentLine = z.object({
  Amount: z.union([z.string(), z.number()]).optional(),
  LinkedTxn: z.array(QBOLinkedTxn).optional(),
  LineEx: z.any().optional(),
}).passthrough();

/** Payment schema */
export const PaymentSchema = QBOBaseEntity.extend({
  CustomerRef: QBORef,
  TotalAmt: QBOMoney,
  Line: z.array(PaymentLine).optional(),
  CurrencyRef: QBORefOptional,
  DepositToAccountRef: QBORefOptional,
  PaymentMethodRef: QBORefOptional,
  ARAccountRef: QBORefOptional,
  PaymentRefNum: QBOOptionalString.optional(),
  DocNumber: QBOOptionalString.optional(),
  TxnDate: QBODateOptional,
  PrivateNote: QBOOptionalString.optional(),
  UnappliedAmt: QBOMoneyOptional.optional(),
  ExchangeRate: z.number().optional(),
  ProcessPayment: z.boolean().optional(),
  TxnSource: QBOOptionalString.optional(),
  CreditCardPayment: z.object({
    CreditChargeInfo: z.object({
      Number: z.string().optional(),
      Type: z.string().optional(),
      NameOnAcct: z.string().optional(),
      CcExpiryMonth: z.number().optional(),
      CcExpiryYear: z.number().optional(),
      BillAddrStreet: z.string().optional(),
      PostalCode: z.string().optional(),
      Amount: QBOMoneyOptional.optional(),
      ProcessPayment: z.boolean().optional(),
    }).passthrough().optional(),
    CreditChargeResponse: z.object({
      Status: z.string().optional(),
      CCTransId: z.string().optional(),
      TxnAuthorizationTime: z.string().optional(),
    }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();

export type Payment = z.infer<typeof PaymentSchema>;
