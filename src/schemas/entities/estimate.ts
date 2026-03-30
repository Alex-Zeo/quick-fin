import { z } from 'zod';
import {
  QBOBaseEntity, QBORef, QBORefOptional, QBODateOptional,
  QBOOptionalString, QBOAddress, QBOEmail, QBOCustomField, QBOLinkedTxn,
} from '../common.js';
import { QBOMoneyOptional } from '../money.js';
import { InvoiceLine, TxnTaxDetail } from './invoice.js';

/** Estimate schema */
export const EstimateSchema = QBOBaseEntity.extend({
  Line: z.array(InvoiceLine),
  CustomerRef: QBORef,
  CurrencyRef: QBORefOptional,
  DepartmentRef: QBORefOptional,
  ClassRef: QBORefOptional,
  SalesTermRef: QBORefOptional,
  ShipMethodRef: QBORefOptional,
  DocNumber: QBOOptionalString.optional(),
  TxnDate: QBODateOptional,
  ExpirationDate: QBODateOptional,
  ShipDate: QBODateOptional,
  PrivateNote: QBOOptionalString.optional(),
  CustomerMemo: z.object({ value: z.string().optional() }).passthrough().optional(),
  TxnTaxDetail: TxnTaxDetail,
  BillAddr: QBOAddress,
  ShipAddr: QBOAddress,
  BillEmail: QBOEmail,
  LinkedTxn: z.array(QBOLinkedTxn).optional(),
  CustomField: z.array(QBOCustomField).optional(),
  TotalAmt: QBOMoneyOptional.optional(),
  HomeTotalAmt: QBOMoneyOptional.optional(),
  ExchangeRate: z.number().optional(),
  GlobalTaxCalculation: z.enum(['TaxExcluded', 'TaxInclusive', 'NotApplicable']).optional(),
  ApplyTaxAfterDiscount: z.boolean().optional(),
  PrintStatus: z.enum(['NotSet', 'NeedToPrint', 'PrintComplete']).optional(),
  EmailStatus: z.enum(['NotSet', 'NeedToSend', 'EmailSent']).optional(),
  TxnStatus: z.enum(['Accepted', 'Closed', 'Pending', 'Rejected', 'Converted']).optional(),
  AcceptedBy: QBOOptionalString.optional(),
  AcceptedDate: QBODateOptional,
  RecurDataRef: QBORefOptional,
}).passthrough();

export type Estimate = z.infer<typeof EstimateSchema>;
