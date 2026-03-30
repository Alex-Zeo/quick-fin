import { z } from 'zod';
import {
  QBOBaseEntity, QBORef, QBORefOptional, QBODateOptional,
  QBOOptionalString, QBOAddress, QBOEmail, QBOCustomField,
} from '../common.js';
import { QBOMoneyOptional } from '../money.js';
import { InvoiceLine, TxnTaxDetail, DeliveryInfo } from './invoice.js';

/** SalesReceipt schema */
export const SalesReceiptSchema = QBOBaseEntity.extend({
  Line: z.array(InvoiceLine),
  CustomerRef: QBORef,
  CurrencyRef: QBORefOptional,
  DepartmentRef: QBORefOptional,
  ClassRef: QBORefOptional,
  DepositToAccountRef: QBORefOptional,
  PaymentMethodRef: QBORefOptional,
  PaymentRefNum: QBOOptionalString.optional(),
  DocNumber: QBOOptionalString.optional(),
  TxnDate: QBODateOptional,
  ShipDate: QBODateOptional,
  PrivateNote: QBOOptionalString.optional(),
  CustomerMemo: z.object({ value: z.string().optional() }).passthrough().optional(),
  TxnTaxDetail: TxnTaxDetail,
  BillAddr: QBOAddress,
  ShipAddr: QBOAddress,
  BillEmail: QBOEmail,
  BillEmailCc: QBOEmail,
  BillEmailBcc: QBOEmail,
  DeliveryInfo: DeliveryInfo,
  CustomField: z.array(QBOCustomField).optional(),
  TotalAmt: QBOMoneyOptional.optional(),
  Balance: QBOMoneyOptional.optional(),
  HomeTotalAmt: QBOMoneyOptional.optional(),
  ExchangeRate: z.number().optional(),
  GlobalTaxCalculation: z.enum(['TaxExcluded', 'TaxInclusive', 'NotApplicable']).optional(),
  ApplyTaxAfterDiscount: z.boolean().optional(),
  PrintStatus: z.enum(['NotSet', 'NeedToPrint', 'PrintComplete']).optional(),
  EmailStatus: z.enum(['NotSet', 'NeedToSend', 'EmailSent']).optional(),
  CreditCardPayment: z.any().optional(),
  RecurDataRef: QBORefOptional,
  TxnSource: QBOOptionalString.optional(),
}).passthrough();

export type SalesReceipt = z.infer<typeof SalesReceiptSchema>;
