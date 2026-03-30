import { z } from 'zod';
import {
  QBOBaseEntity, QBORef, QBORefOptional, QBODateOptional,
  QBOOptionalString, QBOLineItemBase,
} from '../common.js';
import { QBOMoneyOptional } from '../money.js';
import { TxnTaxDetail } from './invoice.js';

/** DepositLineDetail */
export const DepositLineDetail = z.object({
  Entity: z.object({
    Type: z.string().optional(),
    EntityRef: QBORef.optional(),
  }).passthrough().optional(),
  ClassRef: QBORef.optional(),
  AccountRef: QBORef.optional(),
  PaymentMethodRef: QBORef.optional(),
  CheckNum: z.string().optional(),
  TxnType: z.string().optional(),
}).passthrough();

/** Deposit line */
export const DepositLine = QBOLineItemBase.extend({
  DepositLineDetail: DepositLineDetail.optional(),
}).passthrough();

/** CashBack detail for deposits */
export const CashBackInfo = z.object({
  AccountRef: QBORef.optional(),
  Amount: QBOMoneyOptional.optional(),
  Memo: QBOOptionalString.optional(),
}).passthrough().optional();

/** Deposit schema */
export const DepositSchema = QBOBaseEntity.extend({
  DepositToAccountRef: QBORef,
  Line: z.array(DepositLine),
  CurrencyRef: QBORefOptional,
  DepartmentRef: QBORefOptional,
  DocNumber: QBOOptionalString.optional(),
  TxnDate: QBODateOptional,
  PrivateNote: QBOOptionalString.optional(),
  TxnTaxDetail: TxnTaxDetail,
  CashBack: CashBackInfo,
  TotalAmt: QBOMoneyOptional.optional(),
  HomeTotalAmt: QBOMoneyOptional.optional(),
  ExchangeRate: z.number().optional(),
  GlobalTaxCalculation: z.enum(['TaxExcluded', 'TaxInclusive', 'NotApplicable']).optional(),
  RecurDataRef: QBORefOptional,
  TxnSource: QBOOptionalString.optional(),
}).passthrough();

export type Deposit = z.infer<typeof DepositSchema>;
